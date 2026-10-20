//! Session, admission and cancellation boundaries of the run registry. Package checks are
//! closures here, and a paused check is a closure waiting on a channel, so every interleaving
//! below happens in exactly the order written.

use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};
use std::thread;

use super::create::Vault;
use super::runs::{
    BeginRequest, Runs, MAX_KEYS_PER_SESSION, MAX_LIVE_RUNS_PER_SESSION, MAX_SESSIONS_PER_OWNER,
};
use super::wire::{
    CloseSessionReply, EndRunReply, FolderHandleReply, HandleRefusal, OpenSessionReply,
    RunAdmission, RunRefusal,
};

const SHA: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const PACKAGE: &str = "local.quick-note";

fn vault() -> Vault {
    Vault {
        requested: PathBuf::from("/vault"),
        canonical: PathBuf::from("/vault"),
    }
}

fn open(runs: &Runs, owner: &str) -> String {
    match runs.open_session(owner, vault()) {
        OpenSessionReply::Open { session_id } => session_id,
        other => panic!("{other:?}"),
    }
}

fn request(session: &str, key: &str) -> BeginRequest {
    BeginRequest {
        session_id: session.to_string(),
        package_sha256: SHA.to_string(),
        command_id: "quick".to_string(),
        invocation_id: key.to_string(),
    }
}

fn begin(runs: &Runs, owner: &str, session: &str, key: &str) -> RunAdmission {
    runs.begin(owner, &request(session, key), |_| Ok(PACKAGE.to_string()))
}

fn refused(reason: RunRefusal) -> RunAdmission {
    RunAdmission::Refused { reason }
}

fn run_id(admission: &RunAdmission) -> String {
    match admission {
        RunAdmission::Admitted { scope } => scope.run_id.clone(),
        other => panic!("{other:?}"),
    }
}

struct Paused {
    started: mpsc::Receiver<()>,
    release: mpsc::Sender<()>,
    admission: thread::JoinHandle<RunAdmission>,
}

/// A begin whose package check says it started, then waits for `release`, then answers `outcome`.
fn paused_begin(
    runs: &Arc<Runs>,
    session: &str,
    key: &str,
    outcome: Result<String, RunRefusal>,
) -> Paused {
    let (started_tx, started) = mpsc::channel();
    let (release, release_rx) = mpsc::channel::<()>();
    let runs = Arc::clone(runs);
    let request = request(session, key);
    let admission = thread::spawn(move || {
        runs.begin("main", &request, move |_| {
            started_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            outcome
        })
    });
    started.recv().unwrap();
    Paused {
        started,
        release,
        admission,
    }
}

impl Paused {
    fn finish(self) -> RunAdmission {
        drop(self.started);
        self.release.send(()).unwrap();
        self.admission.join().unwrap()
    }
}

