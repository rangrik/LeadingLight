//! One operation at a time, and the last 16 results. Cancel and completion share one lock, so a
//! cancel after the completion point can never turn a completed result into a cancelled one.

use std::collections::{HashMap, VecDeque};
use std::panic::{self, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};
use std::thread;

use sha2::{Digest, Sha256};

use super::{
    path_text, BackupFailure, BackupResult, CancelAnswer, InspectResult, IoFailure, Kind, OpResult,
    OperationState, Phase, Progress, RestoreFailure, RestoreResult, StartAnswer, StartRefusal,
};

const RETAINED: usize = 16;

#[derive(Default)]
struct Control {
    cancel: bool,
    committed: bool,
}

enum Status {
    Running {
        phase: Phase,
        progress: Option<Progress>,
    },
    Finished(OpResult),
}

/// One operation's shared state: its control, its progress, and any output folder it made.
pub(super) struct Op {
    kind: Kind,
    digest: [u8; 32],
    control: Mutex<Control>,
    status: Mutex<Status>,
    output: Mutex<Option<PathBuf>>,
    /// The result recorded at the completion point, so a later unwind still reports it.
    completed: Mutex<Option<OpResult>>,
}

fn guard<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Op {
    pub(super) fn new(kind: Kind) -> Self {
        Self {
            kind,
            digest: [0; 32],
            control: Mutex::default(),
            status: Mutex::new(Status::Running {
                phase: Phase::Counting,
                progress: None,
            }),
            output: Mutex::new(None),
            completed: Mutex::new(None),
        }
    }

    /// True once a cancel arrived before the completion point.
    pub(super) fn cancelled(&self) -> bool {
        let control = guard(&self.control);
        control.cancel && !control.committed
    }

    /// The completion point. A cancel accepted before it wins and `action` never runs (`None`).
    /// While `action` runs, cancel waits; only a successful action commits, and its result is
    /// kept. A failed action leaves the operation uncommitted.
    pub(super) fn complete<E>(
        &self,
        action: impl FnOnce() -> Result<OpResult, E>,
    ) -> Option<Result<OpResult, E>> {
        let mut control = guard(&self.control);
        if control.cancel {
            return None;
        }
        let outcome = action();
        if let Ok(result) = &outcome {
            control.committed = true;
            *guard(&self.completed) = Some(result.clone());
        }
        Some(outcome)
    }

    /// Progress is advisory: a failed update never affects the operation.
    pub(super) fn report(&self, phase: Phase, progress: Option<Progress>) {
        if let Ok(mut status) = self.status.try_lock() {
            if let Status::Running { .. } = *status {
                *status = Status::Running { phase, progress };
            }
        }
    }

    /// The output folder this operation made, kept so even a panic can name it.
    pub(super) fn made(&self, folder: Option<PathBuf>) {
        *guard(&self.output) = folder;
    }

    pub(super) fn request_cancel(&self) -> bool {
        let mut control = guard(&self.control);
        if control.committed {
            return false;
        }
        control.cancel = true;
        true
    }
}

#[derive(Default)]
struct Registry {
    ops: HashMap<String, Arc<Op>>,
    finished: VecDeque<String>,
    running: Option<String>,
}

static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(Mutex::default);

fn registry() -> MutexGuard<'static, Registry> {
    guard(&REGISTRY)
}

fn is_uuid(id: &str) -> bool {
    uuid::Uuid::parse_str(id)
        .is_ok_and(|uuid| uuid.get_version_num() == 4 && uuid.hyphenated().to_string() == id)
}

fn digest(kind: Kind, args: &[&str]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(format!("{kind:?}").as_bytes());
    for arg in args {
        hasher.update([0]);
        hasher.update(arg.as_bytes());
    }
    hasher.finalize().into()
}

/// The answer for an id this process still retains, if any.
fn retained(registry: &Registry, id: &str, kind: Kind, digest: &[u8; 32]) -> Option<StartAnswer> {
    let op = registry.ops.get(id)?;
    if op.kind != kind || op.digest != *digest {
        return Some(StartAnswer::Refused {
            reason: StartRefusal::OperationMismatch,
        });
    }
    Some(match &*guard(&op.status) {
        Status::Running { .. } => StartAnswer::Started,
        Status::Finished(result) => StartAnswer::Finished {
            result: result.clone(),
        },
    })
}

