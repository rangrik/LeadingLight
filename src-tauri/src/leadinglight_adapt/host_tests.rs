//! Visits, conversations and turns through `Host`, in a disposable app-data folder, with a scripted
//! provider and a store whose writes can be made to fail. A held turn waits on a channel, so every
//! interleaving below happens in the order written; the waits only wait for completion.

use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use tempfile::TempDir;

use super::host::Host;
use super::prompt::Payload;
use super::provider::{Provider, ProviderSnapshot, TurnControl, TurnOutcome};
use super::store::{Record, Store};
use super::store_tests::{set, Faults, FaultyIo};
use super::wire::{
    Attachment, AttachmentKind, CancelConnectReply, CancelTurnReply, CloseVisitReply, ConnectArgs,
    ConnectRefusal, ConnectReply, Conversation, ConversationArgs, DeleteConversationReply,
    DeleteRefusal, DisconnectReply, Entry, Failure, ListConversationsReply, NewConversationRefusal,
    NewConversationReply, OpenVisitReply, ProviderArgs, ProviderId, ProviderState,
    ReadConversationArgs, ReadConversationReply, Reply, RevisionBase, SaveConversationReply,
    SendArgs, SendRefusal, SendReply, StopReason, Storage, TurnArgs, TurnPhase, UnavailableReason,
    VisitArgs,
};
use super::{hex_sha256, now};
use crate::leadinglight_history::VaultRoots;

const SETTLE: Duration = Duration::from_secs(5);

enum Behaviour {
    Answer(TurnOutcome),
    /// The provider finds itself signed out during the turn, as Codex does when its sign-in is
    /// refused, and answers this.
    SignsOut(TurnOutcome),
    /// Waits until released, then answers. With `honours_cancel`, ends as soon as it is cancelled.
    Hold {
        release: mpsc::Receiver<()>,
        answer: TurnOutcome,
        honours_cancel: bool,
    },
    /// Waits until released, cancelled or not, then cannot prove its work ended, as when a
    /// provider's process group cannot be killed and reaped.
    Unproven {
        release: mpsc::Receiver<()>,
    },
    /// The provider panics in the middle of the turn.
    Panics,
}

type Pause = Mutex<Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>>;

struct Fake {
    state: Mutex<ProviderState>,
    revision: AtomicU64,
    epoch: AtomicU64,
    script: Mutex<VecDeque<Behaviour>>,
    payloads: Mutex<Vec<Payload>>,
    turns: AtomicUsize,
    sign_ins: AtomicUsize,
    /// The next status read is taken, then held until released, then answered as taken.
    snapshot_pause: Pause,
}

impl Fake {
    fn new(state: ProviderState) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(state),
            revision: AtomicU64::new(1),
            epoch: AtomicU64::new(1),
            script: Mutex::new(VecDeque::new()),
            payloads: Mutex::new(Vec::new()),
            turns: AtomicUsize::new(0),
            sign_ins: AtomicUsize::new(0),
            snapshot_pause: Mutex::new(None),
        })
    }

    fn connected() -> Arc<Self> {
        Self::new(ProviderState::Connected)
    }

    fn then(&self, behaviour: Behaviour) {
        self.script.lock().unwrap().push_back(behaviour);
    }

    fn set_state(&self, state: ProviderState) {
        *self.state.lock().unwrap() = state;
        self.revision.fetch_add(1, Ordering::SeqCst);
    }

    fn payload(&self, index: usize) -> Payload {
        self.payloads.lock().unwrap()[index].clone()
    }

    /// Answers `(taken, release)` for the next status read.
    fn pause_next_snapshot(&self) -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
        let (taken_tx, taken) = mpsc::channel();
        let (release, release_rx) = mpsc::channel();
        *self.snapshot_pause.lock().unwrap() = Some((taken_tx, release_rx));
        (taken, release)
    }
}

struct Scripted(Arc<Fake>);

impl Provider for Scripted {
    fn snapshot(&self) -> ProviderSnapshot {
        let snapshot = ProviderSnapshot {
            revision: self.0.revision.load(Ordering::SeqCst),
            state: self.0.state.lock().unwrap().clone(),
            account_epoch: self.0.epoch.load(Ordering::SeqCst),
        };
        let pause = self.0.snapshot_pause.lock().unwrap().take();
        if let Some((taken, release)) = pause {
            let _ = taken.send(());
            let _ = release.recv();
        }
        snapshot
    }

    fn connect(&self, open_browser: &dyn Fn(&str) -> bool) -> ConnectReply {
        self.0.sign_ins.fetch_add(1, Ordering::SeqCst);
        if open_browser("https://auth.openai.com/oauth/authorize") {
            self.0.set_state(ProviderState::Connecting);
            ConnectReply::Started
        } else {
            ConnectReply::Refused {
                reason: ConnectRefusal::BrowserUnavailable,
            }
        }
    }

    fn cancel_connect(&self) -> CancelConnectReply {
        CancelConnectReply::NotConnecting
    }

    fn disconnect(&self) -> DisconnectReply {
        self.0
            .set_state(ProviderState::SignedOut { last_connect: None });
        self.0.epoch.fetch_add(1, Ordering::SeqCst);
        DisconnectReply::Disconnected
    }

    fn run_turn(&self, payload: &Payload, control: &TurnControl) -> TurnOutcome {
        self.0.turns.fetch_add(1, Ordering::SeqCst);
        self.0.payloads.lock().unwrap().push(payload.clone());
        control.report(TurnPhase::Working);
        let behaviour = self.0.script.lock().unwrap().pop_front();
        match behaviour {
            None => TurnOutcome::Failed {
                reason: Failure::ProviderFailed,
                resets_at: None,
            },
            Some(Behaviour::Answer(outcome)) => outcome,
            Some(Behaviour::SignsOut(outcome)) => {
                self.0
                    .set_state(ProviderState::SignedOut { last_connect: None });
                self.0.epoch.fetch_add(1, Ordering::SeqCst);
                outcome
            }
            Some(Behaviour::Hold {
                release,
                answer,
                honours_cancel,
            }) => loop {
                if honours_cancel && control.is_cancelled() {
                    return TurnOutcome::Stopped;
                }
                match release.recv_timeout(Duration::from_millis(5)) {
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    _ => return answer,
                }
            },
            Some(Behaviour::Unproven { release }) => {
                let _ = release.recv();
                TurnOutcome::Unconfirmed
            }
            Some(Behaviour::Panics) => panic!("the scripted provider failed mid-turn"),
        }
    }
}

fn unproven() -> (Behaviour, mpsc::Sender<()>) {
    let (release, waiting) = mpsc::channel();
    (Behaviour::Unproven { release: waiting }, release)
}