#[test]
fn sessions_answer_only_the_window_that_opened_them() {
    let runs = Runs::default();
    let session = open(&runs, "main");
    assert_eq!(
        begin(&runs, "other", &session, "k1"),
        refused(RunRefusal::SessionClosed)
    );
    assert_eq!(
        runs.close_session("other", &session),
        CloseSessionReply::Unknown
    );
    assert_eq!(
        runs.end_run("other", &session, "k1"),
        EndRunReply::UnknownSession
    );
    match begin(&runs, "main", &session, "k1") {
        RunAdmission::Admitted { scope } => {
            assert_eq!(
                (scope.session_id.as_str(), scope.invocation_id.as_str()),
                (session.as_str(), "k1")
            );
            assert_eq!(
                (scope.package_id.as_str(), scope.package_sha256.as_str()),
                (PACKAGE, SHA)
            );
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(
        runs.close_session("main", &session),
        CloseSessionReply::Closed
    );
    assert_eq!(
        begin(&runs, "main", &session, "k2"),
        refused(RunRefusal::SessionClosed)
    );
    // Closing again is harmless for its owner and tells another window nothing.
    assert_eq!(
        runs.close_session("main", &session),
        CloseSessionReply::Closed
    );
    assert_eq!(
        runs.close_session("other", &session),
        CloseSessionReply::Unknown
    );
    assert_eq!(
        runs.end_run("other", &session, "k1"),
        EndRunReply::UnknownSession
    );
    assert_eq!(runs.end_run("main", &session, "k1"), EndRunReply::Ended);
    // Returning to the same vault is a new session; the old one never comes back.
    let again = open(&runs, "main");
    assert_ne!(again, session);
    run_id(&begin(&runs, "main", &again, "k1"));
    assert_eq!(
        begin(&runs, "main", &session, "k3"),
        refused(RunRefusal::SessionClosed)
    );
}

#[test]
fn an_end_before_admission_keeps_the_request_out() {
    let runs = Runs::default();
    let session = open(&runs, "main");
    assert_eq!(runs.end_run("main", &session, "k1"), EndRunReply::Ended);
    assert_eq!(
        begin(&runs, "main", &session, "k1"),
        refused(RunRefusal::Cancelled)
    );
    assert_eq!(runs.end_run("main", &session, "k1"), EndRunReply::Ended);
    let run = run_id(&begin(&runs, "main", &session, "k2"));
    assert_eq!(
        begin(&runs, "main", &session, "k2"),
        refused(RunRefusal::Replayed)
    );
    assert_eq!(runs.end_run("main", &session, "k2"), EndRunReply::Ended);
    assert_eq!(
        begin(&runs, "main", &session, "k2"),
        refused(RunRefusal::Cancelled)
    );
    assert_eq!(
        runs.bind_folder("main", &run, ""),
        FolderHandleReply::Refused {
            reason: HandleRefusal::StaleRun
        }
    );
    assert_eq!(runs.live_slots(&session), Some(0));
}

#[test]
fn an_end_during_admission_refuses_it_and_gives_its_slot_back() {
    let runs = Arc::new(Runs::default());
    let session = open(&runs, "main");
    let pending = paused_begin(&runs, &session, "k1", Ok(PACKAGE.to_string()));
    assert_eq!(runs.live_slots(&session), Some(1));
    assert_eq!(runs.end_run("main", &session, "k1"), EndRunReply::Ended);
    assert_eq!(pending.finish(), refused(RunRefusal::Cancelled));
    assert_eq!(runs.live_slots(&session), Some(0));
    assert_eq!(
        begin(&runs, "main", &session, "k1"),
        refused(RunRefusal::Cancelled)
    );
}

/// Review finding 1: an acknowledged end of an unseen key at a full table, then a pending
/// admission that fails and frees its key, must still never admit the ended key.
#[test]
fn a_full_key_table_seals_the_session_instead_of_forgetting_an_end() {
    let runs = Arc::new(Runs::default());
    let session = open(&runs, "main");
    for number in 0..MAX_KEYS_PER_SESSION - 1 {
        assert_eq!(
            runs.end_run("main", &session, &format!("ended-{number}")),
            EndRunReply::Ended
        );
    }
    let pending = paused_begin(&runs, &session, "pending", Err(RunRefusal::NotActive));
    // The table is full now: the ended keys and one admission still checking.
    assert_eq!(runs.end_run("main", &session, "late"), EndRunReply::Ended);
    assert_eq!(pending.finish(), refused(RunRefusal::NotActive));
    assert_eq!(
        begin(&runs, "main", &session, "late"),
        refused(RunRefusal::Busy)
    );
    assert_eq!(
        begin(&runs, "main", &session, "fresh"),
        refused(RunRefusal::Busy)
    );
    assert_eq!(runs.live_slots(&session), Some(0));
}

/// Review finding 2: two admissions checking at once cannot both take the last live slot.
#[test]
fn concurrent_admissions_cannot_pass_the_live_bound_together() {
    let runs = Arc::new(Runs::default());
    let session = open(&runs, "main");
    for number in 0..MAX_LIVE_RUNS_PER_SESSION - 1 {
        run_id(&begin(&runs, "main", &session, &format!("run-{number}")));
    }
    let first = paused_begin(&runs, &session, "a", Ok(PACKAGE.to_string()));
    assert_eq!(
        begin(&runs, "main", &session, "b"),
        refused(RunRefusal::Busy)
    );
    run_id(&first.finish());
    assert_eq!(runs.live_slots(&session), Some(MAX_LIVE_RUNS_PER_SESSION));

    // A refused admission gives its reserved slot back exactly once.
    assert_eq!(runs.end_run("main", &session, "run-0"), EndRunReply::Ended);
    let failing = paused_begin(&runs, &session, "c", Err(RunRefusal::NotActive));
    assert_eq!(
        begin(&runs, "main", &session, "d"),
        refused(RunRefusal::Busy)
    );
    assert_eq!(failing.finish(), refused(RunRefusal::NotActive));
    assert_eq!(
        runs.live_slots(&session),
        Some(MAX_LIVE_RUNS_PER_SESSION - 1)
    );
    run_id(&begin(&runs, "main", &session, "e"));
}

#[test]
fn an_activation_change_during_admission_refuses_it() {
    let runs = Arc::new(Runs::default());
    let session = open(&runs, "main");
    let pending = paused_begin(&runs, &session, "k1", Ok(PACKAGE.to_string()));
    assert_eq!(runs.revoke_package(Path::new("/vault"), PACKAGE, None), 0);
    assert_eq!(pending.finish(), refused(RunRefusal::Busy));
    assert_eq!(runs.live_slots(&session), Some(0));
}

#[test]
fn deactivation_and_rollback_revoke_matching_runs() {
    let runs = Runs::default();
    let session = open(&runs, "main");
    let kept = run_id(&begin(&runs, "main", &session, "k1"));
    assert_eq!(
        runs.revoke_package(Path::new("/vault"), PACKAGE, Some(SHA)),
        0
    );
    assert_eq!(
        runs.revoke_package(Path::new("/elsewhere"), PACKAGE, None),
        0
    );
    assert_eq!(runs.revoke_package(Path::new("/vault"), PACKAGE, None), 1);
    assert_eq!(
        runs.bind_folder("main", &kept, ""),
        FolderHandleReply::Refused {
            reason: HandleRefusal::StaleRun
        }
    );
    assert_eq!(
        begin(&runs, "main", &session, "k1"),
        refused(RunRefusal::Cancelled)
    );
    assert_eq!(runs.live_slots(&session), Some(0));
}

#[test]
fn a_reloaded_or_destroyed_window_loses_only_its_own_sessions() {
    let runs = Runs::default();
    let mine = open(&runs, "main");
    let theirs = open(&runs, "second");
    runs.forget_owner("main");
    assert_eq!(
        begin(&runs, "main", &mine, "k1"),
        refused(RunRefusal::SessionClosed)
    );
    run_id(&begin(&runs, "second", &theirs, "k1"));
    assert_eq!(runs.close_session("main", &mine), CloseSessionReply::Closed);
}

#[test]
fn opening_too_many_sessions_closes_the_oldest_of_that_window() {
    let runs = Runs::default();
    let sessions: Vec<String> = (0..=MAX_SESSIONS_PER_OWNER)
        .map(|_| open(&runs, "main"))
        .collect();
    assert_eq!(
        begin(&runs, "main", &sessions[0], "k1"),
        refused(RunRefusal::SessionClosed)
    );
    for session in &sessions[1..] {
        run_id(&begin(&runs, "main", session, "k1"));
    }
}
