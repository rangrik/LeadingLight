//! Visits, conversations and turns, for this process.
//!
//! A visit belongs to the window that opened it and to one vault, by a hash of its resolved path.
//! Every later call must come from that window. A conversation belongs to a vault. One turn runs at
//! a time in a conversation, on its own thread, with exactly the payload its Send named.
//!
//! A turn's outcome is admitted only while its turn is still running, not stopped, and under the
//! account it started with. Cancelling, closing the visit, disconnecting or quitting closes
//! admission at once, then waits for the provider to prove the work ended; a reply says `stopping`
//! while that is not proven, and a closing visit stays closing until it is. A late answer is never
//! admitted, and nothing is retried. A turn id the UI cancelled before its Send arrived is
//! remembered in that conversation, so that Send is refused.
//!
//! A disconnect closes provider admission before it collects running work, and keeps it closed
//! until the sign-out has run; a Send that read provider status before that is refused too.
//!
//! A provider that cannot prove its work for a turn ended (`TurnOutcome::Unconfirmed`, or a panic)
//! leaves that turn open as stopping for the rest of the process: nothing from it is admitted, its
//! conversation takes no other turn, and every cancel, close or disconnect waiting on it answers
//! `stopping` at once. After a restart it shows as stopped by the app closing, unproven.
//!
//! Each conversation says whether what it shows is saved locally. A write that failed keeps the
//! entries in memory as `unsaved` (never dropped when a visit closes) until a local save succeeds;
//! a write that published but could not sync its folder is `unconfirmed`. Saving again is local
//! only and never contacts the provider.
//!
//! Revisions come from one counter for the whole process: every change to a conversation takes the
//! next value, so a revision only increases.

use std::collections::{HashMap, HashSet};
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::check::{self, CONVERSATIONS_PER_VAULT, PAYLOAD_BYTES, TURNS_PER_CONVERSATION};
use super::prompt::{self, Payload, PriorTurn};
use super::provider::{Provider, TurnControl, TurnOutcome};
use super::store::{self, Published, Record, Store};
use super::wire::{
    AttachmentSummary, CancelConnectReply, CancelTurnReply, CloseVisitReply, ConnectArgs,
    ConnectRefusal, ConnectReply, Conversation, ConversationArgs, ConversationSummary,
    DeleteConversationReply, DeleteRefusal, DisconnectRefusal, DisconnectReply, Entry, Failure,
    ListConversationsReply, NewConversationRefusal, NewConversationReply, OpenVisitReply,
    ProviderArgs, ProviderId, ProviderState, Providers, ReadConversationArgs,
    ReadConversationReply, RunningTurn, SaveConversationReply, SendArgs, SendRefusal, SendReply,
    StatusReply, StopReason, Storage, TurnArgs, TurnPhase, UnavailableReason, VisitArgs,
    VisitRefusal,
};
use super::{hex_sha256, is_instant, now};
use crate::leadinglight_history::VaultRoots;

/// Opening another visit in the same window ends that window's oldest one, closing or not.
pub(crate) const MAX_VISITS_PER_OWNER: usize = 8;
/// Turn ids ended before their Send arrived that one conversation remembers; past that, it takes
/// no new turn in this process.
pub(crate) const MAX_TOMBSTONES: usize = 256;
const MAX_CONSENTS: usize = 32;
const CONSENT_BYTES: usize = 64 * 1024;
const CONSENT_FILE: &str = "consent.json";

struct Visit {
    owner: String,
    vault: String,
    opened: u64,
    /// Close was asked for, but a turn it started is not yet proven ended. Answers only close.
    closing: bool,
}

struct Running {
    turn_id: String,
    visit_id: String,
    phase: TurnPhase,
    control: Arc<TurnControl>,
    /// Set when admission closed; the outcome then is always this stop.
    stop: Option<StopReason>,
    account_epoch: u64,
    /// The provider returned without proving its work ended. The turn stays open as stopping, and
    /// nothing in this process will end it: waits do not wait for it.
    unconfirmed: bool,
}

struct Live {
    vault: String,
    record: Record,
    revision: u64,
    running: Option<Running>,
    storage: Storage,
    tombstones: HashSet<String>,
    /// Too many tombstones: no new turn in this process.
    sealed: bool,
}

impl Live {
    fn new(vault: String, record: Record, revision: u64, storage: Storage) -> Self {
        Self {
            vault,
            record,
            revision,
            running: None,
            storage,
            tombstones: HashSet::new(),
            sealed: false,
        }
    }
}

