//! Activation changes end to end through `Extensions`: the answer, the runs it revokes, admission
//! and what a restart finds all agree. That holds when the store's folder cannot be synced, when
//! a change is not published, and when two changes overlap. Store effects come from `FaultyIo`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use tempfile::TempDir;

use super::create::NativeCreateIo;
use super::store::Store;
use super::store_tests::{Faults, FaultyIo};
use super::wire::{
    ActivationRefusal, ActivationReply, DeactivationRefusal, DeactivationReply, FolderHandleReply,
    ImportReply, ListReply, OpenSessionReply, ReadReply, RunAdmission, RunRefusal,
};
use super::{test_roots, BeginRequest, Extensions};

const PACKAGE: &str = "local.quick-note";

fn quick(version: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/leadinglight/extensions/fixtures/quick-note.json");
    fs::read_to_string(path).unwrap().replacen(
        "\"version\": \"1.0.0\"",
        &format!("\"version\": \"{version}\""),
        1,
    )
}

fn active(sha: &str, previous: Option<&str>, revoked_runs: u64) -> ActivationReply {
    ActivationReply::Active {
        package_sha256: sha.to_string(),
        previous_sha256: previous.map(str::to_string),
        revoked_runs,
    }
}

fn not_active() -> RunAdmission {
    RunAdmission::Refused {
        reason: RunRefusal::NotActive,
    }
}

struct World {
    _dir: TempDir,
    store: PathBuf,
    vault: PathBuf,
    faults: Arc<Faults>,
    extensions: Arc<Extensions>,
}

fn world() -> World {
    let dir = tempfile::tempdir().unwrap();
    let vault = dir.path().join("vault");
    fs::create_dir_all(vault.join("Meetings")).unwrap();
    let store = dir.path().join("store");
    let faults = Arc::new(Faults::default());
    let io = Box::new(FaultyIo(Arc::clone(&faults)));
    let extensions =
        Extensions::from_parts(Store::with_io(store.clone(), io), Box::new(NativeCreateIo));
    World {
        _dir: dir,
        store,
        vault,
        faults,
        extensions: Arc::new(extensions),
    }
}

impl World {
    fn import(&self, version: &str) -> String {
        match self.extensions.import(&quick(version)) {
            ImportReply::Candidate { package_sha256, .. } => package_sha256,
            other => panic!("{other:?}"),
        }
    }

    fn activate(&self, sha: &str, expected: Option<&str>) -> ActivationReply {
        self.extensions
            .activate(Some(&test_roots(&self.vault)), PACKAGE, sha, expected)
    }

    /// The same change from another thread.
    fn activate_elsewhere(&self, sha: &str, expected: &str) -> thread::JoinHandle<ActivationReply> {
        let extensions = Arc::clone(&self.extensions);
        let roots = test_roots(&self.vault);
        let (sha, expected) = (sha.to_string(), expected.to_string());
        thread::spawn(move || extensions.activate(Some(&roots), PACKAGE, &sha, Some(&expected)))
    }

    fn deactivate(&self, expected: &str) -> DeactivationReply {
        self.extensions
            .deactivate(Some(&test_roots(&self.vault)), PACKAGE, expected)
    }

    fn session(&self) -> String {
        match self
            .extensions
            .open_session("main", Some(&test_roots(&self.vault)))
        {
            OpenSessionReply::Open { session_id } => session_id,
            other => panic!("{other:?}"),
        }
    }

    fn begin(&self, session: &str, key: &str, sha: &str) -> RunAdmission {
        let request = BeginRequest {
            session_id: session.to_string(),
            package_sha256: sha.to_string(),
            command_id: "quick".to_string(),
            invocation_id: key.to_string(),
        };
        self.extensions.begin_run("main", &request)
    }

    fn run(&self, session: &str, key: &str, sha: &str) -> String {
        match self.begin(session, key, sha) {
            RunAdmission::Admitted { scope } => scope.run_id,
            other => panic!("{other:?}"),
        }
    }

    /// A run that can still bind a folder has not been revoked.
    fn live(&self, run: &str) -> bool {
        matches!(
            self.extensions.bind_folder("main", run, "Meetings"),
            FolderHandleReply::Bound { .. }
        )
    }