fn candidate(package_text: &str) -> TurnOutcome {
    TurnOutcome::Reply(Reply::Candidate {
        message: "Here is a weekly review.".to_string(),
        package_text: package_text.to_string(),
    })
}

fn held(answer: TurnOutcome, honours_cancel: bool) -> (Behaviour, mpsc::Sender<()>) {
    let (release, waiting) = mpsc::channel();
    let behaviour = Behaviour::Hold {
        release: waiting,
        answer,
        honours_cancel,
    };
    (behaviour, release)
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

struct World {
    dir: TempDir,
    vault: PathBuf,
    fake: Arc<Fake>,
    faults: Arc<Faults>,
    host: Arc<Host>,
}

/// How long a cancel, close or disconnect waits for proof before answering `stopping`.
const STOP_WAIT: Duration = Duration::from_millis(300);

fn world(fake: Arc<Fake>) -> World {
    world_waiting(fake, STOP_WAIT)
}

fn world_waiting(fake: Arc<Fake>, stop_wait: Duration) -> World {
    let dir = tempfile::tempdir().unwrap();
    let vault = dir.path().join("vault");
    fs::create_dir_all(&vault).unwrap();
    let faults = Arc::new(Faults::default());
    let host = host_at(&dir, &fake, &faults, stop_wait);
    World {
        dir,
        vault,
        fake,
        faults,
        host,
    }
}

fn host_at(
    dir: &TempDir,
    fake: &Arc<Fake>,
    faults: &Arc<Faults>,
    stop_wait: Duration,
) -> Arc<Host> {
    let root = dir.path().join("adapt");
    let store = Store::with_io(
        root.join("conversations"),
        Arc::new(FaultyIo(Arc::clone(faults))),
    );
    Arc::new(Host::with_store(
        root,
        store,
        Box::new(Scripted(Arc::clone(fake))),
        stop_wait,
    ))
}

impl World {
    /// The same app data after a restart, with a provider that is signed out.
    fn restarted(self) -> World {
        let fake = Fake::new(ProviderState::SignedOut { last_connect: None });
        let faults = Arc::new(Faults::default());
        World {
            host: host_at(&self.dir, &fake, &faults, STOP_WAIT),
            fake,
            faults,
            vault: self.vault,
            dir: self.dir,
        }
    }

    fn roots(&self) -> VaultRoots {
        VaultRoots {
            requested: self.vault.clone(),
            canonical: self.vault.canonicalize().unwrap(),
        }
    }

    fn vault_key(&self) -> String {
        hex_sha256(self.roots().canonical.to_string_lossy().as_bytes())
    }

    fn store(&self) -> Store {
        Store::new(self.dir.path().join("adapt").join("conversations"))
    }

    fn record_file(&self, conversation: &str) -> PathBuf {
        self.dir
            .path()
            .join("adapt")
            .join("conversations")
            .join(self.vault_key())
            .join(format!("{conversation}.json"))
    }

    fn visit(&self, owner: &str) -> String {
        match self.host.open_visit(owner, Some(&self.roots())) {
            OpenVisitReply::Open { visit_id } => visit_id,
            other => panic!("{other:?}"),
        }
    }

    fn conversation(&self, owner: &str, visit: &str) -> String {
        let args = VisitArgs {
            visit_id: visit.to_string(),
        };
        match self.host.new_conversation(owner, &args) {
            NewConversationReply::Created { conversation_id } => conversation_id,
            other => panic!("{other:?}"),
        }
    }

    fn send(&self, owner: &str, args: &SendArgs) -> SendReply {
        self.host.send(owner, args)
    }

    fn read_as(&self, owner: &str, visit: &str, conversation: &str) -> ReadConversationReply {
        self.host.read(
            owner,
            &ReadConversationArgs {
                visit_id: visit.to_string(),
                conversation_id: conversation.to_string(),
                known_revision: None,
            },
        )
    }

    fn read(&self, visit: &str, conversation: &str) -> Conversation {
        match self.read_as("main", visit, conversation) {
            ReadConversationReply::Ok { conversation } => conversation,
            other => panic!("{other:?}"),
        }
    }

    /// Waits until `condition` holds for the conversation; only waits for completion.
    fn until(
        &self,
        visit: &str,
        conversation: &str,
        condition: impl Fn(&Conversation) -> bool,
    ) -> Conversation {
        let deadline = Instant::now() + SETTLE;
        loop {
            let current = self.read(visit, conversation);
            if condition(&current) {
                return current;
            }
            assert!(Instant::now() < deadline, "{current:?}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn settle(&self, visit: &str, conversation: &str) -> Conversation {
        self.until(visit, conversation, |current| current.turn.is_none())
    }

    fn working(&self, visit: &str, conversation: &str) -> Conversation {
        self.until(visit, conversation, |current| {
            current
                .turn
                .as_ref()
                .is_some_and(|turn| turn.phase == TurnPhase::Working)
        })
    }

    fn cancel(&self, owner: &str, visit: &str, conversation: &str, turn: &str) -> CancelTurnReply {
        self.host.cancel(
            owner,
            &TurnArgs {
                visit_id: visit.to_string(),
                conversation_id: conversation.to_string(),
                turn_id: turn.to_string(),
            },
        )
    }

    fn close(&self, visit: &str) -> CloseVisitReply {
        self.host.close_visit(
            "main",
            &VisitArgs {
                visit_id: visit.to_string(),
            },
        )
    }

    fn save(&self, visit: &str, conversation: &str) -> SaveConversationReply {
        self.host
            .save("main", &conversation_args(visit, conversation))
    }
}

fn conversation_args(visit: &str, conversation: &str) -> ConversationArgs {
    ConversationArgs {
        visit_id: visit.to_string(),
        conversation_id: conversation.to_string(),
    }
}

fn send_args(visit: &str, conversation: &str, turn: &str, request: &str) -> SendArgs {
    SendArgs {
        visit_id: visit.to_string(),
        conversation_id: conversation.to_string(),
        turn_id: turn.to_string(),
        provider: ProviderId::Codex,
        request: request.to_string(),
        attachments: Vec::new(),
        include_turn_ids: Vec::new(),
        revision: None,
    }
}

fn codex() -> ProviderArgs {
    ProviderArgs {
        provider: ProviderId::Codex,
    }
}

fn admitted(turn: &str) -> SendReply {
    SendReply::Admitted {
        turn_id: turn.to_string(),
    }
}

fn refused(reason: SendRefusal) -> SendReply {
    SendReply::Refused { reason }
}

fn outcomes(conversation: &Conversation) -> Vec<Entry> {
    conversation
        .entries
        .iter()
        .filter(|entry| !entry.is_request())
        .cloned()
        .collect()
}

fn stopped_for(entry: &Entry) -> Option<(StopReason, bool)> {
    match entry {
        Entry::Stopped {
            reason, confirmed, ..
        } => Some((*reason, *confirmed)),
        _ => None,
    }
}

fn is_candidate(entry: &Entry, expected: &str) -> bool {
    matches!(
        entry,
        Entry::Reply { reply: Reply::Candidate { package_text, .. }, .. } if package_text == expected
    )
}

fn waiting_request(turn_id: &str) -> Entry {
    Entry::Request {
        turn_id: turn_id.to_string(),
        at: now(),
        provider: ProviderId::Codex,
        text: "A reading reflection".to_string(),
        attachments: Vec::new(),
        included_turn_ids: Vec::new(),
        revision: None,
        guide: "extensions-guide-1".to_string(),
    }
}

/// A finished one-turn record written straight to storage, as an earlier session would have.
fn finished_record(id: &str, reply: Reply) -> Record {
    let turn = uuid();
    let mut record = Record::new(id.to_string(), now());
    record.entries = vec![
        Entry::Request {
            turn_id: turn.clone(),
            at: now(),
            provider: ProviderId::Codex,
            text: format!("Request of {id}"),
            attachments: Vec::new(),
            included_turn_ids: Vec::new(),
            revision: None,
            guide: "extensions-guide-1".to_string(),
        },
        Entry::Reply {
            turn_id: turn,
            at: now(),
            reply,
        },
    ];
    record.title = format!("Request of {id}");
    record
}

fn unsupported() -> Reply {
    Reply::Unsupported {
        message: "Extensions cannot set reminders.".to_string(),
        alternative: None,
    }
}

// --- Cancellation and late answers -----------------------------------------------------------------

#[test]
fn a_turn_cancelled_before_its_send_arrives_is_never_admitted() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let turn = uuid();
    assert_eq!(
        world.cancel("main", &visit, &conversation, &turn),
        CancelTurnReply::Stopped
    );
    assert_eq!(
        world.send(
            "main",
            &send_args(&visit, &conversation, &turn, "A weekly review")
        ),
        refused(SendRefusal::Cancelled)
    );
    assert_eq!(world.fake.turns.load(Ordering::SeqCst), 0);
    assert!(world.read(&visit, &conversation).entries.is_empty());
}

/// A provider that does not end when asked: admission closes at once, the stop stays unproven
/// until it ends, and its late answer is never admitted.
#[test]
fn a_late_answer_after_cancel_is_never_admitted() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, release) = held(candidate("{\"late\":true}"), false);
    world.fake.then(behaviour);
    let turn = uuid();
    assert_eq!(
        world.send(
            "main",
            &send_args(&visit, &conversation, &turn, "A weekly review")
        ),
        admitted(&turn)
    );
    world.working(&visit, &conversation);

    assert_eq!(
        world.cancel("main", &visit, &conversation, &turn),
        CancelTurnReply::Stopping
    );
    let stopping = world.read(&visit, &conversation);
    assert_eq!(
        stopping.turn.map(|turn| turn.phase),
        Some(TurnPhase::Stopping)
    );
    assert_eq!(stopping.entries.len(), 1);
    assert_eq!(
        world.send(
            "main",
            &send_args(&visit, &conversation, &uuid(), "Another")
        ),
        refused(SendRefusal::Busy)
    );

    release.send(()).unwrap();
    let settled = world.settle(&visit, &conversation);
    let ends = outcomes(&settled);
    assert_eq!(ends.len(), 1);
    assert_eq!(stopped_for(&ends[0]), Some((StopReason::Cancelled, true)));
    assert_eq!(
        world.cancel("main", &visit, &conversation, &turn),
        CancelTurnReply::Finished
    );
}