#[derive(Default)]
struct Inner {
    revision: u64,
    visits: HashMap<String, Visit>,
    live: HashMap<String, Live>,
    /// Disconnects in progress; while any is, no Send is admitted.
    disconnecting: usize,
    /// Changes when a disconnect starts and when it ends, so a Send that read provider status
    /// across one is refused.
    account_generation: u64,
}

impl Inner {
    fn next_revision(&mut self) -> u64 {
        self.revision += 1;
        self.revision
    }

    /// The conversation changed: it takes the next revision.
    fn touch(&mut self, conversation_id: &str) {
        let revision = self.next_revision();
        if let Some(live) = self.live.get_mut(conversation_id) {
            live.revision = revision;
        }
    }

    /// The vault of an open, not closing, visit of this window.
    fn vault_of(&self, owner: &str, visit_id: &str) -> Option<String> {
        self.visits
            .get(visit_id)
            .filter(|visit| visit.owner == owner && !visit.closing)
            .map(|visit| visit.vault.clone())
    }
}

/// Which disclosure the person accepted, and when. Kept locally; never sent.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Consent {
    provider: ProviderId,
    disclosure_version: String,
    at: String,
}

pub(crate) struct Host {
    root: PathBuf,
    store: Store,
    codex: Box<dyn Provider>,
    inner: Mutex<Inner>,
    settled: Condvar,
    stop_wait: Duration,
}

fn claude_state() -> ProviderState {
    ProviderState::Unavailable {
        reason: UnavailableReason::NotAuthorized,
        installed_version: None,
    }
}

fn vault_key(roots: &VaultRoots) -> String {
    hex_sha256(roots.canonical.to_string_lossy().as_bytes())
}

/// What a local write left behind.
fn storage_of(written: std::io::Result<Published>) -> Storage {
    match written {
        Ok(Published::Durable) => Storage::Saved,
        Ok(Published::Unsynced) => Storage::Unconfirmed,
        Err(error) => {
            log::warn!("An Adapt conversation could not be saved locally: {error}");
            Storage::Unsaved
        }
    }
}

fn summary_of(record: &Record, running: bool) -> ConversationSummary {
    ConversationSummary {
        conversation_id: record.conversation_id.clone(),
        updated_at: record.updated_at.clone(),
        title: record.title.clone(),
        turns: record.turns(),
        running,
    }
}

fn snapshot_of(conversation_id: &str, live: &Live) -> Conversation {
    Conversation {
        conversation_id: conversation_id.to_string(),
        revision: live.revision,
        entries: live.record.entries.clone(),
        turn: live.running.as_ref().map(|running| RunningTurn {
            turn_id: running.turn_id.clone(),
            phase: running.phase,
        }),
        storage: live.storage,
    }
}

/// The outcome entry a finished turn gets, or `None` while its work is not proven ended: then no
/// entry is written and the turn stays open. Otherwise admission closed always wins. A changed
/// account means no answer is admitted, but a failure keeps its own reason: it carries nothing to
/// admit, and a provider that marks itself signed out because this very turn was refused has not
/// changed account.
fn outcome_entry(
    turn_id: &str,
    running: &Running,
    account_epoch: u64,
    outcome: TurnOutcome,
) -> Option<Entry> {
    let turn_id = turn_id.to_string();
    let at = now();
    let stopped = |reason| {
        Some(Entry::Stopped {
            turn_id: turn_id.clone(),
            at: at.clone(),
            reason,
            confirmed: true,
        })
    };
    let failed = |reason, resets_at| {
        Some(Entry::Failed {
            turn_id: turn_id.clone(),
            at: at.clone(),
            reason,
            resets_at,
        })
    };
    let account_changed = account_epoch != running.account_epoch;
    match (running.stop, outcome) {
        (_, TurnOutcome::Unconfirmed) => None,
        (Some(reason), _) => stopped(reason),
        (None, TurnOutcome::Reply(_) | TurnOutcome::Stopped) if account_changed => {
            stopped(StopReason::AccountChanged)
        }
        (None, TurnOutcome::Reply(reply)) => match check::check_reply(&reply) {
            Ok(()) => Some(Entry::Reply {
                turn_id: turn_id.clone(),
                at: at.clone(),
                reply,
            }),
            Err(check::ReplyFault::TooLarge) => failed(Failure::OutputTooLarge, None),
            Err(check::ReplyFault::Invalid) => failed(Failure::InvalidOutput, None),
        },
        (None, TurnOutcome::Failed { reason, resets_at }) => {
            let resets_at =
                resets_at.filter(|reset| reason == Failure::UsageLimit && is_instant(reset));
            failed(reason, resets_at)
        }
        // The provider says it stopped, but nobody asked it to.
        (None, TurnOutcome::Stopped) => failed(Failure::ProviderFailed, None),
    }
}

