//! Sessions, runs, folder handles and write operations, in memory for this process.
//!
//! A session belongs to the window that opened it and to one resolved vault. Its id is a fresh
//! random UUID that is never issued again, so a closed or forgotten session cannot come back; a
//! return to a vault is a new session. Every later call must come from the same window as well
//! as name the session, run or operation, including calls about a session already closed.
//!
//! A run is ended by its request-time key, which is kept for the session's life so an admission
//! that arrives late is refused. Ended keys are never forgotten. When a session's key table is
//! full and an end names a key it cannot hold, the session is sealed: it admits nothing new for
//! the rest of its life, so the ended request can never be admitted, whatever keys are freed
//! later. Live-run capacity is reserved when an admission starts checking its package and given
//! back exactly once if it is refused, so concurrent admissions cannot pass the bound together.
//!
//! Revoking a run never interrupts a write already admitted: close, end, deactivation and
//! rollback mark the run revoked, then wait for that write on the condition variable, so no lock
//! is held while a write publishes and nothing waits while holding the registry lock.
//!
//! Every operation id this process answers for keeps its owner, request digest and outcome until
//! the process ends; a record is never dropped or replaced, so one id never names two writes.
//! When the ledger is full, new operations answer busy. After a restart every query answers
//! `unknown`, which is never evidence that nothing was written.
//!
//! A committed write's Undo belongs to the window and session it was committed in, not to its
//! run: ending the run or turning its package off keeps it. Its token, the pin on an append's
//! kept earlier text and the receipt are recorded in the same lock section that finishes the
//! run's write, so a close never slips between commit and pin. An Undo is admitted under the same
//! lock as runs; closing the session waits for an Undo being used, then forgets every token of
//! the session, which unpins their versions. Undo has its own immutable ledger, like proposals.

use std::collections::{HashMap, VecDeque};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};

use sha2::{Digest as _, Sha256};

use super::create::{self, BoundFolder, Claim, Content, CreateIo, Vault};
use super::document::{self, Append, BoundDocument, Written};
use super::wire::{
    CloseSessionReply, CommitKind, DocumentHandleReply, EndRunReply, FolderHandleReply,
    GuardedProposal, HandleRefusal, OpenSessionReply, ProposalReceipt, ProposalRefusal, QueryReply,
    QueryState, ReleaseUndoReply, RunAdmission, RunRefusal, RunScope, UndoKind, UndoQueryReply,
    UndoReceipt, UndoRefusal, UndoRequest,
};
use crate::leadinglight_history::Retained;

/// Opening another session in the same window closes that window's oldest one.
pub(crate) const MAX_SESSIONS_PER_OWNER: usize = 8;
/// Request keys a session remembers, admitted, ended or pending; then new admissions answer busy.
pub(crate) const MAX_KEYS_PER_SESSION: usize = 256;
/// Admitted runs not yet ended, counting admissions still checking their package.
pub(crate) const MAX_LIVE_RUNS_PER_SESSION: usize = 16;
/// Binding another folder to a run forgets its oldest folder handle.
pub(crate) const MAX_FOLDERS_PER_RUN: usize = 8;
/// Binding another page to a run forgets its oldest document handle.
pub(crate) const MAX_DOCUMENTS_PER_RUN: usize = 8;
/// Operation ids this process has answered for; none is ever dropped.
pub(crate) const MAX_OPERATIONS: usize = 1024;
/// Undo tokens a session holds unused, counting writes still committing; then an append is busy.
pub(crate) const MAX_UNDO_PER_SESSION: usize = 16;
/// Used tokens a session remembers, so a second press answers `consumed`; older ones are forgotten.
pub(crate) const MAX_UNDO_TOMBSTONES: usize = 64;
/// Undo operation ids this process has answered for; none is ever dropped.
pub(crate) const MAX_UNDO_OPERATIONS: usize = 1024;
const RECENTLY_CLOSED: usize = 256;

pub(crate) struct BeginRequest {
    pub(crate) session_id: String,
    pub(crate) package_sha256: String,
    pub(crate) command_id: String,
    pub(crate) invocation_id: String,
}

enum Key {
    /// Admission is checking the package and holds a reserved live slot; an end now makes it
    /// refuse and give the slot back.
    Admitting,
    Admitted(String),
    Ended,
}