#[test]
fn a_turn_that_ends_when_cancelled_is_stopped_and_proven() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, _release) = held(candidate("{}"), true);
    world.fake.then(behaviour);
    let turn = uuid();
    world.send(
        "main",
        &send_args(&visit, &conversation, &turn, "A weekly review"),
    );
    assert_eq!(
        world.cancel("main", &visit, &conversation, &turn),
        CancelTurnReply::Stopped
    );
    let ends = outcomes(&world.read(&visit, &conversation));
    assert_eq!(stopped_for(&ends[0]), Some((StopReason::Cancelled, true)));
}

/// Review finding: a cancel touches exactly the named conversation's turn, even when another
/// conversation runs a turn with the same id, and only through an open visit of the calling window.
#[test]
fn a_cancel_never_touches_another_conversation_with_the_same_turn_id() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let first = world.conversation("main", &visit);
    let second = world.conversation("main", &visit);
    let (one, _release_one) = held(candidate("{}"), true);
    let (two, _release_two) = held(candidate("{}"), true);
    world.fake.then(one);
    world.fake.then(two);
    let shared = uuid();
    assert_eq!(
        world.send("main", &send_args(&visit, &first, &shared, "First")),
        admitted(&shared)
    );
    assert_eq!(
        world.send("main", &send_args(&visit, &second, &shared, "Second")),
        admitted(&shared)
    );
    world.working(&visit, &first);
    world.working(&visit, &second);

    assert_eq!(
        world.cancel("main", &visit, &first, &shared),
        CancelTurnReply::Stopped
    );
    let untouched = world.read(&visit, &second);
    assert_eq!(
        untouched.turn.as_ref().map(|turn| turn.phase),
        Some(TurnPhase::Working)
    );
    assert_eq!(untouched.entries.len(), 1);

    // Another window, or a visit already closed, cannot cancel it either.
    assert_eq!(
        world.cancel("other", &visit, &second, &shared),
        CancelTurnReply::UnknownVisit
    );
    let stale = world.visit("main");
    assert_eq!(world.close(&stale), CloseVisitReply::Closed);
    assert_eq!(
        world.cancel("main", &stale, &second, &shared),
        CancelTurnReply::UnknownVisit
    );
    assert_eq!(
        world.read(&visit, &second).turn.map(|turn| turn.phase),
        Some(TurnPhase::Working)
    );

    assert_eq!(
        world.cancel("main", &visit, &second, &shared),
        CancelTurnReply::Stopped
    );
    let ends = outcomes(&world.read(&visit, &second));
    assert_eq!(stopped_for(&ends[0]), Some((StopReason::Cancelled, true)));
}

// --- Account and visit boundaries ------------------------------------------------------------------