pub(super) fn start<J: Send + 'static>(
    id: &str,
    kind: Kind,
    args: &[&str],
    prepare: impl FnOnce() -> Result<J, StartRefusal>,
    run: impl FnOnce(&Op, J) -> OpResult + Send + 'static,
) -> StartAnswer {
    let refused = |reason| StartAnswer::Refused { reason };
    if !is_uuid(id) {
        return refused(StartRefusal::OperationMismatch);
    }
    let digest = digest(kind, args);
    {
        let registry = registry();
        if let Some(answer) = retained(&registry, id, kind, &digest) {
            return answer;
        }
        if registry.running.is_some() {
            return refused(StartRefusal::Busy);
        }
    }
    let job = match prepare() {
        Ok(job) => job,
        Err(reason) => return refused(reason),
    };
    let op = {
        let mut registry = registry();
        if let Some(answer) = retained(&registry, id, kind, &digest) {
            return answer;
        }
        if registry.running.is_some() {
            return refused(StartRefusal::Busy);
        }
        let op = Arc::new(Op {
            digest,
            ..Op::new(kind)
        });
        registry.ops.insert(id.to_string(), Arc::clone(&op));
        registry.running = Some(id.to_string());
        op
    };
    let worker = Arc::clone(&op);
    let owned_id = id.to_string();
    let spawned = thread::Builder::new()
        .name("leadinglight-backup".into())
        .spawn(move || {
            let result = panic::catch_unwind(AssertUnwindSafe(|| run(&worker, job)))
                .unwrap_or_else(|_| internal(&worker));
            finish(&owned_id, &worker, result);
        });
    if spawned.is_err() {
        finish(id, &op, internal(&op));
        return StartAnswer::Finished {
            result: internal(&op),
        };
    }
    StartAnswer::Started
}

/// An unexpected stop: a completed result stands; otherwise whatever folder was made is
/// reported, never cleaned blindly.
pub(super) fn internal(op: &Op) -> OpResult {
    if let Some(result) = guard(&op.completed).clone() {
        return result;
    }
    let leftover = guard(&op.output).as_deref().map(path_text);
    match op.kind {
        Kind::Backup => OpResult::Backup(BackupResult::Failed {
            reason: BackupFailure::Internal,
            path: None,
            leftover,
        }),
        Kind::Inspect => OpResult::Inspect(InspectResult::Failed {
            reason: IoFailure::Internal,
        }),
        Kind::Restore => OpResult::Restore(RestoreResult::Failed {
            reason: RestoreFailure::Internal,
            path: None,
            leftover,
        }),
    }
}

fn finish(id: &str, op: &Op, result: OpResult) {
    let mut registry = registry();
    *guard(&op.status) = Status::Finished(result);
    if registry.running.as_deref() == Some(id) {
        registry.running = None;
    }
    registry.finished.push_back(id.to_string());
    while registry.finished.len() > RETAINED {
        if let Some(old) = registry.finished.pop_front() {
            registry.ops.remove(&old);
        }
    }
}

pub(crate) fn state(id: &str) -> OperationState {
    let Some(op) = registry().ops.get(id).cloned() else {
        return OperationState::Unknown;
    };
    let cancel_requested = guard(&op.control).cancel;
    let status = guard(&op.status);
    match &*status {
        Status::Running { phase, progress } => OperationState::Running {
            kind: op.kind,
            phase: *phase,
            progress: progress.clone(),
            cancel_requested,
        },
        Status::Finished(result) => OperationState::Finished {
            kind: op.kind,
            result: result.clone(),
        },
    }
}

pub(crate) fn cancel(id: &str) -> CancelAnswer {
    let op = registry().ops.get(id).cloned();
    let accepted = op.is_some_and(|op| {
        matches!(*guard(&op.status), Status::Running { .. }) && op.request_cancel()
    });
    CancelAnswer { accepted }
}