struct Session {
    owner: String,
    vault: Vault,
    opened: u64,
    keys: HashMap<String, Key>,
    /// Admitted runs not yet ended plus admissions reserving a slot.
    live: usize,
    /// Set when an end could not keep its key: no new admission, ever, in this session.
    sealed: bool,
    /// Unused Undo tokens plus writes that will register one.
    undo_slots: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Write {
    Free,
    Busy(String),
    Done(String),
}

struct Run {
    session: String,
    owner: String,
    invocation: String,
    vault: Vault,
    package_id: String,
    package_sha256: String,
    revoked: bool,
    write: Write,
    folders: Vec<(String, BoundFolder)>,
    documents: Vec<(String, BoundDocument)>,
}

impl Run {
    fn busy(&self) -> bool {
        matches!(self.write, Write::Busy(_))
    }
}

enum OperationState {
    Running,
    Done(ProposalReceipt),
}

struct Operation {
    owner: String,
    digest: [u8; 32],
    state: OperationState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UndoState {
    Ready,
    /// An Undo request is using it; close, release and other presses wait or answer busy.
    Busy,
    /// Undone or uncertain: never used again.
    Used,
}

/// One committed write's Undo, for its window and session.
struct UndoRecord {
    owner: String,
    session: String,
    written: Written,
    /// An append's pinned earlier text, taken out while an Undo uses it; dropping it unpins.
    retained: Option<Retained>,
    state: UndoState,
    seq: u64,
}

enum UndoOperationState {
    Running,
    Done(UndoReceipt),
}

struct UndoOperation {
    owner: String,
    digest: [u8; 32],
    state: UndoOperationState,
}

/// What a write names when it claims its run.
enum Target<'a> {
    Folder(&'a str),
    Document { handle: &'a str, expected: &'a str },
}

enum Bound {
    Folder(BoundFolder),
    Document(BoundDocument),
}

/// A write's receipt, where it left its page, and the pin on an append's kept earlier text.
type Outcome = (ProposalReceipt, Option<Written>, Option<Retained>);

/// What an admitted write was given, and the Undo token it will register if it commits.
struct Claimed {
    vault: Vault,
    session: String,
    bound: Bound,
    undo: Option<String>,
}

#[derive(Default)]
struct Inner {
    sessions: HashMap<String, Session>,
    runs: HashMap<String, Run>,
    /// Recently closed sessions with their owners, so only the owner can still close or end them.
    closed: VecDeque<(String, String)>,
    operations: HashMap<String, Operation>,
    undos: HashMap<String, UndoRecord>,
    undo_operations: HashMap<String, UndoOperation>,
    seq: u64,
    /// Changes whenever activation revokes runs, so an admission checked before it refuses.
    epoch: u64,
}

impl Inner {
    fn next_seq(&mut self) -> u64 {
        self.seq += 1;
        self.seq
    }

    /// Non-joining: the session is gone and its runs revoked; a write in progress finishes and
    /// keeps its record, and a later close of the same id by its owner still waits for it.
    fn close_session(&mut self, session_id: &str) {
        if let Some(session) = self.sessions.remove(session_id) {
            self.closed
                .push_back((session.owner, session_id.to_string()));
            while self.closed.len() > RECENTLY_CLOSED {
                self.closed.pop_front();
            }
        }
        for run in self.runs.values_mut() {
            if run.session == session_id {
                run.revoked = true;
            }
        }
        self.runs
            .retain(|_, run| run.session != session_id || run.busy());
        // Its Undo tokens go with it; one being used is forgotten when that Undo finishes.
        self.undos
            .retain(|_, undo| undo.session != session_id || undo.state == UndoState::Busy);
    }

    /// A session this owner closed, or one with a run of this owner still settling.
    fn owns_closed(&self, owner: &str, session_id: &str) -> bool {
        self.closed
            .iter()
            .any(|(closed_owner, closed_id)| closed_owner == owner && closed_id == session_id)
            || self
                .runs
                .values()
                .any(|run| run.session == session_id && run.owner == owner)
    }

    fn live_run(&self, owner: &str, run_id: &str) -> Option<&Run> {
        self.runs.get(run_id).filter(|run| {
            !run.revoked && run.owner == owner && self.sessions.contains_key(&run.session)
        })
    }

    fn has_room(&self) -> bool {
        self.operations.len() < MAX_OPERATIONS
    }

    /// Binds an id to an answer given before any write was attempted, so a retry gets the same
    /// one. An existing record is never replaced.
    fn record(
        &mut self,
        owner: &str,
        operation_id: &str,
        digest: [u8; 32],
        receipt: ProposalReceipt,
    ) -> ProposalReceipt {
        if self.has_room() {
            self.operations
                .entry(operation_id.to_string())
                .or_insert_with(|| Operation {
                    owner: owner.to_string(),
                    digest,
                    state: OperationState::Done(receipt.clone()),
                });
        }
        receipt
    }

    /// Binds an Undo id to an answer given before anything was attempted.
    fn record_undo(
        &mut self,
        owner: &str,
        operation_id: &str,
        digest: [u8; 32],
        receipt: UndoReceipt,
    ) -> UndoReceipt {
        if self.undo_operations.len() < MAX_UNDO_OPERATIONS {
            self.undo_operations
                .entry(operation_id.to_string())
                .or_insert_with(|| UndoOperation {
                    owner: owner.to_string(),
                    digest,
                    state: UndoOperationState::Done(receipt.clone()),
                });
        }
        receipt
    }

    /// Keeps at most `MAX_UNDO_TOMBSTONES` used tokens of a session, forgetting the oldest.
    fn trim_used(&mut self, session_id: &str) {
        let mut used: Vec<(u64, String)> = self
            .undos
            .iter()
            .filter(|(_, undo)| undo.session == session_id && undo.state == UndoState::Used)
            .map(|(token, undo)| (undo.seq, token.clone()))
            .collect();
        if used.len() <= MAX_UNDO_TOMBSTONES {
            return;
        }
        used.sort();
        let excess = used.len() - MAX_UNDO_TOMBSTONES;
        for (_, token) in used.into_iter().take(excess) {
            self.undos.remove(&token);
        }
    }
}

#[derive(Default)]
pub(crate) struct Runs {
    inner: Mutex<Inner>,
    settled: Condvar,
}

impl Runs {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Releases the lock while waiting, so the write being waited for can record its result.
    fn wait_while<'g>(
        &self,
        mut guard: MutexGuard<'g, Inner>,
        busy: impl Fn(&Inner) -> bool,
    ) -> MutexGuard<'g, Inner> {
        while busy(&guard) {
            guard = self
                .settled
                .wait(guard)
                .unwrap_or_else(PoisonError::into_inner);
        }
        guard
    }