/// Review finding: a disconnect whose work does not end in time says `stopping`, not
/// `disconnected`, and says `disconnected` once that work is proven ended.
#[test]
fn a_disconnect_says_stopping_until_its_work_is_proven_ended() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, release) = held(candidate("{}"), false);
    world.fake.then(behaviour);
    world.send("main", &send_args(&visit, &conversation, &uuid(), "First"));
    world.working(&visit, &conversation);

    assert_eq!(world.host.disconnect(&codex()), DisconnectReply::Stopping);
    assert_eq!(
        world.host.status().providers.codex,
        ProviderState::SignedOut { last_connect: None }
    );
    assert_eq!(
        world.send("main", &send_args(&visit, &conversation, &uuid(), "Again")),
        refused(SendRefusal::Busy)
    );
    release.send(()).unwrap();
    let ends = outcomes(&world.settle(&visit, &conversation));
    assert_eq!(
        stopped_for(&ends[0]),
        Some((StopReason::AccountChanged, true))
    );
    assert!(!ends
        .iter()
        .any(|entry| matches!(entry, Entry::Reply { .. })));
    assert_eq!(
        world.host.disconnect(&codex()),
        DisconnectReply::Disconnected
    );
}

/// Review finding: from the moment a disconnect begins until its sign-out has run, no Send is
/// admitted, in any conversation. The disconnect here waits until the held turn is released, so
/// the provider is still signed in while the Send is tried.
#[test]
fn no_send_is_admitted_while_a_disconnect_is_waiting() {
    let world = world_waiting(Fake::connected(), Duration::from_secs(30));
    let visit = world.visit("main");
    let busy = world.conversation("main", &visit);
    let idle = world.conversation("main", &visit);
    let (behaviour, release) = held(candidate("{}"), false);
    world.fake.then(behaviour);
    world.send("main", &send_args(&visit, &busy, &uuid(), "First"));
    world.working(&visit, &busy);

    let host = Arc::clone(&world.host);
    let disconnecting = std::thread::spawn(move || host.disconnect(&codex()));
    world.until(&visit, &busy, |current| {
        current
            .turn
            .as_ref()
            .is_some_and(|turn| turn.phase == TurnPhase::Stopping)
    });
    // The provider still says connected; the disconnect has not signed out yet.
    assert_eq!(
        world.fake.state.lock().unwrap().clone(),
        ProviderState::Connected
    );
    assert_eq!(
        world.send("main", &send_args(&visit, &idle, &uuid(), "Second")),
        refused(SendRefusal::NotConnected)
    );
    release.send(()).unwrap();
    assert_eq!(disconnecting.join().unwrap(), DisconnectReply::Disconnected);
    let ends = outcomes(&world.settle(&visit, &busy));
    assert_eq!(
        stopped_for(&ends[0]),
        Some((StopReason::AccountChanged, true))
    );
    assert_eq!(world.fake.turns.load(Ordering::SeqCst), 1);
    assert!(world.read(&visit, &idle).entries.is_empty());
}

/// Review finding: a Send that read provider status before a disconnect, and reaches admission
/// after it, is refused rather than trusting what it read.
#[test]
fn a_send_that_read_status_before_a_disconnect_is_refused() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (taken, release) = world.fake.pause_next_snapshot();
    let host = Arc::clone(&world.host);
    let args = send_args(&visit, &conversation, &uuid(), "A weekly review");
    let sending = std::thread::spawn(move || host.send("main", &args));
    taken.recv().unwrap();
    assert_eq!(
        world.host.disconnect(&codex()),
        DisconnectReply::Disconnected
    );
    // Even connected again, the status that Send read is from before the disconnect.
    world.fake.set_state(ProviderState::Connected);
    release.send(()).unwrap();
    assert_eq!(sending.join().unwrap(), refused(SendRefusal::NotConnected));
    assert_eq!(world.fake.turns.load(Ordering::SeqCst), 0);
    assert!(world.read(&visit, &conversation).entries.is_empty());
}

#[test]
fn a_changed_account_drops_a_running_turns_answer() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, release) = held(candidate("{}"), false);
    world.fake.then(behaviour);
    world.send("main", &send_args(&visit, &conversation, &uuid(), "First"));
    world.working(&visit, &conversation);
    world.fake.epoch.fetch_add(1, Ordering::SeqCst);
    release.send(()).unwrap();
    let ends = outcomes(&world.settle(&visit, &conversation));
    assert_eq!(
        stopped_for(&ends[0]),
        Some((StopReason::AccountChanged, true))
    );
}

/// A turn refused because its own sign-in no longer works is `notConnected`, not `accountChanged`,
/// even though the provider marks itself signed out while ending it; an answer is still never
/// admitted under a changed account.
#[test]
fn a_turn_whose_sign_in_was_refused_says_not_connected() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    world.fake.then(Behaviour::SignsOut(TurnOutcome::Failed {
        reason: Failure::NotConnected,
        resets_at: None,
    }));
    world.send(
        "main",
        &send_args(&visit, &conversation, &uuid(), "A weekly review"),
    );
    let ends = outcomes(&world.settle(&visit, &conversation));
    assert!(matches!(
        ends[0],
        Entry::Failed {
            reason: Failure::NotConnected,
            resets_at: None,
            ..
        }
    ));
    assert_eq!(
        world.host.status().providers.codex,
        ProviderState::SignedOut { last_connect: None }
    );

    world.fake.set_state(ProviderState::Connected);
    world
        .fake
        .then(Behaviour::SignsOut(candidate("{\"other\":true}")));
    world.send("main", &send_args(&visit, &conversation, &uuid(), "Again"));
    let ends = outcomes(&world.settle(&visit, &conversation));
    assert_eq!(
        stopped_for(&ends[1]),
        Some((StopReason::AccountChanged, true))
    );
}

/// Review finding: a close whose turn does not end in time says `stopping`, keeps the visit
/// closing (answering nothing else), and says `closed` once the turn is proven ended.
#[test]
fn a_close_says_stopping_until_its_work_is_proven_ended() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, release) = held(candidate("{}"), false);
    world.fake.then(behaviour);
    world.send(
        "main",
        &send_args(&visit, &conversation, &uuid(), "A weekly review"),
    );
    world.working(&visit, &conversation);

    assert_eq!(world.close(&visit), CloseVisitReply::Stopping);
    assert_eq!(
        world.read_as("main", &visit, &conversation),
        ReadConversationReply::UnknownVisit
    );
    assert_eq!(
        world.send("main", &send_args(&visit, &conversation, &uuid(), "x")),
        refused(SendRefusal::UnknownVisit)
    );
    assert_eq!(world.close(&visit), CloseVisitReply::Stopping);
    assert_eq!(
        world.host.close_visit(
            "other",
            &VisitArgs {
                visit_id: visit.clone()
            }
        ),
        CloseVisitReply::Unknown
    );

    release.send(()).unwrap();
    let watching = world.visit("main");
    let ends = outcomes(&world.settle(&watching, &conversation));
    assert_eq!(stopped_for(&ends[0]), Some((StopReason::VisitClosed, true)));
    assert_eq!(world.close(&visit), CloseVisitReply::Closed);
    assert_eq!(world.close(&visit), CloseVisitReply::Unknown);
}