    /// The active and previous versions a restarted app finds.
    fn after_restart(&self) -> (Option<String>, Option<String>) {
        let restarted = Extensions::new(self.store.clone());
        let listed = restarted.list(Some(&test_roots(&self.vault)));
        let ListReply::Ok { extensions } = listed else {
            panic!("{listed:?}");
        };
        let quick = extensions
            .into_iter()
            .find(|extension| extension.package_id == PACKAGE)
            .unwrap();
        (quick.active_sha256, quick.previous_sha256)
    }
}

/// Review finding 1: a change in place whose folder sync failed is answered as made, admission
/// follows it, the replaced version's runs are revoked, and a restart finds the same.
#[test]
fn a_change_in_place_but_unsynced_is_answered_and_revokes_like_any_other() {
    let world = world();
    let a = world.import("1.0.0");
    let b = world.import("1.0.1");
    assert_eq!(world.activate(&a, None), active(&a, None, 0));
    let session = world.session();
    let run_a = world.run(&session, "k1", &a);
    world.faults.unsynced.store(true, Ordering::SeqCst);

    assert_eq!(world.activate(&b, Some(&a)), active(&b, Some(&a), 1));
    assert!(!world.live(&run_a));
    assert_eq!(world.begin(&session, "k2", &a), not_active());
    let run_b = world.run(&session, "k3", &b);
    assert_eq!(world.after_restart(), (Some(b.clone()), Some(a.clone())));

    assert_eq!(
        world.deactivate(&b),
        DeactivationReply::Inactive { revoked_runs: 1 }
    );
    assert!(!world.live(&run_b));
    assert_eq!(world.begin(&session, "k4", &b), not_active());
    assert_eq!(world.after_restart(), (None, Some(b.clone())));

    // An import in place is kept too, with its package file.
    let c = world.import("1.0.2");
    assert!(matches!(
        Extensions::new(world.store.clone()).read(&c),
        ReadReply::Ok { .. }
    ));
}

/// A change that was not published is refused, revokes nothing, and a restart finds the old state.
#[test]
fn a_change_that_was_not_published_is_refused_and_revokes_nothing() {
    let world = world();
    let a = world.import("1.0.0");
    let b = world.import("1.0.1");
    world.activate(&a, None);
    let session = world.session();
    let run_a = world.run(&session, "k1", &a);
    world.faults.unpublished.store(true, Ordering::SeqCst);

    assert_eq!(
        world.activate(&b, Some(&a)),
        ActivationReply::Refused {
            reason: ActivationRefusal::VaultUnavailable,
            missing_capabilities: Vec::new()
        }
    );
    assert_eq!(
        world.deactivate(&a),
        DeactivationReply::Refused {
            reason: DeactivationRefusal::VaultUnavailable
        }
    );
    assert!(world.live(&run_a));
    assert_eq!(world.begin(&session, "k2", &b), not_active());
    world.run(&session, "k3", &a);
    assert_eq!(world.after_restart(), (Some(a.clone()), None));
}

/// Review finding 4: A→B is published and then held before it revokes anything. B→C waits for it,
/// so C cannot be admitted until A→B has revoked A's runs, and A→B can never revoke a run of C.
/// Each change revokes exactly the runs of the version it replaced.
#[test]
fn overlapping_changes_revoke_in_order() {
    let world = world();
    let a = world.import("1.0.0");
    let b = world.import("1.0.1");
    let c = world.import("1.0.2");
    world.activate(&a, None);
    let session = world.session();
    let run_a = world.run(&session, "a", &a);

    let (started, release) = world.faults.pause_next_sync();
    let first = world.activate_elsewhere(&b, &a);
    started.recv().unwrap();
    // B is in place, so its runs are admitted; the held change keeps them.
    let run_b = world.run(&session, "b", &b);
    let (answered_tx, answered) = mpsc::channel();
    let second = {
        let pending = world.activate_elsewhere(&c, &b);
        thread::spawn(move || {
            let reply = pending.join().unwrap();
            answered_tx.send(()).unwrap();
            reply
        })
    };
    assert!(answered.recv_timeout(Duration::from_millis(200)).is_err());
    assert_eq!(world.begin(&session, "c-early", &c), not_active());

    release.send(()).unwrap();
    assert_eq!(first.join().unwrap(), active(&b, Some(&a), 1));
    assert_eq!(second.join().unwrap(), active(&c, Some(&b), 1));
    let run_c = world.run(&session, "c", &c);
    assert!(world.live(&run_c));
    assert!(!world.live(&run_b));
    assert!(!world.live(&run_a));
    assert_eq!(world.after_restart(), (Some(c.clone()), Some(b.clone())));
}