    // --- Sessions -----------------------------------------------------------------------------------

    pub(crate) fn open_session(&self, owner: &str, vault: Vault) -> OpenSessionReply {
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        let mut guard = self.lock();
        let state = &mut *guard;
        let mut owned: Vec<(u64, String)> = state
            .sessions
            .iter()
            .filter(|(_, session)| session.owner == owner)
            .map(|(id, session)| (session.opened, id.clone()))
            .collect();
        owned.sort();
        while owned.len() >= MAX_SESSIONS_PER_OWNER {
            let (_, oldest) = owned.remove(0);
            state.close_session(&oldest);
        }
        let opened = state.next_seq();
        state.sessions.insert(
            session_id.clone(),
            Session {
                owner: owner.to_string(),
                vault,
                opened,
                keys: HashMap::new(),
                live: 0,
                sealed: false,
                undo_slots: 0,
            },
        );
        OpenSessionReply::Open { session_id }
    }

    /// Closes first, then waits for writes already admitted; answers only after both. Another
    /// window naming this session learns nothing and waits for nothing.
    pub(crate) fn close_session(&self, owner: &str, session_id: &str) -> CloseSessionReply {
        let mut guard = self.lock();
        let known = match guard.sessions.get(session_id) {
            Some(session) => session.owner == owner,
            None => guard.owns_closed(owner, session_id),
        };
        if !known {
            return CloseSessionReply::Unknown;
        }
        guard.close_session(session_id);
        let ours = |run: &Run| run.session == session_id && run.owner == owner;
        let mut guard = self.wait_while(guard, |inner| {
            inner.runs.values().any(|run| ours(run) && run.busy())
                || inner.undos.values().any(|undo| {
                    undo.session == session_id
                        && undo.owner == owner
                        && undo.state == UndoState::Busy
                })
        });
        guard.runs.retain(|_, run| !ours(&*run));
        guard
            .undos
            .retain(|_, undo| !(undo.session == session_id && undo.owner == owner));
        CloseSessionReply::Closed
    }

    /// For a window that closed or started loading a page: its sessions are closed and their runs
    /// revoked at once, without waiting, so this never blocks the event loop.
    pub(crate) fn forget_owner(&self, owner: &str) {
        let mut guard = self.lock();
        let owned: Vec<String> = guard
            .sessions
            .iter()
            .filter(|(_, session)| session.owner == owner)
            .map(|(id, _)| id.clone())
            .collect();
        for session_id in owned {
            guard.close_session(&session_id);
        }
    }

    // --- Runs ---------------------------------------------------------------------------------------

    /// Checks the session and key and reserves a live slot, releases the lock while `admit` checks
    /// the package, then admits only if the key was not ended and no activation change happened
    /// meanwhile. Every refusal after the reservation gives the slot back exactly once.
    pub(crate) fn begin(
        &self,
        owner: &str,
        request: &BeginRequest,
        admit: impl FnOnce(&Vault) -> Result<String, RunRefusal>,
    ) -> RunAdmission {
        let refused = |reason| RunAdmission::Refused { reason };
        let (vault, epoch) = {
            let mut guard = self.lock();
            let state = &mut *guard;
            let epoch = state.epoch;
            let Some(session) = state.sessions.get_mut(&request.session_id) else {
                return refused(RunRefusal::SessionClosed);
            };
            if session.owner != owner {
                return refused(RunRefusal::SessionClosed);
            }
            match session.keys.get(&request.invocation_id) {
                Some(Key::Ended) => return refused(RunRefusal::Cancelled),
                Some(_) => return refused(RunRefusal::Replayed),
                None => {}
            }
            if session.sealed
                || session.keys.len() >= MAX_KEYS_PER_SESSION
                || session.live >= MAX_LIVE_RUNS_PER_SESSION
            {
                return refused(RunRefusal::Busy);
            }
            session
                .keys
                .insert(request.invocation_id.clone(), Key::Admitting);
            session.live += 1;
            (session.vault.clone(), epoch)
        };
        let checked = admit(&vault);
        let mut guard = self.lock();
        let state = &mut *guard;
        let unchanged = state.epoch == epoch;
        // A closed session took its reservation with it.
        let Some(session) = state.sessions.get_mut(&request.session_id) else {
            return refused(RunRefusal::SessionClosed);
        };
        if !matches!(
            session.keys.get(&request.invocation_id),
            Some(Key::Admitting)
        ) {
            session.live = session.live.saturating_sub(1);
            return refused(RunRefusal::Cancelled);
        }
        let package_id = match checked {
            Ok(package_id) if unchanged => package_id,
            outcome => {
                session.keys.remove(&request.invocation_id);
                session.live = session.live.saturating_sub(1);
                return refused(outcome.err().unwrap_or(RunRefusal::Busy));
            }
        };
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        session
            .keys
            .insert(request.invocation_id.clone(), Key::Admitted(run_id.clone()));
        state.runs.insert(
            run_id.clone(),
            Run {
                session: request.session_id.clone(),
                owner: owner.to_string(),
                invocation: request.invocation_id.clone(),
                vault,
                package_id: package_id.clone(),
                package_sha256: request.package_sha256.clone(),
                revoked: false,
                write: Write::Free,
                folders: Vec::new(),
                documents: Vec::new(),
            },
        );
        RunAdmission::Admitted {
            scope: RunScope {
                run_id,
                session_id: request.session_id.clone(),
                invocation_id: request.invocation_id.clone(),
                package_id,
                package_sha256: request.package_sha256.clone(),
                command_id: request.command_id.clone(),
            },
        }
    }

