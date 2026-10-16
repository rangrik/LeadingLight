//! Every save request this process has seen, the live holds, and short mutation leases.
//! One mutex; nothing waits for the copy lock or touches a page while holding it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use super::outcome::{
    HoldInfo, HoldKind, OriginalRequest, Refusal, ResolutionOutcome, ResolutionRefusal,
    SaveOutcome, SaveRequestState, Terminal,
};
use crate::vault::staged_file::{FileIdentity, Fingerprint};

pub(super) type Digest = [u8; 32];

pub(crate) const HELD_MESSAGE: &str = "held: This page has unsaved text waiting for a decision.";
pub(crate) const BUSY_MESSAGE: &str = "busy: This page is still saving. Try again.";

/// What Check needs to re-prove an uncertain save, without any page text.
#[derive(Debug, Clone)]
pub(super) struct Proof {
    pub(super) path: PathBuf,
    /// The page key checked at save time; Check reads nothing unless the page still has it.
    pub(super) key: PathBuf,
    pub(super) submitted: Digest,
    pub(super) original: Option<Fingerprint>,
    pub(super) staged: Option<(PathBuf, FileIdentity)>,
    pub(super) leftovers: Vec<String>,
}

#[derive(Debug, Clone)]
pub(super) struct Hold {
    pub(super) request: OriginalRequest,
    pub(super) kind: HoldKind,
    pub(super) proof: Option<Proof>,
}

impl Hold {
    pub(super) fn info(&self) -> HoldInfo {
        HoldInfo {
            request_id: self.request.request_id.clone(),
            kind: self.kind,
            seq: self.request.seq,
            submitted_sha256: self.request.submitted_sha256.clone(),
        }
    }
}

enum State {
    Voided,
    Running {
        key: PathBuf,
    },
    /// The full record; kept for live holds and the latest finished save per page.
    Done {
        outcome: SaveOutcome,
        key: Option<PathBuf>,
        /// Boxed so compacted records stay small.
        hold: Option<Box<Hold>>,
    },
    Retired {
        terminal: Terminal,
    },
}

struct Recorded {
    action_id: String,
    digest: Digest,
    result: ResolutionOutcome,
}

struct Entry {
    binding: Digest,
    state: State,
    resolutions: Vec<Recorded>,
}

#[derive(Default)]
struct Inner {
    entries: BTreeMap<String, Entry>,
    holds: BTreeMap<PathBuf, String>,
    running: BTreeMap<PathBuf, String>,
    latest: BTreeMap<PathBuf, String>,
    leases: BTreeMap<u64, Vec<PathBuf>>,
    next_lease: u64,
}

pub(crate) struct Registry {
    inner: Mutex<Inner>,
}

pub(super) enum Admission {
    Answer(SaveOutcome),
    Run,
}

pub(super) enum Lookup {
    State(SaveRequestState),
    Reprove(Proof),
}

pub(super) struct Action {
    pub(super) id: String,
    pub(super) digest: Digest,
}

/// Released on drop; while it lives, saves and overlapping leases answer `busy`.
pub(crate) struct Lease {
    registry: &'static Registry,
    id: u64,
}

impl Drop for Lease {
    fn drop(&mut self) {
        self.registry.lock().leases.remove(&self.id);
    }
}

impl Entry {
    fn new(binding: Digest, state: State) -> Self {
        Self {
            binding,
            state,
            resolutions: Vec::new(),
        }
    }

    fn terminal(&self) -> Option<Terminal> {
        match &self.state {
            State::Done { outcome, .. } => Some(outcome.terminal()),
            State::Retired { terminal } => Some(*terminal),
            State::Voided | State::Running { .. } => None,
        }
    }

    /// What the same envelope gets when it is sent to save again.
    fn replay(&self, binding: &Digest) -> SaveOutcome {
        if self.binding != *binding {
            return SaveOutcome::refused(Refusal::RequestMismatch);
        }
        match &self.state {
            State::Running { .. } => SaveOutcome::refused(Refusal::Busy),
            State::Done { outcome, .. } => outcome.clone(),
            State::Voided | State::Retired { .. } => SaveOutcome::refused(Refusal::RequestVoided),
        }
    }

    fn check_state(&self) -> Lookup {
        let state = match &self.state {
            State::Voided => SaveRequestState::Voided,
            State::Running { .. } => SaveRequestState::Running,
            _ if !self.resolutions.is_empty() => SaveRequestState::Retired {
                terminal: self.terminal().unwrap_or(Terminal::Refused),
                resolved: true,
            },
            State::Done { outcome, hold, .. } => {
                if let (
                    SaveOutcome::Uncertain { .. },
                    Some(Hold {
                        proof: Some(proof), ..
                    }),
                ) = (outcome, hold.as_deref())
                {
                    return Lookup::Reprove(proof.clone());
                }
                SaveRequestState::Done {
                    outcome: outcome.clone(),
                }
            }
            State::Retired { terminal } => SaveRequestState::Retired {
                terminal: *terminal,
                resolved: false,
            },
        };
        Lookup::State(state)
    }
}