impl Host {
    pub(crate) fn new(root: PathBuf, codex: Box<dyn Provider>) -> Self {
        let store = Store::new(root.join("conversations"));
        Self::with_store(root, store, codex, Duration::from_secs(15))
    }

    pub(crate) fn with_store(
        root: PathBuf,
        store: Store,
        codex: Box<dyn Provider>,
        stop_wait: Duration,
    ) -> Self {
        Self {
            root,
            store,
            codex,
            inner: Mutex::new(Inner::default()),
            settled: Condvar::new(),
            stop_wait,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Loads a conversation of this vault into memory once. A turn found still waiting was cut
    /// off when the app last quit: it is stopped, unproven, and saved if it can be.
    fn live_mut<'i>(
        &self,
        inner: &'i mut Inner,
        vault: &str,
        conversation_id: &str,
    ) -> Option<&'i mut Live> {
        if !inner.live.contains_key(conversation_id) {
            let mut record = self.store.load(vault, conversation_id)?;
            let mut storage = Storage::Saved;
            if let Some(turn_id) = record.waiting().map(str::to_string) {
                record.entries.push(Entry::Stopped {
                    turn_id,
                    at: now(),
                    reason: StopReason::AppClosed,
                    confirmed: false,
                });
                record.updated_at = now();
                storage = storage_of(self.store.save(vault, &record));
            }
            let revision = inner.next_revision();
            inner.live.insert(
                conversation_id.to_string(),
                Live::new(vault.to_string(), record, revision, storage),
            );
        }
        inner
            .live
            .get_mut(conversation_id)
            .filter(|live| live.vault == vault)
    }

    // --- Providers ----------------------------------------------------------------------------------

    pub(crate) fn status(&self) -> StatusReply {
        let codex = self.codex.snapshot();
        StatusReply {
            revision: codex.revision,
            providers: Providers {
                codex: codex.state,
                claude: claude_state(),
            },
        }
    }

    /// Only from an explicit Connect. The accepted disclosure is recorded before anything starts.
    pub(crate) fn connect(
        &self,
        args: &ConnectArgs,
        open_browser: &dyn Fn(&str) -> bool,
    ) -> Result<ConnectReply, String> {
        if !check::is_token(&args.disclosure_version) {
            return Err("The disclosure version could not be read.".to_string());
        }
        let refused = |reason| Ok(ConnectReply::Refused { reason });
        if args.provider == ProviderId::Claude {
            return refused(ConnectRefusal::Unavailable);
        }
        if self.lock().disconnecting > 0 {
            return refused(ConnectRefusal::Busy);
        }
        match self.codex.snapshot().state {
            ProviderState::SignedOut { .. } => {}
            ProviderState::Connecting => return refused(ConnectRefusal::Busy),
            ProviderState::Connected | ProviderState::Refused { .. } => {
                return refused(ConnectRefusal::AlreadyConnected)
            }
            ProviderState::Unavailable { .. } => return refused(ConnectRefusal::Unavailable),
        }
        if let Err(error) = self.record_consent(args.provider, &args.disclosure_version) {
            log::warn!("Adapt sign-in consent could not be recorded: {error}");
            return refused(ConnectRefusal::Unavailable);
        }
        Ok(self.codex.connect(open_browser))
    }

    fn record_consent(
        &self,
        provider: ProviderId,
        disclosure_version: &str,
    ) -> std::io::Result<()> {
        let path = self.root.join(CONSENT_FILE);
        let mut consents: Vec<Consent> = store::read_bounded(&path, CONSENT_BYTES)
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        consents.push(Consent {
            provider,
            disclosure_version: disclosure_version.to_string(),
            at: now(),
        });
        let excess = consents.len().saturating_sub(MAX_CONSENTS);
        consents.drain(..excess);
        let bytes = serde_json::to_vec_pretty(&consents).map_err(std::io::Error::other)?;
        store::private_dir(&self.root)?;
        self.store.write(&self.root, &path, &bytes).map(drop)
    }

    pub(crate) fn cancel_connect(&self, args: &ProviderArgs) -> CancelConnectReply {
        match args.provider {
            ProviderId::Claude => CancelConnectReply::NotConnecting,
            ProviderId::Codex => self.codex.cancel_connect(),
        }
    }