    /// Makes the request-time key unadmittable, admitted or not, then revokes its run and waits
    /// for its write. `ended` only once that is proven for the rest of the session's life.
    pub(crate) fn end_run(
        &self,
        owner: &str,
        session_id: &str,
        invocation_id: &str,
    ) -> EndRunReply {
        let mut guard = self.lock();
        let state = &mut *guard;
        let run_id = match state.sessions.get_mut(session_id) {
            Some(session) if session.owner != owner => return EndRunReply::UnknownSession,
            Some(session) => {
                let run_id = match session.keys.get(invocation_id) {
                    Some(Key::Admitted(run_id)) => Some(run_id.clone()),
                    _ => None,
                };
                if session.keys.contains_key(invocation_id)
                    || session.keys.len() < MAX_KEYS_PER_SESSION
                {
                    session.keys.insert(invocation_id.to_string(), Key::Ended);
                } else {
                    // No room to remember this key, and keys freed later must not let it in.
                    session.sealed = true;
                }
                if run_id.is_some() {
                    session.live = session.live.saturating_sub(1);
                }
                run_id
            }
            None => {
                if !state.owns_closed(owner, session_id) {
                    return EndRunReply::UnknownSession;
                }
                None
            }
        };
        if let Some(run) = run_id
            .as_ref()
            .and_then(|run_id| state.runs.get_mut(run_id))
        {
            run.revoked = true;
        }
        let ours = |run: &Run| {
            run.session == session_id && run.invocation == invocation_id && run.owner == owner
        };
        let mut guard = self.wait_while(guard, |inner| {
            inner.runs.values().any(|run| ours(run) && run.busy())
        });
        guard.runs.retain(|_, run| !(ours(&*run) && run.revoked));
        EndRunReply::Ended
    }

    /// Activation changed in this vault: runs of other versions of the package (all of them when
    /// `keep` is none) are revoked, and every write of such a run, including one whose run an end
    /// already revoked, is joined before answering. Answers how many runs this revoked.
    pub(crate) fn revoke_package(
        &self,
        vault: &std::path::Path,
        package_id: &str,
        keep: Option<&str>,
    ) -> u64 {
        let mut guard = self.lock();
        let state = &mut *guard;
        state.epoch += 1;
        let matching: Vec<String> = state
            .runs
            .iter()
            .filter(|(_, run)| {
                run.vault.canonical == vault
                    && run.package_id == package_id
                    && keep.is_none_or(|keep| run.package_sha256 != keep)
            })
            .map(|(id, _)| id.clone())
            .collect();
        let mut revoked = 0;
        for run_id in &matching {
            let Some(run) = state.runs.get_mut(run_id) else {
                continue;
            };
            if run.revoked {
                continue;
            }
            run.revoked = true;
            revoked += 1;
            let (session_id, invocation) = (run.session.clone(), run.invocation.clone());
            if let Some(session) = state.sessions.get_mut(&session_id) {
                session.keys.insert(invocation, Key::Ended);
                session.live = session.live.saturating_sub(1);
            }
        }
        let mut guard = self.wait_while(guard, |inner| {
            matching
                .iter()
                .any(|run_id| inner.runs.get(run_id).is_some_and(Run::busy))
        });
        guard.runs.retain(|run_id, _| !matching.contains(run_id));
        revoked
    }

    // --- Handles ------------------------------------------------------------------------------------

    pub(crate) fn bind_folder(&self, owner: &str, run_id: &str, folder: &str) -> FolderHandleReply {
        let stale = FolderHandleReply::Refused {
            reason: HandleRefusal::StaleRun,
        };
        let vault = match self.lock().live_run(owner, run_id) {
            Some(run) => run.vault.clone(),
            None => return stale,
        };
        let bound = match create::resolve_folder(&vault.canonical, folder) {
            Ok(bound) => bound,
            Err(reason) => return FolderHandleReply::Refused { reason },
        };
        let mut guard = self.lock();
        if guard.live_run(owner, run_id).is_none() {
            return stale;
        }
        let Some(run) = guard.runs.get_mut(run_id) else {
            return stale;
        };
        let folder_handle = format!("folder-{}", uuid::Uuid::new_v4());
        if run.folders.len() >= MAX_FOLDERS_PER_RUN {
            run.folders.remove(0);
        }
        let display_path = bound.relative.clone();
        run.folders.push((folder_handle.clone(), bound));
        FolderHandleReply::Bound {
            folder_handle,
            display_path,
        }
    }