impl Inner {
    /// Unseen requests are stored voided, so a late original can never publish.
    fn bind(&mut self, request: &OriginalRequest, binding: Digest) -> Option<&mut Entry> {
        let entry = self
            .entries
            .entry(request.request_id.clone())
            .or_insert_with(|| Entry::new(binding, State::Voided));
        (entry.binding == binding).then_some(entry)
    }

    fn leased(&self, key: &Path) -> bool {
        self.leases
            .values()
            .flatten()
            .any(|lease| key.starts_with(lease))
    }

    fn blocker(&self, key: &Path) -> Option<SaveOutcome> {
        if let Some(hold) = self.holds.get(key).and_then(|id| self.live_hold(id)) {
            return Some(SaveOutcome::refused(Refusal::Held {
                held_by: hold.request.request_id.clone(),
                held_request: hold.request.clone(),
                held_kind: hold.kind,
            }));
        }
        (self.running.contains_key(key) || self.leased(key))
            .then(|| SaveOutcome::refused(Refusal::Busy))
    }

    fn live_hold(&self, id: &str) -> Option<&Hold> {
        match self.entries.get(id).map(|entry| &entry.state) {
            Some(State::Done {
                hold: Some(hold), ..
            }) => Some(&**hold),
            _ => None,
        }
    }

    /// Keeps the binding, terminal class and resolutions; drops the full record.
    fn compact(&mut self, id: &str) {
        let Some(entry) = self.entries.get_mut(id) else {
            return;
        };
        if let State::Done { outcome, key, .. } = &entry.state {
            if let Some(key) = key {
                if self.holds.get(key).map(String::as_str) == Some(id) {
                    self.holds.remove(key);
                }
            }
            entry.state = State::Retired {
                terminal: outcome.terminal(),
            };
        }
    }
}

impl Registry {
    pub(crate) const fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                entries: BTreeMap::new(),
                holds: BTreeMap::new(),
                running: BTreeMap::new(),
                latest: BTreeMap::new(),
                leases: BTreeMap::new(),
                next_lease: 0,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A save whose page failed validation: stored, so the same envelope answers the same.
    pub(super) fn admit_unplaced(&self, request: &OriginalRequest, binding: Digest) -> SaveOutcome {
        let mut inner = self.lock();
        if let Some(entry) = inner.entries.get(&request.request_id) {
            return entry.replay(&binding);
        }
        let outcome = SaveOutcome::refused(Refusal::OutsideVault);
        let state = State::Done {
            outcome: outcome.clone(),
            key: None,
            hold: None,
        };
        inner
            .entries
            .insert(request.request_id.clone(), Entry::new(binding, state));
        outcome
    }

    /// Registration precedes publication: only an unseen envelope on a free page may run.
    pub(super) fn admit(
        &self,
        request: &OriginalRequest,
        binding: Digest,
        key: &Path,
    ) -> Admission {
        let mut inner = self.lock();
        if let Some(entry) = inner.entries.get(&request.request_id) {
            return Admission::Answer(entry.replay(&binding));
        }
        let id = request.request_id.clone();
        let (state, admission) = match inner.blocker(key) {
            Some(outcome) => (
                State::Done {
                    outcome: outcome.clone(),
                    key: None,
                    hold: None,
                },
                Admission::Answer(outcome),
            ),
            None => {
                inner.running.insert(key.to_path_buf(), id.clone());
                (
                    State::Running {
                        key: key.to_path_buf(),
                    },
                    Admission::Run,
                )
            }
        };
        inner.entries.insert(id, Entry::new(binding, state));
        admission
    }

    pub(super) fn finish(&self, id: &str, outcome: SaveOutcome, hold: Option<Hold>) {
        let mut inner = self.lock();
        let Some(entry) = inner.entries.get_mut(id) else {
            return;
        };
        let State::Running { key } = &entry.state else {
            return;
        };
        let key = key.clone();
        let holds = hold.is_some();
        entry.state = State::Done {
            outcome: outcome.without_note(),
            key: Some(key.clone()),
            hold: hold.map(Box::new),
        };
        inner.running.remove(&key);
        if holds {
            inner.holds.insert(key.clone(), id.to_string());
        }
        if let Some(previous) = inner.latest.insert(key, id.to_string()) {
            // Admission refuses a held page, so the previous record never holds here.
            if previous != id {
                inner.compact(&previous);
            }
        }
    }