    /// Closes admission first, then stops every running turn (`accountChanged`), then signs out.
    /// `stopping` when signed out but some stopped work is not yet proven ended.
    pub(crate) fn disconnect(&self, args: &ProviderArgs) -> DisconnectReply {
        if args.provider == ProviderId::Claude {
            return DisconnectReply::Refused {
                reason: DisconnectRefusal::Unavailable,
            };
        }
        let mut inner = self.lock();
        inner.disconnecting += 1;
        inner.account_generation += 1;
        let stopping = self.stop_where(&mut inner, StopReason::AccountChanged, |_| true);
        let (inner, proven) = self.wait_stopped(inner, &stopping);
        drop(inner);
        let signed_out = self.codex.disconnect();
        let mut inner = self.lock();
        inner.disconnecting -= 1;
        inner.account_generation += 1;
        match signed_out {
            DisconnectReply::Disconnected if !proven => DisconnectReply::Stopping,
            other => other,
        }
    }

    // --- Visits -------------------------------------------------------------------------------------

    pub(crate) fn open_visit(&self, owner: &str, roots: Option<&VaultRoots>) -> OpenVisitReply {
        let refused = |reason| OpenVisitReply::Refused { reason };
        let Some(roots) = roots else {
            return refused(VisitRefusal::VaultUnavailable);
        };
        let vault = vault_key(roots);
        if let Err(error) = self.store.prepare(&vault) {
            log::warn!("Adapt conversations could not be stored: {error}");
            return refused(VisitRefusal::StorageUnavailable);
        }
        let visit_id = format!("visit-{}", uuid::Uuid::new_v4());
        let mut inner = self.lock();
        let mut owned: Vec<(u64, String)> = inner
            .visits
            .iter()
            .filter(|(_, visit)| visit.owner == owner)
            .map(|(id, visit)| (visit.opened, id.clone()))
            .collect();
        owned.sort();
        while owned.len() >= MAX_VISITS_PER_OWNER {
            let (_, oldest) = owned.remove(0);
            self.end_visit(&mut inner, &oldest);
        }
        let opened = inner.next_revision();
        inner.visits.insert(
            visit_id.clone(),
            Visit {
                owner: owner.to_string(),
                vault,
                opened,
                closing: false,
            },
        );
        OpenVisitReply::Open { visit_id }
    }

    /// Removes the visit at once and stops its turns without waiting, for a window that is gone.
    fn end_visit(&self, inner: &mut Inner, visit_id: &str) {
        let Some(visit) = inner.visits.remove(visit_id) else {
            return;
        };
        self.stop_where(inner, StopReason::VisitClosed, |running| {
            running.visit_id == visit_id
        });
        self.forget_idle(inner, &visit.vault);
    }

    /// Stops the visit's turns; `closed` once each is proven ended, `stopping` until then. The
    /// visit keeps closing, and answering only this, until a close finds them ended.
    pub(crate) fn close_visit(&self, owner: &str, args: &VisitArgs) -> CloseVisitReply {
        let mut inner = self.lock();
        match inner.visits.get_mut(&args.visit_id) {
            Some(visit) if visit.owner == owner => visit.closing = true,
            _ => return CloseVisitReply::Unknown,
        }
        let stopping = self.stop_where(&mut inner, StopReason::VisitClosed, |running| {
            running.visit_id == args.visit_id
        });
        let (mut inner, proven) = self.wait_stopped(inner, &stopping);
        if !proven {
            return CloseVisitReply::Stopping;
        }
        if let Some(visit) = inner.visits.remove(&args.visit_id) {
            self.forget_idle(&mut inner, &visit.vault);
        }
        CloseVisitReply::Closed
    }

    /// A window closed or began loading a page: its visits end now, without waiting.
    pub(crate) fn forget_owner(&self, owner: &str) {
        let mut inner = self.lock();
        let owned: Vec<String> = inner
            .visits
            .iter()
            .filter(|(_, visit)| visit.owner == owner)
            .map(|(id, _)| id.clone())
            .collect();
        for visit_id in owned {
            self.end_visit(&mut inner, &visit_id);
        }
    }

    /// The app is quitting: every turn stops, briefly waited for; anything unsaved gets one more
    /// local save; the provider ends any sign-in.
    pub(crate) fn shutdown(&self) {
        let mut inner = self.lock();
        let stopping = self.stop_where(&mut inner, StopReason::AppClosed, |_| true);
        let (mut inner, _) = self.wait_stopped(inner, &stopping);
        for live in inner.live.values_mut() {
            if live.storage == Storage::Unsaved {
                live.storage = storage_of(self.store.save(&live.vault, &live.record));
            }
        }
        drop(inner);
        self.codex.shutdown();
    }