    /// The person's page choice, or the page the host resolved: read once, its digest kept as the
    /// handle's baseline. Another window's run learns nothing.
    pub(crate) fn bind_document(
        &self,
        owner: &str,
        run_id: &str,
        path: &str,
    ) -> DocumentHandleReply {
        let stale = DocumentHandleReply::Refused {
            reason: HandleRefusal::StaleRun,
        };
        let vault = match self.lock().live_run(owner, run_id) {
            Some(run) => run.vault.clone(),
            None => return stale,
        };
        let bound = match document::bind(&vault.canonical, path) {
            Ok(bound) => bound,
            Err(reason) => return DocumentHandleReply::Refused { reason },
        };
        let mut guard = self.lock();
        if guard.live_run(owner, run_id).is_none() {
            return stale;
        }
        let Some(run) = guard.runs.get_mut(run_id) else {
            return stale;
        };
        let document_handle = format!("document-{}", uuid::Uuid::new_v4());
        if run.documents.len() >= MAX_DOCUMENTS_PER_RUN {
            run.documents.remove(0);
        }
        let reply = DocumentHandleReply::Bound {
            document_handle: document_handle.clone(),
            display_path: bound.relative.clone(),
            content_sha256: bound.baseline.clone(),
        };
        run.documents.push((document_handle, bound));
        reply
    }

    // --- Writes -------------------------------------------------------------------------------------

    /// One operation per run. The same operation id with the same fields answers its recorded
    /// result, waiting if it is still running; with any other field, or from another window, it
    /// is refused. Nothing is ever written twice for one id.
    pub(crate) fn submit(
        &self,
        owner: &str,
        proposal: &GuardedProposal,
        io: &dyn CreateIo,
    ) -> ProposalReceipt {
        let operation_id = proposal.operation_id();
        if !super::is_uuid(operation_id) {
            return ProposalReceipt::refused(operation_id, ProposalRefusal::OperationMismatch);
        }
        let digest = proposal_digest(proposal);
        let (run_id, target) = match proposal {
            GuardedProposal::Create {
                run_id,
                folder_handle,
                ..
            } => (run_id, Target::Folder(folder_handle)),
            GuardedProposal::Append {
                run_id,
                document_handle,
                expected_sha256,
                ..
            } => (
                run_id,
                Target::Document {
                    handle: document_handle,
                    expected: expected_sha256,
                },
            ),
        };
        let claimed = match self.claim(owner, operation_id, digest, run_id, target) {
            Ok(claimed) => claimed,
            Err(answer) => return answer,
        };
        let outcome = Self::write(io, operation_id, proposal, &claimed);
        self.finish(owner, operation_id, run_id, &claimed, outcome)
    }

    /// The write itself, with no lock held: its receipt, where it left the page, and the pin on
    /// an append's kept earlier text.
    fn write(
        io: &dyn CreateIo,
        operation_id: &str,
        proposal: &GuardedProposal,
        claimed: &Claimed,
    ) -> Outcome {
        let committed_path = |receipt: &ProposalReceipt| match receipt {
            ProposalReceipt::Committed { path, .. } => Some(path.clone()),
            _ => None,
        };
        match (proposal, &claimed.bound) {
            (
                GuardedProposal::Create {
                    file_name,
                    content,
                    content_sha256,
                    ..
                },
                Bound::Folder(folder),
            ) => {
                let claim = Claim {
                    vault: claimed.vault.clone(),
                    folder: folder.clone(),
                };
                let content_ref = Content {
                    file_name,
                    text: content,
                    sha256: content_sha256,
                };
                let receipt = create::publish(io, &claim, operation_id, &content_ref);
                let written = committed_path(&receipt).map(|receipt_path| Written {
                    kind: UndoKind::Create,
                    vault: claimed.vault.clone(),
                    folder: folder.clone(),
                    path: folder.path.join(file_name),
                    relative: document::relative_of(folder, file_name),
                    receipt_path,
                    after_sha256: content_sha256.clone(),
                    before_sha256: None,
                });
                (receipt, written, None)
            }
            (
                GuardedProposal::Append {
                    content,
                    content_sha256,
                    expected_sha256,
                    ..
                },
                Bound::Document(bound),
            ) => {
                let Some(undo_receipt) = claimed.undo.as_deref() else {
                    let refused = ProposalReceipt::refused(operation_id, ProposalRefusal::Busy);
                    return (refused, None, None);
                };
                let request = Append {
                    vault: &claimed.vault,
                    document: bound,
                    content,
                    content_sha256,
                    expected_sha256,
                    undo_receipt,
                };
                let (receipt, retained) = document::append(io, operation_id, &request);
                let written = committed_path(&receipt).map(|receipt_path| Written {
                    kind: UndoKind::Append,
                    vault: claimed.vault.clone(),
                    folder: bound.folder.clone(),
                    path: bound.path.clone(),
                    relative: bound.relative.clone(),
                    receipt_path,
                    after_sha256: content_sha256.clone(),
                    before_sha256: Some(expected_sha256.clone()),
                });
                (receipt, written, retained)
            }
            _ => {
                let refused =
                    ProposalReceipt::refused(operation_id, ProposalRefusal::HandleMismatch);
                (refused, None, None)
            }
        }
    }

