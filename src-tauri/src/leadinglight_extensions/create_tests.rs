//! The one write a run may make, end to end through `Extensions`, in disposable vaults. Writes
//! that must be paused or must fail use a test `CreateIo`; everything else is the real filesystem.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use tempfile::{PathPersistError, TempDir, TempPath};

use super::create::{CreateIo, NativeCreateIo};
use super::runs::MAX_OPERATIONS;
use super::wire::{
    ActivationReply, CloseSessionReply, CommitKind, ConflictReason, DeactivationReply,
    DocumentHandleReply, EndRunReply, FolderHandleReply, GuardedProposal, HandleRefusal,
    ImportReply, ListReply, OpenSessionReply, ProposalReceipt, ProposalRefusal, QueryReply,
    QueryState, RunAdmission, RunRefusal,
};
use super::{hex, test_roots, BeginRequest, Extensions};
use crate::vault::staged_file::{sha256, NativePlatform, Platform};

const PACKAGE: &str = "local.quick-note";
const TEXT: &str = "# Debrief: Roadmap\n\nShip v1.\n";

fn quick_note() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/leadinglight/extensions/fixtures/quick-note.json");
    fs::read_to_string(path).unwrap()
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

struct World {
    _dir: TempDir,
    store: PathBuf,
    vault: PathBuf,
    extensions: Arc<Extensions>,
    sha: String,
}

fn world_with(io: Box<dyn CreateIo>) -> World {
    let dir = tempfile::tempdir().unwrap();
    let vault = dir.path().join("vault");
    fs::create_dir_all(vault.join("Meetings")).unwrap();
    let store = dir.path().join("store");
    let extensions = Extensions::with_io(store.clone(), io);
    let sha = match extensions.import(&quick_note()) {
        ImportReply::Candidate { package_sha256, .. } => package_sha256,
        other => panic!("{other:?}"),
    };
    let active = extensions.activate(Some(&test_roots(&vault)), PACKAGE, &sha, None);
    assert!(
        matches!(active, ActivationReply::Active { .. }),
        "{active:?}"
    );
    World {
        _dir: dir,
        store,
        vault,
        extensions: Arc::new(extensions),
        sha,
    }
}

fn world() -> World {
    world_with(Box::new(NativeCreateIo))
}

impl World {
    fn session(&self, owner: &str) -> String {
        match self
            .extensions
            .open_session(owner, Some(&test_roots(&self.vault)))
        {
            OpenSessionReply::Open { session_id } => session_id,
            other => panic!("{other:?}"),
        }
    }

    fn run(&self, owner: &str, session: &str, key: &str) -> String {
        let request = BeginRequest {
            session_id: session.to_string(),
            package_sha256: self.sha.clone(),
            command_id: "quick".to_string(),
            invocation_id: key.to_string(),
        };
        match self.extensions.begin_run(owner, &request) {
            RunAdmission::Admitted { scope } => scope.run_id,
            other => panic!("{other:?}"),
        }
    }

    fn folder(&self, owner: &str, run: &str, folder: &str) -> String {
        match self.extensions.bind_folder(owner, run, folder) {
            FolderHandleReply::Bound { folder_handle, .. } => folder_handle,
            other => panic!("{other:?}"),
        }
    }

    /// A new session, an admitted run and the Meetings folder bound to it.
    fn ready(&self, owner: &str) -> (String, String, String) {
        let session = self.session(owner);
        let run = self.run(owner, &session, "k1");
        let folder = self.folder(owner, &run, "Meetings");
        (session, run, folder)
    }

    fn page(&self, name: &str) -> PathBuf {
        self.vault.join("Meetings").join(name)
    }