#[test]
fn closing_a_visit_stops_its_turns_and_other_windows_learn_nothing() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, _release) = held(candidate("{}"), true);
    world.fake.then(behaviour);
    let turn = uuid();
    world.send(
        "main",
        &send_args(&visit, &conversation, &turn, "A weekly review"),
    );

    let theirs = VisitArgs {
        visit_id: visit.clone(),
    };
    assert_eq!(
        world.host.close_visit("other", &theirs),
        CloseVisitReply::Unknown
    );
    assert_eq!(
        world.cancel("other", &visit, &conversation, &turn),
        CancelTurnReply::UnknownVisit
    );
    assert_eq!(
        world.read_as("other", &visit, &conversation),
        ReadConversationReply::UnknownVisit
    );
    assert_eq!(
        world.host.list("other", &theirs),
        ListConversationsReply::UnknownVisit
    );

    assert_eq!(world.close(&visit), CloseVisitReply::Closed);
    assert_eq!(world.close(&visit), CloseVisitReply::Unknown);
    let again = world.visit("main");
    let ends = outcomes(&world.read(&again, &conversation));
    assert_eq!(stopped_for(&ends[0]), Some((StopReason::VisitClosed, true)));
}

#[test]
fn a_reloaded_window_loses_its_visits_and_their_turns() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, _release) = held(candidate("{}"), true);
    world.fake.then(behaviour);
    world.send(
        "main",
        &send_args(&visit, &conversation, &uuid(), "A weekly review"),
    );
    world.host.forget_owner("main");
    assert_eq!(
        world.read_as("main", &visit, &conversation),
        ReadConversationReply::UnknownVisit
    );
    let again = world.visit("main");
    let ends = outcomes(&world.settle(&again, &conversation));
    assert_eq!(stopped_for(&ends[0]), Some((StopReason::VisitClosed, true)));
}

// --- Work not proven ended -------------------------------------------------------------------------

/// A one-turn conversation whose turn is open as stopping, with no outcome recorded.
fn assert_unproven(conversation: &Conversation) {
    assert_eq!(
        conversation.turn.as_ref().map(|turn| turn.phase),
        Some(TurnPhase::Stopping)
    );
    assert_eq!(conversation.entries.len(), 1, "{:?}", conversation.entries);
}

/// Review finding: when the provider cannot prove a cancelled turn's work ended, cancel never says
/// `stopped`. The turn stays open as stopping, nothing is recorded or admitted, and its conversation
/// takes no other turn and cannot be deleted; after a restart it shows stopped, unproven.
#[test]
fn a_cancel_the_provider_cannot_prove_stays_stopping() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, release) = unproven();
    world.fake.then(behaviour);
    let turn = uuid();
    world.send(
        "main",
        &send_args(&visit, &conversation, &turn, "A weekly review"),
    );
    world.working(&visit, &conversation);
    assert_eq!(
        world.cancel("main", &visit, &conversation, &turn),
        CancelTurnReply::Stopping
    );

    // The provider now returns, without proof that its work ended.
    let before = world.read(&visit, &conversation).revision;
    release.send(()).unwrap();
    let held = world.until(&visit, &conversation, |current| current.revision > before);
    assert_unproven(&held);
    assert_eq!(
        world.cancel("main", &visit, &conversation, &turn),
        CancelTurnReply::Stopping
    );
    assert_eq!(
        world.send("main", &send_args(&visit, &conversation, &uuid(), "Again")),
        refused(SendRefusal::Busy)
    );
    assert_eq!(
        world
            .host
            .delete("main", &conversation_args(&visit, &conversation)),
        DeleteConversationReply::Refused {
            reason: DeleteRefusal::Running
        }
    );
    assert_unproven(&world.read(&visit, &conversation));
    assert_eq!(world.fake.turns.load(Ordering::SeqCst), 1);

    let restarted = world.restarted();
    let visit = restarted.visit("main");
    let ends = outcomes(&restarted.read(&visit, &conversation));
    assert_eq!(stopped_for(&ends[0]), Some((StopReason::AppClosed, false)));
}

/// Review finding: a close whose turn the provider cannot prove ended never says `closed`; the
/// visit stays closing, and the conversation takes no other turn.
#[test]
fn a_close_the_provider_cannot_prove_never_says_closed() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, release) = unproven();
    world.fake.then(behaviour);
    world.send(
        "main",
        &send_args(&visit, &conversation, &uuid(), "A weekly review"),
    );
    world.working(&visit, &conversation);
    assert_eq!(world.close(&visit), CloseVisitReply::Stopping);

    let watching = world.visit("main");
    let before = world.read(&watching, &conversation).revision;
    release.send(()).unwrap();
    let held = world.until(&watching, &conversation, |current| {
        current.revision > before
    });
    assert_unproven(&held);
    assert_eq!(world.close(&visit), CloseVisitReply::Stopping);
    assert_eq!(world.close(&visit), CloseVisitReply::Stopping);
    assert_eq!(
        world.send(
            "main",
            &send_args(&watching, &conversation, &uuid(), "Again")
        ),
        refused(SendRefusal::Busy)
    );
    assert_unproven(&world.read(&watching, &conversation));
}

/// Review finding: a disconnect whose turn the provider cannot prove ended never says
/// `disconnected`, and signing in again does not let that conversation take another turn.
#[test]
fn a_disconnect_the_provider_cannot_prove_never_says_disconnected() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, release) = unproven();
    world.fake.then(behaviour);
    world.send(
        "main",
        &send_args(&visit, &conversation, &uuid(), "A weekly review"),
    );
    world.working(&visit, &conversation);
    assert_eq!(world.host.disconnect(&codex()), DisconnectReply::Stopping);

    let before = world.read(&visit, &conversation).revision;
    release.send(()).unwrap();
    let held = world.until(&visit, &conversation, |current| current.revision > before);
    assert_unproven(&held);
    assert_eq!(world.host.disconnect(&codex()), DisconnectReply::Stopping);
    world.fake.set_state(ProviderState::Connected);
    assert_eq!(
        world.send("main", &send_args(&visit, &conversation, &uuid(), "Again")),
        refused(SendRefusal::Busy)
    );
    assert_unproven(&world.read(&visit, &conversation));
    assert_eq!(world.fake.turns.load(Ordering::SeqCst), 1);
}