    /// Records the answer and, for a committed write whose session is still open, its Undo, in
    /// one lock section with the end of the run's busy write; then wakes whoever joins it.
    fn finish(
        &self,
        owner: &str,
        operation_id: &str,
        run_id: &str,
        claimed: &Claimed,
        outcome: Outcome,
    ) -> ProposalReceipt {
        let (mut receipt, written, retained) = outcome;
        let mut guard = self.lock();
        let state = &mut *guard;
        let open = state
            .sessions
            .get(&claimed.session)
            .is_some_and(|session| session.owner == owner);
        let usable = |written: &Written| written.kind == UndoKind::Create || retained.is_some();
        let undo = match (claimed.undo.as_ref(), written) {
            (Some(token), Some(written)) if open && usable(&written) => Some((token, written)),
            _ => None,
        };
        let registered = undo.is_some();
        if let Some((token, written)) = undo {
            let seq = state.next_seq();
            state.undos.insert(
                token.clone(),
                UndoRecord {
                    owner: owner.to_string(),
                    session: claimed.session.clone(),
                    written,
                    retained,
                    state: UndoState::Ready,
                    seq,
                },
            );
        } else if claimed.undo.is_some() {
            if let Some(session) = state.sessions.get_mut(&claimed.session) {
                session.undo_slots = session.undo_slots.saturating_sub(1);
            }
        }
        // A create offers Undo only once its token is registered; an append always names its own.
        if let ProposalReceipt::Committed {
            kind: CommitKind::Create,
            undo_receipt,
            ..
        } = &mut receipt
        {
            *undo_receipt = claimed.undo.clone().filter(|_| registered);
        }
        if let Some(operation) = state.operations.get_mut(operation_id) {
            operation.state = OperationState::Done(receipt.clone());
        }
        if let Some(run) = state.runs.get_mut(run_id) {
            run.write = Write::Done(operation_id.to_string());
        }
        state.runs.retain(|_, run| !run.revoked || run.busy());
        drop(guard);
        self.settled.notify_all();
        receipt
    }

    /// Admits the write or answers now: a replay, a mismatch, a full ledger, or a refusal that
    /// proves no write.
    fn claim(
        &self,
        owner: &str,
        operation_id: &str,
        digest: [u8; 32],
        run_id: &str,
        target: Target<'_>,
    ) -> Result<Claimed, ProposalReceipt> {
        let guard = self.lock();
        // One id names one operation of either kind.
        if guard.undo_operations.contains_key(operation_id) {
            return Err(ProposalReceipt::refused(
                operation_id,
                ProposalRefusal::OperationMismatch,
            ));
        }
        let bound_here = |inner: &Inner| {
            inner
                .operations
                .get(operation_id)
                .map(|operation| operation.owner == owner && operation.digest == digest)
        };
        match bound_here(&guard) {
            Some(false) => {
                return Err(ProposalReceipt::refused(
                    operation_id,
                    ProposalRefusal::OperationMismatch,
                ));
            }
            Some(true) => {
                let guard = self.wait_while(guard, |inner| {
                    inner
                        .operations
                        .get(operation_id)
                        .is_some_and(|operation| matches!(operation.state, OperationState::Running))
                });
                // Records are never replaced; the binding is still checked again after waking.
                return Err(match guard.operations.get(operation_id) {
                    Some(operation) if operation.owner == owner && operation.digest == digest => {
                        match &operation.state {
                            OperationState::Done(receipt) => receipt.clone(),
                            OperationState::Running => ProposalReceipt::uncertain(operation_id),
                        }
                    }
                    _ => ProposalReceipt::refused(operation_id, ProposalRefusal::OperationMismatch),
                });
            }
            None => {}
        }
        let mut guard = guard;
        let state = &mut *guard;
        // A full ledger takes no new id at all, so no answer here goes unrecorded.
        if !state.has_room() {
            return Err(ProposalReceipt::refused(
                operation_id,
                ProposalRefusal::Busy,
            ));
        }
        let found = state.live_run(owner, run_id).map(|run| {
            let bound = match &target {
                Target::Folder(handle) => run
                    .folders
                    .iter()
                    .find(|(bound, _)| bound.as_str() == *handle)
                    .map(|(_, folder)| Bound::Folder(folder.clone())),
                // A handle's baseline never changes: a newer page needs a new binding.
                Target::Document { handle, expected } => run
                    .documents
                    .iter()
                    .find(|(bound, document)| {
                        bound.as_str() == *handle && document.baseline == *expected
                    })
                    .map(|(_, document)| Bound::Document(document.clone())),
            };
            (
                run.write == Write::Free,
                bound,
                run.vault.clone(),
                run.session.clone(),
            )
        });
        let refusal = match &found {
            None => Some(ProposalRefusal::StaleRun),
            Some((false, ..)) => Some(ProposalRefusal::OperationMismatch),
            Some((true, None, ..)) => Some(ProposalRefusal::HandleMismatch),
            Some((true, Some(_), ..)) => None,
        };
        if let Some(reason) = refusal {
            let receipt = ProposalReceipt::refused(operation_id, reason);
            return Err(state.record(owner, operation_id, digest, receipt));
        }
        let Some((_, Some(bound), vault, session_id)) = found else {
            return Err(ProposalReceipt::refused(
                operation_id,
                ProposalRefusal::StaleRun,
            ));
        };
        // An append always needs an Undo slot before it may write; a create takes one if free.
        let free_slot = state
            .sessions
            .get(&session_id)
            .is_some_and(|session| session.undo_slots < MAX_UNDO_PER_SESSION);
        if !free_slot && matches!(bound, Bound::Document(_)) {
            let receipt = ProposalReceipt::refused(operation_id, ProposalRefusal::Busy);
            return Err(state.record(owner, operation_id, digest, receipt));
        }
        let undo = match state.sessions.get_mut(&session_id) {
            Some(session) if free_slot => {
                session.undo_slots += 1;
                Some(format!("undo-{}", uuid::Uuid::new_v4()))
            }
            _ => None,
        };
        state.operations.insert(
            operation_id.to_string(),
            Operation {
                owner: owner.to_string(),
                digest,
                state: OperationState::Running,
            },
        );
        if let Some(run) = state.runs.get_mut(run_id) {
            run.write = Write::Busy(operation_id.to_string());
        }
        Ok(Claimed {
            vault,
            session: session_id,
            bound,
            undo,
        })
    }