    fn pages(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(self.vault.join("Meetings"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}

fn proposal(
    operation_id: &str,
    run_id: &str,
    folder: &str,
    file_name: &str,
    text: &str,
) -> GuardedProposal {
    GuardedProposal::Create {
        operation_id: operation_id.to_string(),
        run_id: run_id.to_string(),
        content: text.to_string(),
        content_sha256: hex(&sha256(text.as_bytes())),
        folder_handle: folder.to_string(),
        file_name: file_name.to_string(),
    }
}

fn refused(operation_id: &str, reason: ProposalRefusal) -> ProposalReceipt {
    ProposalReceipt::refused(operation_id, reason)
}

fn committed(world: &World, operation_id: &str, name: &str, text: &str) -> ProposalReceipt {
    ProposalReceipt::Committed {
        kind: CommitKind::Create,
        operation_id: operation_id.to_string(),
        path: world.page(name).to_string_lossy().into_owned(),
        before_sha256: None,
        after_sha256: hex(&sha256(text.as_bytes())),
        durable: true,
        undo_receipt: None,
    }
}

// --- Test filesystem effects ---------------------------------------------------------------------

/// Publishes for real, but only after the test releases it.
struct Gate {
    started: Mutex<Option<mpsc::Sender<()>>>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl CreateIo for Gate {
    fn persist(&self, staged: TempPath, target: &Path) -> Result<(), PathPersistError> {
        if let Some(started) = self.started.lock().unwrap().take() {
            started.send(()).unwrap();
        }
        self.release.lock().unwrap().recv().unwrap();
        staged.persist_noclobber(target)
    }

    fn sync_dir(&self, dir: &Path) -> std::io::Result<()> {
        NativePlatform.sync_dir(dir)
    }
}

fn gated() -> (World, mpsc::Receiver<()>, mpsc::Sender<()>) {
    let (started_tx, started) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    let gate = Gate {
        started: Mutex::new(Some(started_tx)),
        release: Mutex::new(release_rx),
    };
    (world_with(Box::new(gate)), started, release)
}

/// Each case changes the filesystem around a publication.
enum Twist {
    /// Another file takes the name just before publication.
    NameTaken,
    /// The staged copy vanishes and the publish fails: nothing provable either way.
    Lost,
    /// The page is linked into place, but the reply is a failure.
    PublishedThenFailed,
    /// After publication, another writer grows the page before it is read back.
    Grown,
    /// After publication, the page is replaced by another file before it is read back.
    Replaced,
}

struct Twisted {
    twist: Twist,
    target: PathBuf,
}

impl CreateIo for Twisted {
    fn persist(&self, staged: TempPath, target: &Path) -> Result<(), PathPersistError> {
        let failed = |staged| PathPersistError {
            error: std::io::Error::other("lost reply"),
            path: staged,
        };
        match self.twist {
            Twist::NameTaken => {
                fs::write(target, "someone else's page").unwrap();
                staged.persist_noclobber(target)
            }
            Twist::Lost => {
                fs::rename(&staged, target.with_extension("moved-away")).unwrap();
                Err(failed(staged))
            }
            Twist::PublishedThenFailed => {
                fs::hard_link(&staged, target).unwrap();
                Err(failed(staged))
            }
            Twist::Grown | Twist::Replaced => staged.persist_noclobber(target),
        }
    }

    fn sync_dir(&self, dir: &Path) -> std::io::Result<()> {
        match self.twist {
            Twist::Grown => {
                let mut page = fs::OpenOptions::new()
                    .append(true)
                    .open(&self.target)
                    .unwrap();
                page.write_all(&vec![b'x'; 4 * 1024 * 1024]).unwrap();
            }
            Twist::Replaced => {
                fs::rename(&self.target, self.target.with_extension("old")).unwrap();
                fs::write(&self.target, TEXT).unwrap();
            }
            _ => {}
        }
        NativePlatform.sync_dir(dir)
    }
}

/// A world whose writes go through `twist`; the same store, so the package stays active.
fn twisted(twist: Twist) -> World {
    let world = world();
    let target = world.page("Debrief.md");
    let extensions = Extensions::with_io(world.store.clone(), Box::new(Twisted { twist, target }));
    World {
        extensions: Arc::new(extensions),
        ..world
    }
}

// --- Behaviour -----------------------------------------------------------------------------------

#[test]
fn creates_one_new_page_and_reports_exactly_what_was_written() {
    let world = world();
    let (_, run, folder) = world.ready("main");
    let operation = uuid();
    let receipt = world.extensions.submit(
        "main",
        &proposal(&operation, &run, &folder, "Debrief.md", TEXT),
    );
    assert_eq!(receipt, committed(&world, &operation, "Debrief.md", TEXT));
    assert_eq!(fs::read_to_string(world.page("Debrief.md")).unwrap(), TEXT);
    assert_eq!(world.pages(), ["Debrief.md"]);
    assert_eq!(
        world.extensions.query("main", &operation),
        QueryReply::Receipt(receipt)
    );
    assert_eq!(
        world.extensions.query("other", &operation),
        QueryReply::State(QueryState::Unknown {
            operation_id: operation.clone()
        })
    );
}

#[test]
fn one_operation_id_is_one_write_whatever_is_resent() {
    let world = world();
    let (_, run, folder) = world.ready("main");
    let operation = uuid();
    let original = proposal(&operation, &run, &folder, "Debrief.md", TEXT);
    let receipt = world.extensions.submit("main", &original);
    assert!(
        matches!(receipt, ProposalReceipt::Committed { .. }),
        "{receipt:?}"
    );
    assert_eq!(world.extensions.submit("main", &original), receipt);
    let renamed = proposal(&operation, &run, &folder, "Other.md", TEXT);
    assert_eq!(
        world.extensions.submit("main", &renamed),
        refused(&operation, ProposalRefusal::OperationMismatch)
    );
    assert_eq!(
        world.extensions.submit("other", &original),
        refused(&operation, ProposalRefusal::OperationMismatch)
    );
    let second = uuid();
    let again = proposal(&second, &run, &folder, "Second.md", TEXT);
    assert_eq!(
        world.extensions.submit("main", &again),
        refused(&second, ProposalRefusal::OperationMismatch)
    );
    let (_, other_run, other_folder) = world.ready("main");
    let moved = proposal(&operation, &other_run, &other_folder, "Third.md", TEXT);
    assert_eq!(
        world.extensions.submit("main", &moved),
        refused(&operation, ProposalRefusal::OperationMismatch)
    );
    assert_eq!(world.pages(), ["Debrief.md"]);
}

/// Review finding 3: no record is ever dropped, so a full ledger refuses new work and an old id
/// can neither write again nor take a new answer.
#[test]
fn a_full_ledger_refuses_new_work_and_never_forgets_an_id() {
    let world = world();
    let (_, run, folder) = world.ready("main");
    let operation = uuid();
    let original = proposal(&operation, &run, &folder, "Debrief.md", TEXT);
    let receipt = world.extensions.submit("main", &original);
    for _ in 1..MAX_OPERATIONS {
        let filler = uuid();
        let stale = proposal(&filler, "run-missing", "folder-missing", "Filler.md", TEXT);
        assert_eq!(
            world.extensions.submit("main", &stale),
            refused(&filler, ProposalRefusal::StaleRun)
        );
    }
    assert_eq!(world.extensions.runs.recorded_operations(), MAX_OPERATIONS);
    let (_, run2, folder2) = world.ready("main");
    let fresh = uuid();
    let new_work = proposal(&fresh, &run2, &folder2, "New.md", TEXT);
    assert_eq!(
        world.extensions.submit("main", &new_work),
        refused(&fresh, ProposalRefusal::Busy)
    );
    // The refusal is not recorded, so nothing was dropped to make room for it.
    assert_eq!(world.extensions.runs.recorded_operations(), MAX_OPERATIONS);
    assert_eq!(
        world.extensions.query("main", &fresh),
        QueryReply::State(QueryState::Unknown {
            operation_id: fresh.clone()
        })
    );
    let reused = proposal(&operation, &run2, &folder2, "Again.md", TEXT);
    assert_eq!(
        world.extensions.submit("main", &reused),
        refused(&operation, ProposalRefusal::OperationMismatch)
    );
    assert_eq!(world.extensions.submit("main", &original), receipt);
    assert_eq!(
        world.extensions.query("main", &operation),
        QueryReply::Receipt(receipt)
    );
    assert_eq!(world.pages(), ["Debrief.md"]);
}

#[test]
fn a_duplicate_waits_for_the_running_write_and_gets_its_answer() {
    let (world, started, release) = gated();
    let (_, run, folder) = world.ready("main");
    let operation = uuid();
    let request = proposal(&operation, &run, &folder, "Debrief.md", TEXT);
    let first = {
        let extensions = Arc::clone(&world.extensions);
        let request = request.clone();
        thread::spawn(move || extensions.submit("main", &request))
    };
    started.recv().unwrap();
    assert_eq!(
        world.extensions.query("main", &operation),
        QueryReply::State(QueryState::Running {
            operation_id: operation.clone()
        })
    );
    let (answered, answer) = mpsc::channel();
    let duplicate = {
        let extensions = Arc::clone(&world.extensions);
        thread::spawn(move || {
            let receipt = extensions.submit("main", &request);
            answered.send(()).unwrap();
            receipt
        })
    };
    assert!(answer.recv_timeout(Duration::from_millis(200)).is_err());
    release.send(()).unwrap();
    let first = first.join().unwrap();
    assert_eq!(first, committed(&world, &operation, "Debrief.md", TEXT));
    assert_eq!(duplicate.join().unwrap(), first);
    assert_eq!(world.pages(), ["Debrief.md"]);
}

/// Review finding 4, and the close barrier: another window learns nothing and joins nothing,
/// before or after the logical close; the owner's close waits for the admitted write.
#[test]
fn closing_waits_for_an_admitted_write_and_other_windows_cannot_join_it() {
    let (world, started, release) = gated();
    let (session, run, folder) = world.ready("main");
    let operation = uuid();
    let request = proposal(&operation, &run, &folder, "Debrief.md", TEXT);
    let write = {
        let extensions = Arc::clone(&world.extensions);
        thread::spawn(move || extensions.submit("main", &request))
    };
    started.recv().unwrap();
    assert_eq!(
        world.extensions.close_session("other", &session),
        CloseSessionReply::Unknown
    );
    assert_eq!(
        world.extensions.end_run("other", &session, "k1"),
        EndRunReply::UnknownSession
    );
    let (closed_tx, closed) = mpsc::channel();
    let closer = {
        let extensions = Arc::clone(&world.extensions);
        let session = session.clone();
        thread::spawn(move || {
            closed_tx
                .send(extensions.close_session("main", &session))
                .unwrap()
        })
    };
    assert!(closed.recv_timeout(Duration::from_millis(200)).is_err());
    assert_eq!(
        world.extensions.close_session("other", &session),
        CloseSessionReply::Unknown
    );
    assert_eq!(
        world.extensions.end_run("other", &session, "k1"),
        EndRunReply::UnknownSession
    );
    release.send(()).unwrap();
    assert_eq!(closed.recv().unwrap(), CloseSessionReply::Closed);
    closer.join().unwrap();
    // The write admitted before the close keeps its true result.
    assert_eq!(
        write.join().unwrap(),
        committed(&world, &operation, "Debrief.md", TEXT)
    );
    assert_eq!(
        world.extensions.close_session("main", &session),
        CloseSessionReply::Closed
    );
}

#[test]
fn ending_a_run_waits_for_its_write() {
    let (world, started, release) = gated();
    let (session, run, folder) = world.ready("main");
    let operation = uuid();
    let request = proposal(&operation, &run, &folder, "Debrief.md", TEXT);
    let write = {
        let extensions = Arc::clone(&world.extensions);
        thread::spawn(move || extensions.submit("main", &request))
    };
    started.recv().unwrap();
    let (ended_tx, ended) = mpsc::channel();
    let ender = {
        let extensions = Arc::clone(&world.extensions);
        thread::spawn(move || {
            ended_tx
                .send(extensions.end_run("main", &session, "k1"))
                .unwrap()
        })
    };
    assert!(ended.recv_timeout(Duration::from_millis(200)).is_err());
    release.send(()).unwrap();
    assert_eq!(ended.recv().unwrap(), EndRunReply::Ended);
    ender.join().unwrap();
    assert!(matches!(
        write.join().unwrap(),
        ProposalReceipt::Committed { .. }
    ));
}

/// Turning a package off waits for a write of its runs, even one an end already revoked.
#[test]
fn turning_a_package_off_waits_for_its_runs_writes() {
    let (world, started, release) = gated();
    let (session, run, folder) = world.ready("main");
    let operation = uuid();
    let request = proposal(&operation, &run, &folder, "Debrief.md", TEXT);
    let write = {
        let extensions = Arc::clone(&world.extensions);
        thread::spawn(move || extensions.submit("main", &request))
    };
    started.recv().unwrap();
    let ender = {
        let extensions = Arc::clone(&world.extensions);
        thread::spawn(move || extensions.end_run("main", &session, "k1"))
    };
    thread::sleep(Duration::from_millis(100));
    let (off_tx, off) = mpsc::channel();
    let turner = {
        let extensions = Arc::clone(&world.extensions);
        let roots = test_roots(&world.vault);
        let sha = world.sha.clone();
        thread::spawn(move || {
            off_tx
                .send(extensions.deactivate(Some(&roots), PACKAGE, &sha))
                .unwrap()
        })
    };
    assert!(off.recv_timeout(Duration::from_millis(200)).is_err());
    // While it joins, the preference lock is free: listing and importing still answer.
    assert!(matches!(
        world.extensions.list(Some(&test_roots(&world.vault))),
        ListReply::Ok { .. }
    ));
    assert!(matches!(
        world.extensions.import(&quick_note()),
        ImportReply::Candidate { .. }
    ));
    release.send(()).unwrap();
    assert!(matches!(
        off.recv().unwrap(),
        DeactivationReply::Inactive { .. }
    ));
    assert_eq!(ender.join().unwrap(), EndRunReply::Ended);
    turner.join().unwrap();
    assert!(matches!(
        write.join().unwrap(),
        ProposalReceipt::Committed { .. }
    ));
}

#[test]
fn never_writes_over_an_existing_page_even_when_the_name_is_taken_meanwhile() {
    let world = world();
    fs::write(world.page("Taken.md"), "mine").unwrap();
    let (_, run, folder) = world.ready("main");
    let operation = uuid();
    let receipt = world.extensions.submit(
        "main",
        &proposal(&operation, &run, &folder, "Taken.md", TEXT),
    );
    let exists = ProposalReceipt::Conflict {
        operation_id: operation.clone(),
        reason: ConflictReason::Exists,
    };
    assert_eq!(receipt, exists);
    assert_eq!(fs::read_to_string(world.page("Taken.md")).unwrap(), "mine");

    let raced = twisted(Twist::NameTaken);
    let (_, run, folder) = raced.ready("main");
    let operation = uuid();
    let receipt = raced.extensions.submit(
        "main",
        &proposal(&operation, &run, &folder, "Debrief.md", TEXT),
    );
    assert_eq!(
        receipt,
        ProposalReceipt::Conflict {
            operation_id: operation.clone(),
            reason: ConflictReason::Exists
        }
    );
    assert_eq!(
        fs::read_to_string(raced.page("Debrief.md")).unwrap(),
        "someone else's page"
    );
    assert_eq!(raced.pages(), ["Debrief.md"]);
}

#[test]
fn refuses_bad_names_sizes_and_digests_before_writing() {
    let world = world();
    let session = world.session("main");
    let mut key = 0;
    let mut submit = |file_name: &str, text: &str, digest: Option<&str>| {
        key += 1;
        let run = world.run("main", &session, &format!("k{key}"));
        let folder = world.folder("main", &run, "Meetings");
        let operation = uuid();
        let mut request = proposal(&operation, &run, &folder, file_name, text);
        if let (Some(wrong), GuardedProposal::Create { content_sha256, .. }) =
            (digest, &mut request)
        {
            *content_sha256 = wrong.to_string();
        }
        let receipt = world.extensions.submit("main", &request);
        assert_eq!(
            world
                .extensions
                .end_run("main", &session, &format!("k{key}")),
            EndRunReply::Ended
        );
        (operation, receipt)
    };
    let long = format!("{}.md", "x".repeat(260));
    let bell = format!("Bell{}.md", char::from(7));
    for name in [
        "../Escape.md",
        "Sub/Page.md",
        ".hidden.md",
        "Page.txt",
        "con.md",
        "Trailing .md",
        " Lead.md",
        ".md",
        long.as_str(),
        bell.as_str(),
    ] {
        let (operation, receipt) = submit(name, TEXT, None);
        assert_eq!(
            receipt,
            refused(&operation, ProposalRefusal::InvalidName),
            "{name:?}"
        );
    }
    let large = "x".repeat(1024 * 1024 + 1);
    let (operation, receipt) = submit("Large.md", &large, None);
    assert_eq!(receipt, refused(&operation, ProposalRefusal::TooLarge));
    let (operation, receipt) = submit("Digest.md", TEXT, Some(&"0".repeat(64)));
    assert_eq!(
        receipt,
        refused(&operation, ProposalRefusal::DigestMismatch)
    );
    let (operation, receipt) = submit("Digest.md", TEXT, Some("not a digest"));
    assert_eq!(
        receipt,
        refused(&operation, ProposalRefusal::DigestMismatch)
    );
    assert!(world.pages().is_empty());
}

#[test]
fn binds_only_real_visible_folders_inside_the_vault() {
    let world = world();
    let outside = world._dir.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::create_dir_all(world.vault.join(".leadinglight")).unwrap();
    fs::create_dir_all(world.vault.join("Real").join("Inner")).unwrap();
    fs::write(world.vault.join("page.md"), "a page").unwrap();
    std::os::unix::fs::symlink(&outside, world.vault.join("Linked")).unwrap();
    std::os::unix::fs::symlink(world.vault.join("Real"), world.vault.join("Alias")).unwrap();
    let session = world.session("main");
    let run = world.run("main", &session, "k1");
    let bind = |folder: &str| world.extensions.bind_folder("main", &run, folder);
    let refused = |reason| FolderHandleReply::Refused { reason };
    assert_eq!(bind("../outside"), refused(HandleRefusal::OutsideVault));
    assert_eq!(
        bind(&outside.to_string_lossy()),
        refused(HandleRefusal::OutsideVault)
    );
    assert_eq!(bind(".leadinglight"), refused(HandleRefusal::OutsideVault));
    assert_eq!(bind("Real/../.."), refused(HandleRefusal::OutsideVault));
    assert_eq!(bind("Missing"), refused(HandleRefusal::Missing));
    assert_eq!(bind("page.md"), refused(HandleRefusal::NotFolder));
    assert_eq!(bind("Linked"), refused(HandleRefusal::Link));
    assert_eq!(bind("Alias/Inner"), refused(HandleRefusal::Link));
    assert!(
        matches!(bind("Real/Inner"), FolderHandleReply::Bound { display_path, .. } if display_path == "Real/Inner")
    );
    assert!(
        matches!(bind(""), FolderHandleReply::Bound { display_path, .. } if display_path.is_empty())
    );
    assert_eq!(
        world.extensions.bind_folder("other", &run, "Real"),
        refused(HandleRefusal::StaleRun)
    );
    assert_eq!(
        world.extensions.bind_document(),
        DocumentHandleReply::Refused {
            reason: HandleRefusal::Unsupported
        }
    );
}

#[test]
fn a_folder_replaced_or_removed_after_binding_is_never_written() {
    let world = world();
    let outside = world._dir.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    let cases: [(&str, ProposalRefusal); 3] = [
        ("replaced", ProposalRefusal::HandleMismatch),
        ("linked", ProposalRefusal::HandleMismatch),
        ("removed", ProposalRefusal::StorageUnavailable),
    ];
    for (case, expected) in cases {
        fs::create_dir_all(world.vault.join("Meetings")).unwrap();
        let (_, run, folder) = world.ready("main");
        let meetings = world.vault.join("Meetings");
        let kept = world.vault.join(format!("Kept-{case}"));
        match case {
            "replaced" => {
                fs::rename(&meetings, &kept).unwrap();
                fs::create_dir(&meetings).unwrap();
            }
            "linked" => {
                fs::rename(&meetings, &kept).unwrap();
                std::os::unix::fs::symlink(&outside, &meetings).unwrap();
            }
            _ => fs::remove_dir(&meetings).unwrap(),
        }
        let operation = uuid();
        let receipt = world.extensions.submit(
            "main",
            &proposal(&operation, &run, &folder, "Debrief.md", TEXT),
        );
        assert_eq!(receipt, refused(&operation, expected), "{case}");
        assert!(!outside.join("Debrief.md").exists(), "{case}");
        assert!(!kept.join("Debrief.md").exists(), "{case}");
        if fs::symlink_metadata(&meetings).is_ok_and(|meta| meta.file_type().is_symlink()) {
            fs::remove_file(&meetings).unwrap();
        } else if meetings.exists() {
            assert!(!meetings.join("Debrief.md").exists(), "{case}");
            fs::remove_dir_all(&meetings).unwrap();
        }
    }
}

#[test]
fn a_folder_that_cannot_be_written_proves_nothing_was_written() {
    use std::os::unix::fs::PermissionsExt;

    let world = world();
    let (_, run, folder) = world.ready("main");
    let meetings = world.vault.join("Meetings");
    fs::set_permissions(&meetings, fs::Permissions::from_mode(0o555)).unwrap();
    let probe = meetings.join("probe");
    if fs::write(&probe, "").is_ok() {
        // Running as a user that ignores permissions; nothing to prove here.
        fs::remove_file(probe).unwrap();
        fs::set_permissions(&meetings, fs::Permissions::from_mode(0o755)).unwrap();
        return;
    }
    let operation = uuid();
    let receipt = world.extensions.submit(
        "main",
        &proposal(&operation, &run, &folder, "Debrief.md", TEXT),
    );
    fs::set_permissions(&meetings, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        receipt,
        refused(&operation, ProposalRefusal::StorageUnavailable)
    );
    assert!(world.pages().is_empty());
}

#[test]
fn an_unprovable_publication_is_uncertain_and_keeps_its_record() {
    let lost = twisted(Twist::Lost);
    let (_, run, folder) = lost.ready("main");
    let operation = uuid();
    let request = proposal(&operation, &run, &folder, "Debrief.md", TEXT);
    let receipt = lost.extensions.submit("main", &request);
    assert_eq!(receipt, ProposalReceipt::uncertain(&operation));
    assert_eq!(
        lost.extensions.query("main", &operation),
        QueryReply::Receipt(receipt.clone())
    );
    assert_eq!(lost.extensions.submit("main", &request), receipt);

    let linked = twisted(Twist::PublishedThenFailed);
    let (_, run, folder) = linked.ready("main");
    let operation = uuid();
    let receipt = linked.extensions.submit(
        "main",
        &proposal(&operation, &run, &folder, "Debrief.md", TEXT),
    );
    assert_eq!(receipt, committed(&linked, &operation, "Debrief.md", TEXT));
}

/// Review finding 5: the read-back is bounded and checks the handle and the path, so a page
/// changed after publication is uncertain, never a confirmed write, and is kept.
#[test]
fn a_page_changed_before_it_is_read_back_is_uncertain() {
    for twist in [Twist::Grown, Twist::Replaced] {
        let world = twisted(twist);
        let (_, run, folder) = world.ready("main");
        let operation = uuid();
        let receipt = world.extensions.submit(
            "main",
            &proposal(&operation, &run, &folder, "Debrief.md", TEXT),
        );
        assert_eq!(receipt, ProposalReceipt::uncertain(&operation));
        assert!(world.page("Debrief.md").exists());
    }
}

#[test]
fn a_page_held_by_another_writer_is_busy() {
    let world = world();
    let (_, run, folder) = world.ready("main");
    let held = crate::leadinglight_history::lease(&[world.page("Debrief.md")]).unwrap();
    let operation = uuid();
    let receipt = world.extensions.submit(
        "main",
        &proposal(&operation, &run, &folder, "Debrief.md", TEXT),
    );
    drop(held);
    assert_eq!(receipt, refused(&operation, ProposalRefusal::Busy));
    assert!(world.pages().is_empty());
}

#[test]
fn appending_is_refused_in_this_milestone() {
    let world = world();
    let (_, run, _) = world.ready("main");
    let operation = uuid();
    let append = GuardedProposal::Append {
        operation_id: operation.clone(),
        run_id: run,
        content: TEXT.to_string(),
        content_sha256: hex(&sha256(TEXT.as_bytes())),
        document_handle: "document-1".to_string(),
        expected_sha256: "0".repeat(64),
    };
    assert_eq!(
        world.extensions.submit("main", &append),
        refused(&operation, ProposalRefusal::Unsupported)
    );
}

#[test]
fn a_stale_or_foreign_run_cannot_write() {
    let world = world();
    let (session, run, folder) = world.ready("main");
    let operation = uuid();
    let request = proposal(&operation, &run, &folder, "Debrief.md", TEXT);
    assert_eq!(
        world.extensions.submit("other", &request),
        refused(&operation, ProposalRefusal::StaleRun)
    );
    let (_, run2, _) = world.ready("main");
    let second = uuid();
    assert_eq!(
        world.extensions.end_run("main", &session, "k1"),
        EndRunReply::Ended
    );
    let after_end = proposal(&second, &run, &folder, "Debrief.md", TEXT);
    assert_eq!(
        world.extensions.submit("main", &after_end),
        refused(&second, ProposalRefusal::StaleRun)
    );
    let third = uuid();
    let wrong_folder = proposal(&third, &run2, &folder, "Debrief.md", TEXT);
    assert_eq!(
        world.extensions.submit("main", &wrong_folder),
        refused(&third, ProposalRefusal::HandleMismatch)
    );
    let begin = BeginRequest {
        session_id: session,
        package_sha256: world.sha.clone(),
        command_id: "quick".to_string(),
        invocation_id: "k1".to_string(),
    };
    assert_eq!(
        world.extensions.begin_run("main", &begin),
        RunAdmission::Refused {
            reason: RunRefusal::Cancelled
        }
    );
    assert!(world.pages().is_empty());
}

#[test]
fn after_a_restart_queries_are_unknown_but_activation_remains() {
    let world = world();
    let (_, run, folder) = world.ready("main");
    let operation = uuid();
    world.extensions.submit(
        "main",
        &proposal(&operation, &run, &folder, "Debrief.md", TEXT),
    );
    let restarted = Extensions::new(world.store.clone());
    assert_eq!(
        restarted.query("main", &operation),
        QueryReply::State(QueryState::Unknown {
            operation_id: operation.clone()
        })
    );
    let listed = restarted.list(Some(&test_roots(&world.vault)));
    let ListReply::Ok { extensions } = &listed else {
        panic!("{listed:?}");
    };
    let quick = extensions
        .iter()
        .find(|extension| extension.package_id == PACKAGE)
        .unwrap();
    assert_eq!(quick.active_sha256.as_deref(), Some(world.sha.as_str()));
    // A session from before the restart does not exist in the new process.
    assert_eq!(
        restarted.close_session("main", "session-old"),
        CloseSessionReply::Unknown
    );
}