/// A provider that ends a turn on its own without proving its work ended, or that panics, never
/// yields an answer or an ending: the turn stays open as stopping, and cancelling it says so.
#[test]
fn a_turn_ended_without_proof_or_by_a_panic_stays_stopping() {
    for behaviour in [
        Behaviour::Answer(TurnOutcome::Unconfirmed),
        Behaviour::Panics,
    ] {
        let world = world(Fake::connected());
        let visit = world.visit("main");
        let conversation = world.conversation("main", &visit);
        world.fake.then(behaviour);
        let turn = uuid();
        world.send(
            "main",
            &send_args(&visit, &conversation, &turn, "A weekly review"),
        );
        let held = world.until(&visit, &conversation, |current| {
            current
                .turn
                .as_ref()
                .is_some_and(|turn| turn.phase == TurnPhase::Stopping)
        });
        assert_unproven(&held);
        assert_eq!(
            world.cancel("main", &visit, &conversation, &turn),
            CancelTurnReply::Stopping
        );
        assert_eq!(
            world.send("main", &send_args(&visit, &conversation, &uuid(), "Again")),
            refused(SendRefusal::Busy)
        );
    }
}

// --- Persistence ------------------------------------------------------------------------------------

#[test]
fn after_a_restart_history_returns_without_any_provider_call() {
    let first = world(Fake::connected());
    let visit = first.visit("main");
    let answered = first.conversation("main", &visit);
    first
        .fake
        .then(Behaviour::Answer(candidate("{\"kept\":true}")));
    first.send(
        "main",
        &send_args(&visit, &answered, &uuid(), "A weekly review"),
    );
    first.settle(&visit, &answered);

    let mut waiting = Record::new("conversation-cut-off".to_string(), now());
    waiting.entries.push(waiting_request(&uuid()));
    first.store().save(&first.vault_key(), &waiting).unwrap();

    let restarted = first.restarted();
    let visit = restarted.visit("main");
    let ListConversationsReply::Ok { conversations } = restarted.host.list(
        "main",
        &VisitArgs {
            visit_id: visit.clone(),
        },
    ) else {
        panic!("list");
    };
    assert_eq!(conversations.len(), 2);
    let kept = restarted.read(&visit, &answered);
    assert!(is_candidate(&kept.entries[1], "{\"kept\":true}"));
    assert_eq!(kept.storage, Storage::Saved);
    let ends = outcomes(&restarted.read(&visit, "conversation-cut-off"));
    assert_eq!(stopped_for(&ends[0]), Some((StopReason::AppClosed, false)));
    assert_eq!(restarted.fake.turns.load(Ordering::SeqCst), 0);
    assert_eq!(restarted.fake.sign_ins.load(Ordering::SeqCst), 0);
}

/// Review finding: an answer whose local write failed stays shown, marked unsaved, survives the
/// visit closing, and is saved by a local save, without the provider being asked again.
#[test]
fn an_answer_that_could_not_be_saved_stays_unsaved_until_a_local_save() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, release) = held(candidate("{\"answer\":1}"), false);
    world.fake.then(behaviour);
    world.send(
        "main",
        &send_args(&visit, &conversation, &uuid(), "A weekly review"),
    );
    world.working(&visit, &conversation);
    set(&world.faults.unpublished, true);
    release.send(()).unwrap();

    let shown = world.settle(&visit, &conversation);
    assert!(is_candidate(&shown.entries[1], "{\"answer\":1}"));
    assert_eq!(shown.storage, Storage::Unsaved);
    let on_disk = fs::read_to_string(world.record_file(&conversation)).unwrap();
    assert!(!on_disk.contains("answer"));

    assert_eq!(world.close(&visit), CloseVisitReply::Closed);
    let visit = world.visit("main");
    let kept = world.read(&visit, &conversation);
    assert!(is_candidate(&kept.entries[1], "{\"answer\":1}"));
    assert_eq!(kept.storage, Storage::Unsaved);

    assert_eq!(
        world.save(&visit, &conversation),
        SaveConversationReply::Unsaved
    );
    set(&world.faults.unpublished, false);
    assert_eq!(
        world.save(&visit, &conversation),
        SaveConversationReply::Saved
    );
    assert_eq!(world.read(&visit, &conversation).storage, Storage::Saved);
    assert_eq!(world.fake.turns.load(Ordering::SeqCst), 1);

    let restarted = world.restarted();
    let visit = restarted.visit("main");
    let restored = restarted.read(&visit, &conversation);
    assert!(is_candidate(&restored.entries[1], "{\"answer\":1}"));
    assert_eq!(restarted.fake.turns.load(Ordering::SeqCst), 0);
}

/// Review finding: a request that was written but whose folder could not be synced is in place,
/// so its turn runs, the conversation says `unconfirmed`, and a restart finds it.
#[test]
fn a_request_written_but_not_synced_still_runs_and_says_unconfirmed() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    world
        .fake
        .then(Behaviour::Answer(candidate("{\"answer\":2}")));
    set(&world.faults.unsynced, true);
    let turn = uuid();
    assert_eq!(
        world.send(
            "main",
            &send_args(&visit, &conversation, &turn, "A weekly review")
        ),
        admitted(&turn)
    );
    let shown = world.settle(&visit, &conversation);
    assert_eq!(shown.storage, Storage::Unconfirmed);
    assert!(is_candidate(&shown.entries[1], "{\"answer\":2}"));
    set(&world.faults.unsynced, false);
    assert_eq!(
        world.save(&visit, &conversation),
        SaveConversationReply::Saved
    );

    let restarted = world.restarted();
    let visit = restarted.visit("main");
    let restored = restarted.read(&visit, &conversation);
    assert_eq!(restored.entries.len(), 2);
    assert!(is_candidate(&restored.entries[1], "{\"answer\":2}"));
}

/// A request that could not be written at all is not sent.
#[test]
fn a_request_that_could_not_be_written_is_not_sent() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    set(&world.faults.unpublished, true);
    assert_eq!(
        world.send(
            "main",
            &send_args(&visit, &conversation, &uuid(), "A weekly review")
        ),
        refused(SendRefusal::StorageUnavailable)
    );
    assert_eq!(world.fake.turns.load(Ordering::SeqCst), 0);
    let shown = world.read(&visit, &conversation);
    assert!(shown.entries.is_empty());
}

/// Review finding: a deleted conversation whose file is gone stays deleted even when its folder
/// could not be synced; one whose file could not be removed stays.
#[test]
fn a_delete_reports_what_happened_to_the_file() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let kept = world.conversation("main", &visit);
    set(&world.faults.stuck, true);
    assert_eq!(
        world.host.delete("main", &conversation_args(&visit, &kept)),
        DeleteConversationReply::Refused {
            reason: DeleteRefusal::StorageUnavailable
        }
    );
    assert!(world.record_file(&kept).exists());
    set(&world.faults.stuck, false);

    set(&world.faults.unsynced, true);
    assert_eq!(
        world.host.delete("main", &conversation_args(&visit, &kept)),
        DeleteConversationReply::Deleted
    );
    assert!(!world.record_file(&kept).exists());
    assert_eq!(
        world.read_as("main", &visit, &kept),
        ReadConversationReply::UnknownConversation
    );
    assert_eq!(
        world.send("main", &send_args(&visit, &kept, &uuid(), "x")),
        refused(SendRefusal::UnknownConversation)
    );
    assert!(!world.record_file(&kept).exists());
}