    pub(super) fn lookup(&self, request: &OriginalRequest, binding: Digest) -> Lookup {
        let mut inner = self.lock();
        match inner.bind(request, binding) {
            Some(entry) => entry.check_state(),
            None => Lookup::State(SaveRequestState::Mismatch),
        }
    }

    /// Applies a re-proof unless a resolution or another Check got there first.
    pub(super) fn settle(&self, id: &str, proven: Option<SaveOutcome>) -> SaveRequestState {
        let mut inner = self.lock();
        let Some(entry) = inner.entries.get_mut(id) else {
            return SaveRequestState::Mismatch;
        };
        let live = entry.resolutions.is_empty()
            && matches!(&entry.state, State::Done { hold: Some(_), .. });
        if let (true, Some(outcome)) = (live, proven) {
            let key = match &entry.state {
                State::Done { key, .. } => key.clone(),
                _ => None,
            };
            entry.state = State::Done {
                outcome: outcome.clone(),
                key: key.clone(),
                hold: None,
            };
            if let Some(key) = key {
                inner.holds.remove(&key);
            }
            return SaveRequestState::Done { outcome };
        }
        match entry.check_state() {
            Lookup::State(state) => state,
            Lookup::Reprove(_) => match &entry.state {
                State::Done { outcome, .. } => SaveRequestState::Done {
                    outcome: outcome.clone(),
                },
                _ => SaveRequestState::Running,
            },
        }
    }

    /// Binds an unseen envelope as voided; `false` when a different envelope owns the ID.
    pub(super) fn bind(&self, request: &OriginalRequest, binding: Digest) -> bool {
        self.lock().bind(request, binding).is_some()
    }

    /// Records one exact disposition. `proof` is the copy check for keep-copy, done under the
    /// copy lock; an exact retry still needs it, because only current proof keeps the text safe.
    pub(super) fn resolve(
        &self,
        request: &OriginalRequest,
        binding: Digest,
        action: &Action,
        proof: Result<(), ResolutionRefusal>,
    ) -> ResolutionOutcome {
        let refused = |reason| ResolutionOutcome::Refused { reason };
        let mut inner = self.lock();
        let Some(entry) = inner.bind(request, binding) else {
            return refused(ResolutionRefusal::RequestMismatch);
        };
        if matches!(entry.state, State::Running { .. }) {
            return ResolutionOutcome::Running;
        }
        if let Some(recorded) = entry.resolutions.iter().find(|r| r.action_id == action.id) {
            if recorded.digest != action.digest {
                return refused(ResolutionRefusal::ActionMismatch);
            }
            return match proof {
                Ok(()) => recorded.result.clone(),
                Err(reason) => refused(reason),
            };
        }
        if let Err(reason) = proof {
            return refused(reason);
        }
        let leftovers = match &entry.state {
            State::Done {
                hold: Some(hold), ..
            } => Some(
                hold.proof
                    .as_ref()
                    .map(|proof| proof.leftovers.clone())
                    .unwrap_or_default(),
            ),
            _ => None,
        };
        let result = ResolutionOutcome::Resolved {
            action_id: action.id.clone(),
            hold_retired: leftovers.is_some(),
            leftovers: leftovers.unwrap_or_default(),
        };
        entry.resolutions.push(Recorded {
            action_id: action.id.clone(),
            digest: action.digest,
            result: result.clone(),
        });
        inner.compact(&request.request_id);
        result
    }

    /// Drops a record nobody can name again, such as a legacy save's private envelope.
    pub(super) fn forget(&self, id: &str) {
        let mut inner = self.lock();
        if inner.entries.remove(id).is_some() {
            inner.latest.retain(|_, latest| latest != id);
        }
    }

    /// Refuses when a hold or a running save sits at or under any of `keys`, or when another
    /// lease sits at, under or above one, so two writers never share a page.
    pub(super) fn lease(&'static self, keys: Vec<PathBuf>) -> Result<Lease, String> {
        let mut inner = self.lock();
        for key in &keys {
            let covered = |path: &&PathBuf| path.starts_with(key);
            if inner
                .holds
                .iter()
                .any(|(path, id)| covered(&path) && inner.live_hold(id).is_some())
            {
                return Err(HELD_MESSAGE.to_string());
            }
            let overlaps = |lease: &PathBuf| lease.starts_with(key) || key.starts_with(lease);
            if inner.running.keys().any(|path| covered(&path))
                || inner.leases.values().flatten().any(overlaps)
            {
                return Err(BUSY_MESSAGE.to_string());
            }
        }
        let id = inner.next_lease;
        inner.next_lease += 1;
        inner.leases.insert(id, keys);
        Ok(Lease { registry: self, id })
    }

    #[cfg(test)]
    pub(super) fn full_records(&self) -> usize {
        let inner = self.lock();
        inner
            .entries
            .values()
            .filter(|entry| matches!(entry.state, State::Done { key: Some(_), .. }))
            .count()
    }
}