    /// The recorded state for this window's operation; anyone else's is `unknown`.
    pub(crate) fn query(&self, owner: &str, operation_id: &str) -> QueryReply {
        let guard = self.lock();
        match guard.operations.get(operation_id) {
            Some(operation) if operation.owner == owner => match &operation.state {
                OperationState::Running => QueryReply::State(QueryState::Running {
                    operation_id: operation_id.to_string(),
                }),
                OperationState::Done(receipt) => QueryReply::Receipt(receipt.clone()),
            },
            _ => QueryReply::State(QueryState::Unknown {
                operation_id: operation_id.to_string(),
            }),
        }
    }

    // --- Undo ---------------------------------------------------------------------------------------

    /// Undoes one committed write for the window and session it was committed in. The same
    /// operation id with the same fields answers its recorded result, waiting while it runs; any
    /// other field, window or a proposal's id is refused. Nothing is ever undone twice.
    pub(crate) fn undo(
        &self,
        owner: &str,
        request: &UndoRequest,
        io: &dyn CreateIo,
    ) -> UndoReceipt {
        let operation_id = request.operation_id.as_str();
        if !super::is_uuid(operation_id) {
            return UndoReceipt::refused(operation_id, UndoRefusal::OperationMismatch);
        }
        let digest = undo_digest(request);
        let (written, mut retained) = match self.claim_undo(owner, operation_id, digest, request) {
            Ok(claimed) => claimed,
            Err(answer) => return answer,
        };
        let receipt = match (written.kind, retained.as_ref()) {
            (UndoKind::Append, Some(kept)) => {
                document::undo_append(io, operation_id, &written, kept)
            }
            (UndoKind::Create, _) => document::undo_create(operation_id, &written),
            (UndoKind::Append, None) => {
                UndoReceipt::refused(operation_id, UndoRefusal::PreimageUnavailable)
            }
        };
        let mut guard = self.lock();
        let state = &mut *guard;
        if let Some(operation) = state.undo_operations.get_mut(operation_id) {
            operation.state = UndoOperationState::Done(receipt.clone());
        }
        let token = request.undo_receipt.as_str();
        let open = state
            .sessions
            .get(&request.session_id)
            .is_some_and(|session| session.owner == owner);
        if !open {
            // Its session closed meanwhile and waited for this; the token goes with it.
            state.undos.remove(token);
        } else if receipt.consumes() {
            if let Some(undo) = state.undos.get_mut(token) {
                undo.state = UndoState::Used;
            }
            if let Some(session) = state.sessions.get_mut(&request.session_id) {
                session.undo_slots = session.undo_slots.saturating_sub(1);
            }
            state.trim_used(&request.session_id);
        } else if let Some(undo) = state.undos.get_mut(token) {
            undo.state = UndoState::Ready;
            undo.retained = retained.take();
        }
        drop(guard);
        self.settled.notify_all();
        receipt
    }

    /// Admits the Undo or answers now. Every answer after the id is known is recorded.
    fn claim_undo(
        &self,
        owner: &str,
        operation_id: &str,
        digest: [u8; 32],
        request: &UndoRequest,
    ) -> Result<(Written, Option<Retained>), UndoReceipt> {
        let mismatch = || UndoReceipt::refused(operation_id, UndoRefusal::OperationMismatch);
        let guard = self.lock();
        if guard.operations.contains_key(operation_id) {
            return Err(mismatch());
        }
        let bound_here = guard
            .undo_operations
            .get(operation_id)
            .map(|operation| operation.owner == owner && operation.digest == digest);
        match bound_here {
            Some(false) => return Err(mismatch()),
            Some(true) => {
                let guard = self.wait_while(guard, |inner| {
                    inner
                        .undo_operations
                        .get(operation_id)
                        .is_some_and(|operation| {
                            matches!(operation.state, UndoOperationState::Running)
                        })
                });
                return Err(match guard.undo_operations.get(operation_id) {
                    Some(operation) if operation.owner == owner && operation.digest == digest => {
                        match &operation.state {
                            UndoOperationState::Done(receipt) => receipt.clone(),
                            UndoOperationState::Running => UndoReceipt::uncertain(operation_id),
                        }
                    }
                    _ => mismatch(),
                });
            }
            None => {}
        }
        let mut guard = guard;
        let state = &mut *guard;
        if state.undo_operations.len() >= MAX_UNDO_OPERATIONS {
            return Err(UndoReceipt::refused(operation_id, UndoRefusal::Busy));
        }
        let open = state
            .sessions
            .get(&request.session_id)
            .is_some_and(|session| session.owner == owner);
        let found = state.undos.get(&request.undo_receipt).filter(|undo| {
            undo.owner == owner
                && undo.session == request.session_id
                && undo.written.kind == request.kind
                && undo.written.after_sha256 == request.expected_sha256
                && undo.written.before_sha256 == request.before_sha256
        });
        let refusal = match found.map(|undo| undo.state) {
            _ if !open => Some(UndoRefusal::SessionClosed),
            None => Some(UndoRefusal::UnknownReceipt),
            Some(UndoState::Used) => Some(UndoRefusal::Consumed),
            Some(UndoState::Busy) => Some(UndoRefusal::Busy),
            Some(UndoState::Ready) => None,
        };
        if let Some(reason) = refusal {
            let receipt = UndoReceipt::refused(operation_id, reason);
            return Err(state.record_undo(owner, operation_id, digest, receipt));
        }
        let Some(undo) = state.undos.get_mut(&request.undo_receipt) else {
            return Err(UndoReceipt::refused(
                operation_id,
                UndoRefusal::UnknownReceipt,
            ));
        };
        undo.state = UndoState::Busy;
        let claimed = (undo.written.clone(), undo.retained.take());
        state.undo_operations.insert(
            operation_id.to_string(),
            UndoOperation {
                owner: owner.to_string(),
                digest,
                state: UndoOperationState::Running,
            },
        );
        Ok(claimed)
    }