/// A turn found cut off by a quit is shown stopped; if that cannot be written it says unsaved.
#[test]
fn an_interrupted_turn_that_could_not_be_recorded_says_unsaved() {
    let world = world(Fake::connected());
    let mut waiting = Record::new("conversation-cut-off".to_string(), now());
    waiting.entries.push(waiting_request(&uuid()));
    let store = world.store();
    store.prepare(&world.vault_key()).unwrap();
    store.save(&world.vault_key(), &waiting).unwrap();
    set(&world.faults.unpublished, true);
    let visit = world.visit("main");
    let shown = world.read(&visit, "conversation-cut-off");
    assert_eq!(shown.storage, Storage::Unsaved);
    assert_eq!(
        stopped_for(&shown.entries[1]),
        Some((StopReason::AppClosed, false))
    );
    set(&world.faults.unpublished, false);
    assert_eq!(
        world.save(&visit, "conversation-cut-off"),
        SaveConversationReply::Saved
    );
    assert_eq!(
        store
            .load(&world.vault_key(), "conversation-cut-off")
            .unwrap()
            .entries
            .len(),
        2
    );
}

/// Exactly the request, the attachment texts and the named earlier turn are sent; another
/// earlier turn, the vault path and the stored transcript beyond that are not. Attachment texts
/// are not kept, only their summary.
#[test]
fn only_the_named_payload_is_sent_and_attachment_text_is_not_kept() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let first = uuid();
    world.fake.then(Behaviour::Answer(candidate("PACKAGE-ONE")));
    world.send(
        "main",
        &send_args(&visit, &conversation, &first, "FIRST-REQUEST"),
    );
    world.settle(&visit, &conversation);
    world
        .fake
        .then(Behaviour::Answer(TurnOutcome::Reply(unsupported())));
    world.send(
        "main",
        &send_args(&visit, &conversation, &uuid(), "SECOND-REQUEST"),
    );
    world.settle(&visit, &conversation);

    world
        .fake
        .then(Behaviour::Answer(TurnOutcome::Reply(unsupported())));
    let mut third = send_args(&visit, &conversation, &uuid(), "THIRD-REQUEST");
    third.attachments = vec![Attachment {
        kind: AttachmentKind::PastedText,
        label: "Pasted text".to_string(),
        text: "ATTACHED-TEXT".to_string(),
    }];
    third.include_turn_ids = vec![first.clone()];
    let expected_active = "e".repeat(64);
    third.revision = Some(RevisionBase {
        package_id: "local.weekly-review".to_string(),
        base_sha256: "b".repeat(64),
        expected_active_sha256: Some(expected_active.clone()),
    });
    world.send("main", &third);
    let settled = world.settle(&visit, &conversation);

    let sent = world.fake.payload(2);
    for expected in [
        "THIRD-REQUEST",
        "ATTACHED-TEXT",
        "FIRST-REQUEST",
        "PACKAGE-ONE",
        "local.weekly-review",
    ] {
        assert!(sent.message.contains(expected), "{expected}");
    }
    assert!(!sent.message.contains("SECOND-REQUEST"));
    let vault_path = world.roots().canonical.to_string_lossy().into_owned();
    for payload in world.fake.payloads.lock().unwrap().iter() {
        assert!(!payload.message.contains(&vault_path));
        assert!(!payload.instructions.contains(&vault_path));
        assert!(!payload.instructions.contains("REQUEST"));
        // The version active at attachment is the UI's local check, never sent.
        assert!(!payload.message.contains(&expected_active));
    }

    let Entry::Request {
        attachments,
        included_turn_ids,
        revision,
        ..
    } = &settled.entries[4]
    else {
        panic!("{:?}", settled.entries[4]);
    };
    assert_eq!(attachments[0].sha256, hex_sha256(b"ATTACHED-TEXT"));
    assert_eq!(attachments[0].bytes, 13);
    assert_eq!(included_turn_ids, &[first]);
    assert_eq!(revision, &third.revision);
    let stored = fs::read_to_string(world.record_file(&conversation)).unwrap();
    assert!(stored.contains("THIRD-REQUEST"));
    assert!(stored.contains(&expected_active));
    assert!(!stored.contains("ATTACHED-TEXT"));
}

#[test]
fn the_conversation_limit_never_removes_a_conversation_with_entries() {
    let world = world(Fake::connected());
    let store = world.store();
    let vault = world.vault_key();
    store.prepare(&vault).unwrap();
    for number in 0..50 {
        let id = format!("conversation-{number:02}");
        store
            .save(&vault, &finished_record(&id, unsupported()))
            .unwrap();
    }
    let visit = world.visit("main");
    let args = VisitArgs {
        visit_id: visit.clone(),
    };
    assert_eq!(
        world.host.new_conversation("main", &args),
        NewConversationReply::Refused {
            reason: NewConversationRefusal::ConversationLimit
        }
    );
    for number in 0..50 {
        let id = format!("conversation-{number:02}");
        assert_eq!(
            store.load(&vault, &id).map(|record| record.entries.len()),
            Some(2),
            "{id}"
        );
    }

    // Deleting one by choice makes room; an empty, never-sent one can then be reclaimed.
    let chosen = conversation_args(&visit, "conversation-00");
    assert_eq!(
        world.host.delete("main", &chosen),
        DeleteConversationReply::Deleted
    );
    let placeholder = world.conversation("main", &visit);
    let next = world.conversation("main", &visit);
    assert_ne!(next, placeholder);
    assert_eq!(store.load(&vault, &placeholder), None);
    for number in 1..50 {
        let id = format!("conversation-{number:02}");
        assert!(store.load(&vault, &id).is_some(), "{id}");
    }
}

// --- Refusals ---------------------------------------------------------------------------------------