    /// Conversations no open visit of their vault can reach leave memory, but only once idle and
    /// saved: an unsaved or unconfirmed one stays, so it is never silently lost.
    fn forget_idle(&self, inner: &mut Inner, vault: &str) {
        if inner.visits.values().any(|visit| visit.vault == vault) {
            return;
        }
        inner.live.retain(|_, live| {
            live.vault != vault || live.running.is_some() || live.storage != Storage::Saved
        });
    }

    /// Closes admission for every matching running turn and asks its provider work to end.
    fn stop_where(
        &self,
        inner: &mut Inner,
        reason: StopReason,
        matches: impl Fn(&Running) -> bool,
    ) -> Vec<(String, String)> {
        let mut stopping = Vec::new();
        let mut changed = Vec::new();
        for (conversation_id, live) in &mut inner.live {
            let Some(running) = live.running.as_mut() else {
                continue;
            };
            if !matches(running) {
                continue;
            }
            if stop_running(running, reason) {
                changed.push(conversation_id.clone());
            }
            stopping.push((conversation_id.clone(), running.turn_id.clone()));
        }
        for conversation_id in changed {
            inner.touch(&conversation_id);
        }
        stopping
    }

    /// Waits, at most `stop_wait`, for those of `turns` that can still end; an unconfirmed turn will
    /// not end in this process, so nothing waits for it. Answers whether every one is proven ended.
    fn wait_stopped<'g>(
        &self,
        guard: MutexGuard<'g, Inner>,
        turns: &[(String, String)],
    ) -> (MutexGuard<'g, Inner>, bool) {
        let settling =
            |inner: &mut Inner| open_turns(inner, turns).any(|running| !running.unconfirmed);
        let (guard, _) = self
            .settled
            .wait_timeout_while(guard, self.stop_wait, settling)
            .unwrap_or_else(PoisonError::into_inner);
        let proven = open_turns(&guard, turns).next().is_none();
        (guard, proven)
    }

    // --- Conversations ------------------------------------------------------------------------------

    pub(crate) fn list(&self, owner: &str, args: &VisitArgs) -> ListConversationsReply {
        let inner = self.lock();
        let Some(vault) = inner.vault_of(owner, &args.visit_id) else {
            return ListConversationsReply::UnknownVisit;
        };
        let mut summaries: HashMap<String, ConversationSummary> = self
            .store
            .list(&vault)
            .iter()
            .map(|record| (record.conversation_id.clone(), summary_of(record, false)))
            .collect();
        for live in inner.live.values().filter(|live| live.vault == vault) {
            summaries.insert(
                live.record.conversation_id.clone(),
                summary_of(&live.record, live.running.is_some()),
            );
        }
        let mut conversations: Vec<ConversationSummary> = summaries.into_values().collect();
        conversations.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.conversation_id.cmp(&right.conversation_id))
        });
        conversations.truncate(CONVERSATIONS_PER_VAULT);
        ListConversationsReply::Ok { conversations }
    }

    /// At the limit, only an empty conversation that was never sent may make room.
    pub(crate) fn new_conversation(&self, owner: &str, args: &VisitArgs) -> NewConversationReply {
        let refused = |reason| NewConversationReply::Refused { reason };
        let mut inner = self.lock();
        let Some(vault) = inner.vault_of(owner, &args.visit_id) else {
            return NewConversationReply::UnknownVisit;
        };
        let mut kept: HashMap<String, (String, bool)> = self
            .store
            .list(&vault)
            .into_iter()
            .map(|record| {
                let empty = record.entries.is_empty();
                (record.conversation_id, (record.updated_at, empty))
            })
            .collect();
        for live in inner.live.values().filter(|live| live.vault == vault) {
            let empty = live.record.entries.is_empty() && live.running.is_none();
            kept.insert(
                live.record.conversation_id.clone(),
                (live.record.updated_at.clone(), empty),
            );
        }
        if kept.len() >= CONVERSATIONS_PER_VAULT {
            let placeholder = kept
                .iter()
                .filter(|(_, (_, empty))| *empty)
                .min_by(|left, right| left.1 .0.cmp(&right.1 .0))
                .map(|(id, _)| id.clone());
            let Some(placeholder) = placeholder else {
                return refused(NewConversationRefusal::ConversationLimit);
            };
            if let Err(error) = self.store.delete(&vault, &placeholder) {
                log::warn!("An empty Adapt conversation could not be removed: {error}");
                return refused(NewConversationRefusal::StorageUnavailable);
            }
            inner.live.remove(&placeholder);
        }
        let conversation_id = format!("conversation-{}", uuid::Uuid::new_v4());
        let record = Record::new(conversation_id.clone(), now());
        let storage = match self.store.save(&vault, &record) {
            Ok(Published::Durable) => Storage::Saved,
            Ok(Published::Unsynced) => Storage::Unconfirmed,
            Err(error) => {
                log::warn!("An Adapt conversation could not be stored: {error}");
                return refused(NewConversationRefusal::StorageUnavailable);
            }
        };
        let revision = inner.next_revision();
        inner.live.insert(
            conversation_id.clone(),
            Live::new(vault, record, revision, storage),
        );
        NewConversationReply::Created { conversation_id }
    }

    pub(crate) fn read(&self, owner: &str, args: &ReadConversationArgs) -> ReadConversationReply {
        let mut inner = self.lock();
        let Some(vault) = inner.vault_of(owner, &args.visit_id) else {
            return ReadConversationReply::UnknownVisit;
        };
        let Some(live) = self.live_mut(&mut inner, &vault, &args.conversation_id) else {
            return ReadConversationReply::UnknownConversation;
        };
        if args.known_revision == Some(live.revision) {
            return ReadConversationReply::Unchanged {
                revision: live.revision,
            };
        }
        ReadConversationReply::Ok {
            conversation: snapshot_of(&args.conversation_id, live),
        }
    }

    /// Writes the conversation as shown again. Local only: no provider is involved.
    pub(crate) fn save(&self, owner: &str, args: &ConversationArgs) -> SaveConversationReply {
        let mut inner = self.lock();
        let Some(vault) = inner.vault_of(owner, &args.visit_id) else {
            return SaveConversationReply::UnknownVisit;
        };
        let Some(live) = self.live_mut(&mut inner, &vault, &args.conversation_id) else {
            return SaveConversationReply::UnknownConversation;
        };
        let storage = storage_of(self.store.save(&vault, &live.record));
        let changed = live.storage != storage;
        live.storage = storage;
        if changed {
            inner.touch(&args.conversation_id);
        }
        match storage {
            Storage::Saved => SaveConversationReply::Saved,
            Storage::Unconfirmed => SaveConversationReply::Unconfirmed,
            Storage::Unsaved => SaveConversationReply::Unsaved,
        }
    }

    /// A conversation whose file is gone is deleted, even if its folder could not be synced.
    pub(crate) fn delete(&self, owner: &str, args: &ConversationArgs) -> DeleteConversationReply {
        let mut inner = self.lock();
        let Some(vault) = inner.vault_of(owner, &args.visit_id) else {
            return DeleteConversationReply::UnknownVisit;
        };
        let Some(live) = self.live_mut(&mut inner, &vault, &args.conversation_id) else {
            return DeleteConversationReply::UnknownConversation;
        };
        if live.running.is_some() {
            return DeleteConversationReply::Refused {
                reason: DeleteRefusal::Running,
            };
        }
        if let Err(error) = self.store.delete(&vault, &args.conversation_id) {
            log::warn!("An Adapt conversation could not be deleted: {error}");
            return DeleteConversationReply::Refused {
                reason: DeleteRefusal::StorageUnavailable,
            };
        }
        inner.live.remove(&args.conversation_id);
        DeleteConversationReply::Deleted
    }

    // --- Turns --------------------------------------------------------------------------------------

    /// Admits one turn and starts it on its own thread with exactly the payload named here. The
    /// provider status it relies on must not have crossed a disconnect.
    pub(crate) fn send(self: &Arc<Self>, owner: &str, args: &SendArgs) -> SendReply {
        let refused = |reason| SendReply::Refused { reason };
        let generation = self.lock().account_generation;
        let codex = self.codex.snapshot();
        let mut inner = self.lock();
        let admitting = inner.disconnecting == 0 && inner.account_generation == generation;
        let Some(vault) = inner.vault_of(owner, &args.visit_id) else {
            return refused(SendRefusal::UnknownVisit);
        };
        let Some(live) = self.live_mut(&mut inner, &vault, &args.conversation_id) else {
            return refused(SendRefusal::UnknownConversation);
        };
        if let Err(reason) = check::check_send(args) {
            return refused(reason);
        }
        if live.tombstones.contains(&args.turn_id) {
            return refused(SendRefusal::Cancelled);
        }
        if live.record.request(&args.turn_id).is_some() {
            return refused(SendRefusal::Replayed);
        }
        if live.running.is_some() || live.sealed {
            return refused(SendRefusal::Busy);
        }
        if live.record.turns() >= TURNS_PER_CONVERSATION {
            return refused(SendRefusal::ConversationFull);
        }
        match (args.provider, &codex.state) {
            (ProviderId::Codex, ProviderState::Connected) if admitting => {}
            (ProviderId::Codex, ProviderState::Unavailable { .. }) | (ProviderId::Claude, _) => {
                return refused(SendRefusal::ProviderUnavailable)
            }
            (ProviderId::Codex, _) => return refused(SendRefusal::NotConnected),
        }
        let payload = match self.payload_for(&live.record, args) {
            Ok(payload) => payload,
            Err(reason) => return refused(reason),
        };

        let summaries = args
            .attachments
            .iter()
            .map(|item| AttachmentSummary {
                kind: item.kind,
                label: item.label.clone(),
                bytes: item.text.len() as u64,
                sha256: hex_sha256(item.text.as_bytes()),
            })
            .collect();
        let before = live.record.clone();
        live.record.entries.push(Entry::Request {
            turn_id: args.turn_id.clone(),
            at: now(),
            provider: args.provider,
            text: args.request.clone(),
            attachments: summaries,
            included_turn_ids: args.include_turn_ids.clone(),
            revision: args.revision.clone(),
            guide: prompt::guide_version(),
        });
        if live.record.title.is_empty() {
            live.record.title = check::title_of(&args.request);
        }
        live.record.updated_at = now();
        // Not written: nothing is sent. Written but unsynced: it is in place, so the turn runs.
        live.storage = match self.store.save(&vault, &live.record) {
            Ok(Published::Durable) => Storage::Saved,
            Ok(Published::Unsynced) => Storage::Unconfirmed,
            Err(error) => {
                log::warn!("An Adapt request could not be stored: {error}");
                live.record = before;
                return refused(SendRefusal::StorageUnavailable);
            }
        };
        let control = Arc::new(TurnControl::new(
            self.phase_reporter(&args.conversation_id, &args.turn_id),
        ));
        live.running = Some(Running {
            turn_id: args.turn_id.clone(),
            visit_id: args.visit_id.clone(),
            phase: TurnPhase::Sending,
            control: Arc::clone(&control),
            stop: None,
            account_epoch: codex.account_epoch,
            unconfirmed: false,
        });
        inner.touch(&args.conversation_id);
        drop(inner);
        self.start(&args.conversation_id, &args.turn_id, payload, control);
        SendReply::Admitted {
            turn_id: args.turn_id.clone(),
        }
    }

    /// The payload, or why it cannot be sent: the included turns must be finished turns of this
    /// conversation, and everything together within `PAYLOAD_BYTES`.
    fn payload_for(&self, record: &Record, args: &SendArgs) -> Result<Payload, SendRefusal> {
        let mut prior = Vec::new();
        for turn_id in &args.include_turn_ids {
            let (Some(Entry::Request { text, .. }), Some(outcome)) =
                (record.request(turn_id), record.outcome(turn_id))
            else {
                return Err(SendRefusal::InvalidRequest);
            };
            let reply = match outcome {
                Entry::Reply { reply, .. } => Some(reply),
                _ => None,
            };
            prior.push(PriorTurn {
                request: text.as_str(),
                reply,
            });
        }
        let total = args.request.len()
            + args
                .attachments
                .iter()
                .map(|item| item.text.len())
                .sum::<usize>()
            + prior.iter().map(prompt::prior_bytes).sum::<usize>();
        if total > PAYLOAD_BYTES {
            return Err(SendRefusal::TooLarge);
        }
        Ok(prompt::build(
            &args.request,
            &args.attachments,
            &prior,
            args.revision.as_ref(),
        ))
    }

    fn phase_reporter(
        self: &Arc<Self>,
        conversation_id: &str,
        turn_id: &str,
    ) -> Box<dyn Fn(TurnPhase) + Send + Sync> {
        let host = Arc::downgrade(self);
        let (conversation_id, turn_id) = (conversation_id.to_string(), turn_id.to_string());
        Box::new(move |phase| {
            if let Some(host) = host.upgrade() {
                host.set_phase(&conversation_id, &turn_id, phase);
            }
        })
    }

    fn set_phase(&self, conversation_id: &str, turn_id: &str, phase: TurnPhase) {
        let mut inner = self.lock();
        let running = inner
            .live
            .get_mut(conversation_id)
            .and_then(|live| live.running.as_mut())
            .filter(|running| {
                running.turn_id == turn_id
                    && running.stop.is_none()
                    && !running.unconfirmed
                    && running.phase != phase
                    && phase != TurnPhase::Stopping
            });
        if let Some(running) = running {
            running.phase = phase;
            inner.touch(conversation_id);
        }
    }

    fn start(
        self: &Arc<Self>,
        conversation_id: &str,
        turn_id: &str,
        payload: Payload,
        control: Arc<TurnControl>,
    ) {
        let host = Arc::clone(self);
        let (conversation, turn) = (conversation_id.to_string(), turn_id.to_string());
        let spawned = std::thread::Builder::new()
            .name("leadinglight-adapt-turn".to_string())
            .spawn(move || {
                // A provider that panicked cannot prove its work ended.
                let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    host.codex.run_turn(&payload, &control)
                }))
                .unwrap_or(TurnOutcome::Unconfirmed);
                host.finish(&conversation, &turn, outcome);
            });
        // No thread, so no provider work was ever started: an ordinary failure.
        if spawned.is_err() {
            self.finish(
                conversation_id,
                turn_id,
                TurnOutcome::Failed {
                    reason: Failure::ProviderFailed,
                    resets_at: None,
                },
            );
        }
    }

    /// The provider returned for this turn. Its outcome is admitted only if the turn is still the
    /// running one, not stopped, and under the same account. The outcome stays in memory whatever
    /// the local write does, and the conversation says how that went. An outcome that does not
    /// prove the work ended writes nothing: the turn stays open as stopping.
    fn finish(&self, conversation_id: &str, turn_id: &str, outcome: TurnOutcome) {
        let account_epoch = self.codex.snapshot().account_epoch;
        let mut inner = self.lock();
        let mut changed = false;
        if let Some(live) = inner.live.get_mut(conversation_id) {
            if let Some(running) = live
                .running
                .as_mut()
                .filter(|running| running.turn_id == turn_id)
            {
                match outcome_entry(turn_id, running, account_epoch, outcome) {
                    None => {
                        running.unconfirmed = true;
                        running.phase = TurnPhase::Stopping;
                    }
                    Some(entry) => {
                        live.running = None;
                        live.record.entries.push(entry);
                        live.record.updated_at = now();
                        live.storage = storage_of(self.store.save(&live.vault, &live.record));
                    }
                }
                changed = true;
            }
        }
        if changed {
            inner.touch(conversation_id);
        }
        drop(inner);
        self.settled.notify_all();
    }

    /// Closes admission for exactly this conversation's turn at once; `stopped` once the provider
    /// work is proven ended. Any open visit of the conversation's vault, from the window that opened
    /// it, may cancel; no other conversation is touched.
    pub(crate) fn cancel(&self, owner: &str, args: &TurnArgs) -> CancelTurnReply {
        let mut inner = self.lock();
        let Some(vault) = inner.vault_of(owner, &args.visit_id) else {
            return CancelTurnReply::UnknownVisit;
        };
        let Some(live) = self.live_mut(&mut inner, &vault, &args.conversation_id) else {
            return CancelTurnReply::UnknownConversation;
        };
        let changed = match live.running.as_mut() {
            Some(running) if running.turn_id == args.turn_id => {
                stop_running(running, StopReason::Cancelled)
            }
            _ => {
                if live.record.request(&args.turn_id).is_some() {
                    return CancelTurnReply::Finished;
                }
                // Never admitted; an id that is no turn id can never be.
                if check::is_turn_id(&args.turn_id) {
                    if live.tombstones.len() >= MAX_TOMBSTONES {
                        live.sealed = true;
                    } else {
                        live.tombstones.insert(args.turn_id.clone());
                    }
                }
                return CancelTurnReply::Stopped;
            }
        };
        if changed {
            inner.touch(&args.conversation_id);
        }
        let this = [(args.conversation_id.clone(), args.turn_id.clone())];
        let (inner, proven) = self.wait_stopped(inner, &this);
        // Nothing more to read or change: the lock is released before answering.
        drop(inner);
        if proven {
            CancelTurnReply::Stopped
        } else {
            CancelTurnReply::Stopping
        }
    }
}

/// Those of `turns` that are still their conversation's running turn.
fn open_turns<'a>(
    inner: &'a Inner,
    turns: &'a [(String, String)],
) -> impl Iterator<Item = &'a Running> + 'a {
    turns.iter().filter_map(move |(conversation_id, turn_id)| {
        inner
            .live
            .get(conversation_id)
            .and_then(|live| live.running.as_ref())
            .filter(|running| &running.turn_id == turn_id)
    })
}

/// Closes this turn's admission and asks its work to end; answers whether that is new.
fn stop_running(running: &mut Running, reason: StopReason) -> bool {
    if running.stop.is_some() {
        return false;
    }
    running.stop = Some(reason);
    running.phase = TurnPhase::Stopping;
    running.control.cancel();
    true
}