    /// The recorded state for this window's Undo; anyone else's is `unknown`.
    pub(crate) fn query_undo(&self, owner: &str, operation_id: &str) -> UndoQueryReply {
        let guard = self.lock();
        match guard.undo_operations.get(operation_id) {
            Some(operation) if operation.owner == owner => match &operation.state {
                UndoOperationState::Running => UndoQueryReply::State(QueryState::Running {
                    operation_id: operation_id.to_string(),
                }),
                UndoOperationState::Done(receipt) => UndoQueryReply::Receipt(receipt.clone()),
            },
            _ => UndoQueryReply::State(QueryState::Unknown {
                operation_id: operation_id.to_string(),
            }),
        }
    }

    /// Forgets one token of this window and session after any Undo using it finishes, which
    /// unpins its kept version. Recorded answers stay.
    pub(crate) fn release_undo(
        &self,
        owner: &str,
        session_id: &str,
        token: &str,
    ) -> ReleaseUndoReply {
        let ours = |inner: &Inner| {
            inner
                .undos
                .get(token)
                .filter(|undo| undo.owner == owner && undo.session == session_id)
                .map(|undo| undo.state)
        };
        let guard = self.lock();
        if ours(&guard).is_none() {
            return ReleaseUndoReply::Unknown;
        }
        let mut guard = self.wait_while(guard, |inner| ours(inner) == Some(UndoState::Busy));
        let state = &mut *guard;
        let Some(was) = ours(state) else {
            return ReleaseUndoReply::Unknown;
        };
        let released = state.undos.remove(token);
        if was != UndoState::Used {
            if let Some(session) = state.sessions.get_mut(session_id) {
                session.undo_slots = session.undo_slots.saturating_sub(1);
            }
        }
        drop(guard);
        drop(released);
        ReleaseUndoReply::Released
    }

    #[cfg(test)]
    pub(crate) fn live_slots(&self, session_id: &str) -> Option<usize> {
        self.lock()
            .sessions
            .get(session_id)
            .map(|session| session.live)
    }

    #[cfg(test)]
    pub(crate) fn recorded_operations(&self) -> usize {
        self.lock().operations.len()
    }

    /// Undo tokens this window's session still holds, used ones included.
    #[cfg(test)]
    pub(crate) fn undo_tokens(&self, session_id: &str) -> usize {
        self.lock()
            .undos
            .values()
            .filter(|undo| undo.session == session_id)
            .count()
    }

    #[cfg(test)]
    pub(crate) fn undo_slots(&self, session_id: &str) -> Option<usize> {
        self.lock()
            .sessions
            .get(session_id)
            .map(|session| session.undo_slots)
    }
}

/// Every field of the request, length-prefixed so no two requests share a digest.
fn proposal_digest(proposal: &GuardedProposal) -> [u8; 32] {
    let fields: Vec<&[u8]> = match proposal {
        GuardedProposal::Create {
            operation_id,
            run_id,
            content,
            content_sha256,
            folder_handle,
            file_name,
        } => vec![
            b"create".as_slice(),
            operation_id.as_bytes(),
            run_id.as_bytes(),
            content.as_bytes(),
            content_sha256.as_bytes(),
            folder_handle.as_bytes(),
            file_name.as_bytes(),
        ],
        GuardedProposal::Append {
            operation_id,
            run_id,
            content,
            content_sha256,
            document_handle,
            expected_sha256,
        } => vec![
            b"append".as_slice(),
            operation_id.as_bytes(),
            run_id.as_bytes(),
            content.as_bytes(),
            content_sha256.as_bytes(),
            document_handle.as_bytes(),
            expected_sha256.as_bytes(),
        ],
    };
    digest_of(&fields)
}

/// Every field of the Undo request, length-prefixed, under its own tag.
fn undo_digest(request: &UndoRequest) -> [u8; 32] {
    let kind: &[u8] = match request.kind {
        UndoKind::Create => b"create",
        UndoKind::Append => b"append",
    };
    let before = request.before_sha256.as_deref();
    digest_of(&[
        b"undo".as_slice(),
        request.operation_id.as_bytes(),
        request.session_id.as_bytes(),
        request.undo_receipt.as_bytes(),
        kind,
        request.expected_sha256.as_bytes(),
        &[u8::from(before.is_some())],
        before.unwrap_or_default().as_bytes(),
    ])
}

fn digest_of(fields: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for field in fields {
        hasher.update((field.len() as u64).to_le_bytes());
        hasher.update(field);
    }
    let mut digest = [0; 32];
    digest.copy_from_slice(&hasher.finalize());
    digest
}