#[test]
fn sends_are_refused_plainly_and_nothing_is_started_for_them() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let (behaviour, release) = held(TurnOutcome::Reply(unsupported()), false);
    world.fake.then(behaviour);
    let first = uuid();
    world.send("main", &send_args(&visit, &conversation, &first, "First"));
    assert_eq!(
        world.send("main", &send_args(&visit, &conversation, &uuid(), "Second")),
        refused(SendRefusal::Busy)
    );
    release.send(()).unwrap();
    world.settle(&visit, &conversation);
    let started = world.fake.turns.load(Ordering::SeqCst);

    let cases: Vec<(&str, SendArgs, SendRefusal)> = vec![
        (
            "same turn id",
            send_args(&visit, &conversation, &first, "Again"),
            SendRefusal::Replayed,
        ),
        (
            "unfinished earlier turn",
            SendArgs {
                include_turn_ids: vec![uuid()],
                ..send_args(&visit, &conversation, &uuid(), "x")
            },
            SendRefusal::InvalidRequest,
        ),
        (
            "unknown conversation",
            send_args(&visit, "conversation-none", &uuid(), "x"),
            SendRefusal::UnknownConversation,
        ),
        (
            "Claude",
            SendArgs {
                provider: ProviderId::Claude,
                ..send_args(&visit, &conversation, &uuid(), "x")
            },
            SendRefusal::ProviderUnavailable,
        ),
    ];
    for (name, args, expected) in cases {
        assert_eq!(world.send("main", &args), refused(expected), "{name}");
    }
    assert_eq!(
        world.send("other", &send_args(&visit, &conversation, &uuid(), "x")),
        refused(SendRefusal::UnknownVisit)
    );
    world
        .fake
        .set_state(ProviderState::SignedOut { last_connect: None });
    assert_eq!(
        world.send("main", &send_args(&visit, &conversation, &uuid(), "x")),
        refused(SendRefusal::NotConnected)
    );
    world.fake.set_state(ProviderState::Connected);

    // Sixteen earlier turns with large replies are more than one Send may carry.
    let store = world.store();
    let vault = world.vault_key();
    let mut heavy = Record::new("conversation-heavy".to_string(), now());
    let mut earlier = Vec::new();
    for _ in 0..16 {
        let record = finished_record(
            "conversation-heavy",
            Reply::Candidate {
                message: "Here.".to_string(),
                package_text: "p".repeat(100 * 1024),
            },
        );
        earlier.push(record.entries[0].turn_id().to_string());
        heavy.entries.extend(record.entries);
    }
    store.save(&vault, &heavy).unwrap();
    let too_much = SendArgs {
        include_turn_ids: earlier,
        ..send_args(&visit, "conversation-heavy", &uuid(), "x")
    };
    assert_eq!(
        world.send("main", &too_much),
        refused(SendRefusal::TooLarge)
    );

    // A conversation with fifty turns takes no more.
    let mut full = Record::new("conversation-full".to_string(), now());
    for _ in 0..50 {
        full.entries
            .extend(finished_record("conversation-full", unsupported()).entries);
    }
    store.save(&vault, &full).unwrap();
    assert_eq!(
        world.send(
            "main",
            &send_args(&visit, "conversation-full", &uuid(), "x")
        ),
        refused(SendRefusal::ConversationFull)
    );
    assert_eq!(world.fake.turns.load(Ordering::SeqCst), started);
}

#[test]
fn no_other_provider_is_used_when_codex_is_not_qualified() {
    let unqualified = ProviderState::Unavailable {
        reason: UnavailableReason::Unqualified,
        installed_version: Some("0.153.4".to_string()),
    };
    let world = world(Fake::new(unqualified.clone()));
    let status = world.host.status();
    assert_eq!(status.providers.codex, unqualified);
    assert_eq!(
        status.providers.claude,
        ProviderState::Unavailable {
            reason: UnavailableReason::NotAuthorized,
            installed_version: None
        }
    );
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    for provider in [ProviderId::Codex, ProviderId::Claude] {
        let args = SendArgs {
            provider,
            ..send_args(&visit, &conversation, &uuid(), "A weekly review")
        };
        assert_eq!(
            world.send("main", &args),
            refused(SendRefusal::ProviderUnavailable)
        );
    }
    for provider in [ProviderId::Codex, ProviderId::Claude] {
        let args = ConnectArgs {
            provider,
            disclosure_version: "adapt-disclosure-1".to_string(),
        };
        assert_eq!(
            world.host.connect(&args, &|_: &str| true),
            Ok(ConnectReply::Refused {
                reason: ConnectRefusal::Unavailable
            })
        );
    }
    assert_eq!(world.fake.turns.load(Ordering::SeqCst), 0);
    assert_eq!(world.fake.sign_ins.load(Ordering::SeqCst), 0);
}

#[test]
fn connect_happens_only_when_asked_and_records_the_disclosure() {
    let world = world(Fake::new(ProviderState::SignedOut { last_connect: None }));
    for _ in 0..3 {
        world.host.status();
    }
    assert_eq!(world.fake.sign_ins.load(Ordering::SeqCst), 0);
    let bad = ConnectArgs {
        provider: ProviderId::Codex,
        disclosure_version: "two words".to_string(),
    };
    assert!(world.host.connect(&bad, &|_: &str| true).is_err());
    let args = ConnectArgs {
        provider: ProviderId::Codex,
        disclosure_version: "adapt-disclosure-1".to_string(),
    };
    let opened = Mutex::new(Vec::new());
    let reply = world.host.connect(&args, &|url: &str| {
        opened.lock().unwrap().push(url.to_string());
        true
    });
    assert_eq!(reply, Ok(ConnectReply::Started));
    assert_eq!(opened.lock().unwrap().len(), 1);
    let consent = fs::read_to_string(world.dir.path().join("adapt").join("consent.json")).unwrap();
    assert!(consent.contains("adapt-disclosure-1"));
    assert!(!consent.contains('@'));
    assert_eq!(
        world.host.status().providers.codex,
        ProviderState::Connecting
    );
}

#[test]
fn revisions_only_increase_and_an_unchanged_poll_is_cheap() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    let before = world.read(&visit, &conversation).revision;
    let known = ReadConversationArgs {
        visit_id: visit.clone(),
        conversation_id: conversation.clone(),
        known_revision: Some(before),
    };
    assert_eq!(
        world.host.read("main", &known),
        ReadConversationReply::Unchanged { revision: before }
    );
    world
        .fake
        .then(Behaviour::Answer(TurnOutcome::Reply(unsupported())));
    world.send(
        "main",
        &send_args(&visit, &conversation, &uuid(), "A weekly review"),
    );
    let after = world.settle(&visit, &conversation).revision;
    assert!(after > before);
    assert!(matches!(
        world.host.read("main", &known),
        ReadConversationReply::Ok { conversation } if conversation.revision == after
    ));
}

#[test]
fn an_answer_outside_its_bounds_is_recorded_as_a_failure_not_shown() {
    let world = world(Fake::connected());
    let visit = world.visit("main");
    let conversation = world.conversation("main", &visit);
    world
        .fake
        .then(Behaviour::Answer(TurnOutcome::Reply(Reply::Unsupported {
            message: "m".repeat(601),
            alternative: None,
        })));
    world.send(
        "main",
        &send_args(&visit, &conversation, &uuid(), "A weekly review"),
    );
    let ends = outcomes(&world.settle(&visit, &conversation));
    assert!(matches!(
        ends[0],
        Entry::Failed {
            reason: Failure::OutputTooLarge,
            resets_at: None,
            ..
        }
    ));
}
