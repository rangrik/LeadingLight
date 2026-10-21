//! Adding to an existing page, end to end through `Extensions`, in disposable vaults: binding,
//! the baseline, the kept earlier text, the exact recheck, one write per run, joins and failed or
//! lost publications. Publications that must pause or fail use a test `CreateIo`; everything else
//! is the real filesystem. The source page beside the commentary is never written.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use tempfile::{PathPersistError, TempDir, TempPath};

use super::create::CreateIo;
use super::runs::MAX_UNDO_PER_SESSION;
use super::wire::{
    ActivationReply, CloseSessionReply, CommitKind, ConflictReason, DocumentHandleReply,
    GuardedProposal, HandleRefusal, ImportReply, OpenSessionReply, ProposalReceipt,
    ProposalRefusal, QueryReply, ReleaseUndoReply, RunAdmission, UndoKind, UndoReceipt,
    UndoRefusal, UndoRequest,
};
use super::{hex, test_roots, BeginRequest, Extensions};
use crate::leadinglight_history::{
    fail_history_syncs, list_versions, page_key, pinned_in, PageTarget, SyncFault,
};
use crate::vault::atomic_replace::PublishError;
use crate::vault::staged_file::{sha256, NativePlatform, Platform};

pub(super) const OBSERVATION: &str = "local.observation-log";
pub(super) const QUICK: &str = "local.quick-note";
pub(super) const BEFORE: &str = "# Commentary on Plan\n\n[Source](Plan.md)\n\n> First passage\n";
pub(super) const AFTER: &str =
    "# Commentary on Plan\n\n[Source](Plan.md)\n\n> First passage\n\n> Second passage\n";
pub(super) const SOURCE: &str = "# Plan\n\nFirst passage. Second passage.\n";
pub(super) const PAGE: &str = "Notes/Commentary.md";

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/leadinglight/extensions/fixtures")
        .join(name);
    fs::read_to_string(path).unwrap()
}

pub(super) fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(super) fn digest(text: &str) -> String {
    hex(&sha256(text.as_bytes()))
}

// --- Test filesystem effects -----------------------------------------------------------------------

/// How the next replacement goes; each is used once, then replacements are real again.
#[derive(Default)]
pub(super) enum Replace {
    #[default]
    Real,
    /// Refused before anything moved: the page is proven unchanged.
    Fail,
    /// Published, but the reply is lost.
    Lost,
    /// Says it started, then waits to be released before publishing for real.
    Gated(mpsc::Sender<()>, mpsc::Receiver<()>),
}

type Hook = Box<dyn FnOnce(&Path) + Send>;

#[derive(Default)]
pub(super) struct Io {
    pub(super) replace: Mutex<Replace>,
    pub(super) after_stage: Mutex<Option<Hook>>,
    pub(super) unsynced: AtomicBool,
}

struct Shared(Arc<Io>);

impl CreateIo for Shared {
    fn persist(&self, staged: TempPath, target: &Path) -> Result<(), PathPersistError> {
        staged.persist_noclobber(target)
    }

    fn sync_dir(&self, dir: &Path) -> std::io::Result<()> {
        if self.0.unsynced.load(Ordering::SeqCst) {
            return Err(std::io::Error::other("sync failed"));
        }
        NativePlatform.sync_dir(dir)
    }

    fn replace(&self, original: &Path, staged: &Path) -> Result<PathBuf, PublishError> {
        let mode = std::mem::take(&mut *self.0.replace.lock().unwrap());
        let lost = |message: &str| PublishError {
            original_at: None,
            message: message.to_string(),
        };
        match mode {
            Replace::Real => NativePlatform.publish(original, staged),
            Replace::Fail => Err(lost("refused")),
            Replace::Lost => {
                NativePlatform.publish(original, staged)?;
                Err(lost("lost reply"))
            }
            Replace::Gated(started, release) => {
                started.send(()).unwrap();
                release.recv().unwrap();
                NativePlatform.publish(original, staged)
            }
        }
    }

    fn after_stage(&self, page: &Path) {
        if let Some(hook) = self.0.after_stage.lock().unwrap().take() {
            hook(page);
        }
    }
}

impl Io {
    pub(super) fn set(&self, replace: Replace) {
        *self.replace.lock().unwrap() = replace;
    }

    /// The next replacement pauses: returns its start signal and its release.
    pub(super) fn gate(&self) -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
        let (started_tx, started) = mpsc::channel();
        let (release, release_rx) = mpsc::channel();
        self.set(Replace::Gated(started_tx, release_rx));
        (started, release)
    }

    pub(super) fn after_stage(&self, hook: impl FnOnce(&Path) + Send + 'static) {
        *self.after_stage.lock().unwrap() = Some(Box::new(hook));
    }
}

// --- The world -------------------------------------------------------------------------------------

pub(super) struct World {
    pub(super) dir: TempDir,
    pub(super) vault: PathBuf,
    pub(super) io: Arc<Io>,
    pub(super) extensions: Arc<Extensions>,
    pub(super) observation: String,
    pub(super) quick: String,
}

pub(super) fn world() -> World {
    let dir = tempfile::tempdir().unwrap();
    let vault = dir.path().join("vault");
    fs::create_dir_all(vault.join("Notes")).unwrap();
    fs::write(vault.join(PAGE), BEFORE).unwrap();
    fs::write(vault.join("Notes/Plan.md"), SOURCE).unwrap();
    let io = Arc::new(Io::default());
    let extensions =
        Extensions::with_io(dir.path().join("store"), Box::new(Shared(Arc::clone(&io))));
    let import = |text: &str, id: &str| {
        let sha = match extensions.import(text) {
            ImportReply::Candidate { package_sha256, .. } => package_sha256,
            other => panic!("{other:?}"),
        };
        let active = extensions.activate(Some(&test_roots(&vault)), id, &sha, None);
        assert!(
            matches!(active, ActivationReply::Active { .. }),
            "{active:?}"
        );
        sha
    };
    let observation = import(&fixture("append-observation.json"), OBSERVATION);
    let quick = import(&fixture("quick-note.json"), QUICK);
    World {
        dir,
        vault,
        io,
        extensions: Arc::new(extensions),
        observation,
        quick,
    }
}

/// One run that may add to a page: its session, key, run and bound handle.
pub(super) struct Ready {
    pub(super) session: String,
    pub(super) key: String,
    pub(super) run: String,
    pub(super) handle: String,
    pub(super) baseline: String,
}

impl World {
    pub(super) fn session(&self, owner: &str) -> String {
        match self
            .extensions
            .open_session(owner, Some(&test_roots(&self.vault)))
        {
            OpenSessionReply::Open { session_id } => session_id,
            other => panic!("{other:?}"),
        }
    }

    pub(super) fn run(
        &self,
        owner: &str,
        session: &str,
        key: &str,
        sha: &str,
        command: &str,
    ) -> String {
        let request = BeginRequest {
            session_id: session.to_string(),
            package_sha256: sha.to_string(),
            command_id: command.to_string(),
            invocation_id: key.to_string(),
        };
        match self.extensions.begin_run(owner, &request) {
            RunAdmission::Admitted { scope } => scope.run_id,
            other => panic!("{other:?}"),
        }
    }

    pub(super) fn bind(&self, owner: &str, run: &str, path: &str) -> DocumentHandleReply {
        self.extensions.bind_document(owner, run, path)
    }

    /// A run of the observation log in `session` with the commentary page bound.
    pub(super) fn ready_in(&self, owner: &str, session: &str) -> Ready {
        let key = uuid();
        let run = self.run(owner, session, &key, &self.observation, "add-observation");
        match self.bind(owner, &run, PAGE) {
            DocumentHandleReply::Bound {
                document_handle,
                display_path,
                content_sha256,
            } => {
                assert_eq!(display_path, PAGE);
                Ready {
                    session: session.to_string(),
                    key,
                    run,
                    handle: document_handle,
                    baseline: content_sha256,
                }
            }
            other => panic!("{other:?}"),
        }
    }

    pub(super) fn ready(&self, owner: &str) -> Ready {
        let session = self.session(owner);
        self.ready_in(owner, &session)
    }

    pub(super) fn path(&self, relative: &str) -> PathBuf {
        self.vault.join(relative)
    }

    pub(super) fn text(&self, relative: &str) -> String {
        fs::read_to_string(self.path(relative)).unwrap()
    }

    pub(super) fn receipt_path(&self, relative: &str) -> String {
        self.path(relative).to_string_lossy().into_owned()
    }

    pub(super) fn pinned(&self) -> usize {
        pinned_in(&self.vault.canonicalize().unwrap())
    }

    /// Digests of the page's listed history versions.
    pub(super) fn history(&self, relative: &str) -> Vec<String> {
        let path = self.path(relative);
        let target = PageTarget {
            key: page_key(&path).unwrap(),
            path,
        };
        match list_versions(&test_roots(&self.vault), &target, None) {
            crate::leadinglight_history::history_outcome::ListVersionsOutcome::Ok {
                versions,
                ..
            } => versions.into_iter().map(|row| row.sha256).collect(),
            other => panic!("{other:?}"),
        }
    }

    /// Names in the page's folder, so leftovers of staging would show.
    pub(super) fn names(&self, folder: &str) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(self.path(folder))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    pub(super) fn submit(&self, owner: &str, proposal: &GuardedProposal) -> ProposalReceipt {
        self.extensions.submit(owner, proposal)
    }

    /// The source page is exactly as it was written at the start.
    pub(super) fn source_untouched(&self) {
        assert_eq!(self.text("Notes/Plan.md"), SOURCE);
    }
}

pub(super) fn append(
    operation: &str,
    ready: &Ready,
    expected: &str,
    text: &str,
) -> GuardedProposal {
    GuardedProposal::Append {
        operation_id: operation.to_string(),
        run_id: ready.run.clone(),
        content: text.to_string(),
        content_sha256: digest(text),
        document_handle: ready.handle.clone(),
        expected_sha256: expected.to_string(),
    }
}

pub(super) fn refused(operation: &str, reason: ProposalRefusal) -> ProposalReceipt {
    ProposalReceipt::refused(operation, reason)
}

pub(super) fn changed(operation: &str) -> ProposalReceipt {
    ProposalReceipt::Conflict {
        operation_id: operation.to_string(),
        reason: ConflictReason::Changed,
    }
}

/// The token of a committed append, after checking every other field of its receipt.
pub(super) fn appended(
    world: &World,
    receipt: &ProposalReceipt,
    operation: &str,
    durable: bool,
) -> String {
    match receipt {
        ProposalReceipt::Committed {
            kind: CommitKind::Append,
            operation_id,
            path,
            before_sha256,
            after_sha256,
            durable: was_durable,
            undo_receipt: Some(token),
        } => {
            assert_eq!(operation_id, operation);
            assert_eq!(path, &world.receipt_path(PAGE));
            assert_eq!(before_sha256.as_deref(), Some(digest(BEFORE).as_str()));
            assert_eq!(after_sha256, &digest(AFTER));
            assert_eq!(*was_durable, durable);
            assert!(
                token.starts_with("undo-") && super::is_token(token),
                "{token}"
            );
            token.clone()
        }
        other => panic!("{other:?}"),
    }
}

pub(super) fn undo_request(operation: &str, session: &str, token: &str) -> UndoRequest {
    UndoRequest {
        operation_id: operation.to_string(),
        session_id: session.to_string(),
        undo_receipt: token.to_string(),
        kind: UndoKind::Append,
        expected_sha256: digest(AFTER),
        before_sha256: Some(digest(BEFORE)),
    }
}

/// Appends AFTER over BEFORE in a fresh session of `owner`: the run, its receipt and token.
pub(super) fn appended_world(owner: &str) -> (World, Ready, String, String) {
    let world = world();
    let ready = world.ready(owner);
    let operation = uuid();
    let receipt = world.submit(owner, &append(&operation, &ready, &ready.baseline, AFTER));
    let token = appended(&world, &receipt, &operation, true);
    (world, ready, operation, token)
}

// --- Binding ---------------------------------------------------------------------------------------

#[test]
fn binds_only_plain_visible_pages_inside_the_vault_for_the_calling_window() {
    let world = world();
    let outside = world.dir.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("Away.md"), "away").unwrap();
    fs::create_dir_all(world.path(".leadinglight")).unwrap();
    fs::write(world.path(".leadinglight/x.md"), "hidden").unwrap();
    fs::write(world.path(".Hidden.md"), "hidden").unwrap();
    fs::create_dir_all(world.path("Folder.md")).unwrap();
    fs::write(world.path("Notes/Plain.txt"), "text").unwrap();
    fs::write(world.path("Notes/Binary.md"), [0xff, 0xfe, 0x00]).unwrap();
    fs::write(world.path("Notes/Large.md"), vec![b'x'; 1024 * 1024 + 1]).unwrap();
    fs::write(world.path("Notes/Linked.md"), "linked").unwrap();
    fs::hard_link(world.path("Notes/Linked.md"), world.path("Notes/Twin.md")).unwrap();
    std::os::unix::fs::symlink(world.path(PAGE), world.path("Notes/Alias.md")).unwrap();
    std::os::unix::fs::symlink(&outside, world.path("Away")).unwrap();
    let session = world.session("main");
    let run = world.run(
        "main",
        &session,
        "k1",
        &world.observation,
        "add-observation",
    );
    let bind = |path: &str| world.bind("main", &run, path);
    let no = |reason| DocumentHandleReply::Refused { reason };
    let absolute = outside.join("Away.md");
    let absolute = absolute.to_str().unwrap();
    for (path, reason) in [
        ("../outside/Away.md", HandleRefusal::OutsideVault),
        (absolute, HandleRefusal::OutsideVault),
        (".leadinglight/x.md", HandleRefusal::OutsideVault),
        (".Hidden.md", HandleRefusal::OutsideVault),
        ("Notes/../../outside/Away.md", HandleRefusal::OutsideVault),
        ("", HandleRefusal::OutsideVault),
        ("Notes/Missing.md", HandleRefusal::Missing),
        ("Gone/Missing.md", HandleRefusal::Missing),
        ("Notes", HandleRefusal::NotDocument),
        ("Folder.md", HandleRefusal::NotDocument),
        ("Notes/Plain.txt", HandleRefusal::NotDocument),
        ("Notes/Binary.md", HandleRefusal::NotDocument),
        ("Notes/Large.md", HandleRefusal::Unsupported),
        ("Notes/Twin.md", HandleRefusal::Link),
        ("Notes/Alias.md", HandleRefusal::Link),
        ("Away/Away.md", HandleRefusal::Link),
    ] {
        assert_eq!(bind(path), no(reason), "{path:?}");
    }
    match bind(PAGE) {
        DocumentHandleReply::Bound {
            display_path,
            content_sha256,
            ..
        } => assert_eq!(
            (display_path.as_str(), content_sha256),
            (PAGE, digest(BEFORE))
        ),
        other => panic!("{other:?}"),
    }
    // Another window's run, or an ended one, binds nothing.
    assert_eq!(world.bind("other", &run, PAGE), no(HandleRefusal::StaleRun));
    world.extensions.end_run("main", &session, "k1");
    assert_eq!(bind(PAGE), no(HandleRefusal::StaleRun));
    assert_eq!(world.pinned(), 0);
}

// --- Adding ----------------------------------------------------------------------------------------

#[test]
fn appends_the_whole_postimage_once_with_its_earlier_text_kept_and_pinned() {
    let world = world();
    let ready = world.ready("main");
    let operation = uuid();
    let request = append(&operation, &ready, &ready.baseline, AFTER);
    let receipt = world.submit("main", &request);
    appended(&world, &receipt, &operation, true);
    assert_eq!(world.text(PAGE), AFTER);
    world.source_untouched();
    assert_eq!(world.names("Notes"), ["Commentary.md", "Plan.md"]);
    // The exact earlier text is a listed, pinned page-history version.
    assert!(world.history(PAGE).contains(&digest(BEFORE)));
    assert_eq!(world.pinned(), 1);
    assert_eq!(world.extensions.runs.undo_tokens(&ready.session), 1);

    // One operation id is one write; one run writes once.
    assert_eq!(world.submit("main", &request), receipt);
    assert_eq!(
        world.extensions.query("main", &operation),
        QueryReply::Receipt(receipt.clone())
    );
    let other_text = append(&operation, &ready, &ready.baseline, BEFORE);
    assert_eq!(
        world.submit("main", &other_text),
        refused(&operation, ProposalRefusal::OperationMismatch)
    );
    assert_eq!(
        world.submit("other", &request),
        refused(&operation, ProposalRefusal::OperationMismatch)
    );
    let second = uuid();
    assert_eq!(
        world.submit("main", &append(&second, &ready, &ready.baseline, AFTER)),
        refused(&second, ProposalRefusal::OperationMismatch)
    );
    assert_eq!(world.text(PAGE), AFTER);
    assert_eq!(world.pinned(), 1);
}

#[test]
fn an_empty_page_is_kept_exactly_before_it_is_added_to() {
    let world = world();
    fs::write(world.path(PAGE), "").unwrap();
    let ready = world.ready("main");
    assert_eq!(ready.baseline, digest(""));
    let operation = uuid();
    let receipt = world.submit("main", &append(&operation, &ready, &ready.baseline, AFTER));
    assert!(
        matches!(&receipt, ProposalReceipt::Committed { before_sha256: Some(before), .. } if *before == digest("")),
        "{receipt:?}"
    );
    assert!(world.history(PAGE).contains(&digest("")));
    assert_eq!(world.pinned(), 1);
}

#[test]
fn refuses_bad_digests_sizes_and_baselines_before_reading_the_page() {
    let world = world();
    let session = world.session("main");
    let attempt = |change: &dyn Fn(&mut GuardedProposal, &Ready)| {
        let ready = world.ready_in("main", &session);
        let operation = uuid();
        let mut request = append(&operation, &ready, &ready.baseline, AFTER);
        change(&mut request, &ready);
        (operation, world.submit("main", &request))
    };
    let set = |field: &'static str, value: String| {
        move |request: &mut GuardedProposal, _: &Ready| {
            if let GuardedProposal::Append {
                content,
                content_sha256,
                document_handle,
                expected_sha256,
                ..
            } = request
            {
                match field {
                    "content" => {
                        *content_sha256 = digest(&value);
                        *content = value.clone();
                    }
                    "digest" => *content_sha256 = value.clone(),
                    "handle" => *document_handle = value.clone(),
                    _ => *expected_sha256 = value.clone(),
                }
            }
        }
    };
    let large = "x".repeat(1024 * 1024 + 1);
    for (change, reason) in [
        (set("content", large), ProposalRefusal::TooLarge),
        (
            set("digest", "0".repeat(64)),
            ProposalRefusal::DigestMismatch,
        ),
        (
            set("digest", "not a digest".into()),
            ProposalRefusal::DigestMismatch,
        ),
        (
            set("content", BEFORE.into()),
            ProposalRefusal::DigestMismatch,
        ),
        (
            set("handle", "document-missing".into()),
            ProposalRefusal::HandleMismatch,
        ),
        (
            set("expected", digest("another baseline")),
            ProposalRefusal::HandleMismatch,
        ),
    ] {
        let (operation, receipt) = attempt(&change);
        assert_eq!(receipt, refused(&operation, reason));
    }
    assert_eq!(world.text(PAGE), BEFORE);
    assert_eq!(world.pinned(), 0);
    assert_eq!(world.extensions.runs.undo_slots(&session), Some(0));
}

/// A page changed after its review, before the write reads it, is never replaced.
#[test]
fn a_stale_baseline_or_an_external_change_writes_nothing() {
    type Change = fn(&World);
    let cases: [(&str, Change, Option<ProposalRefusal>); 5] = [
        (
            "edited after review",
            |world| {
                fs::write(
                    world.path(PAGE),
                    "# Commentary on Plan\n\nTyped elsewhere.\n",
                )
                .unwrap()
            },
            None,
        ),
        (
            "removed",
            |world| fs::remove_file(world.path(PAGE)).unwrap(),
            None,
        ),
        (
            "page linked",
            |world| {
                let kept = world.path("Notes/Kept.md");
                fs::rename(world.path(PAGE), &kept).unwrap();
                std::os::unix::fs::symlink(&kept, world.path(PAGE)).unwrap();
            },
            Some(ProposalRefusal::Link),
        ),
        (
            "folder linked",
            |world| {
                fs::rename(world.path("Notes"), world.path("Kept")).unwrap();
                std::os::unix::fs::symlink(world.path("Kept"), world.path("Notes")).unwrap();
            },
            Some(ProposalRefusal::HandleMismatch),
        ),
        (
            "folder replaced by another holding the same bytes",
            |world| {
                fs::rename(world.path("Notes"), world.path("Kept")).unwrap();
                fs::create_dir(world.path("Notes")).unwrap();
                fs::write(world.path(PAGE), BEFORE).unwrap();
            },
            Some(ProposalRefusal::HandleMismatch),
        ),
    ];
    for (case, change, reason) in cases {
        let world = world();
        let ready = world.ready("main");
        let before = fs::read(world.path("Notes/Plan.md")).ok();
        change(&world);
        let operation = uuid();
        let receipt = world.submit("main", &append(&operation, &ready, &ready.baseline, AFTER));
        let expected =
            reason.map_or_else(|| changed(&operation), |reason| refused(&operation, reason));
        assert_eq!(receipt, expected, "{case}");
        assert_eq!(world.pinned(), 0, "{case}");
        assert_eq!(
            world.extensions.runs.undo_slots(&ready.session),
            Some(0),
            "{case}"
        );
        for page in [
            world.path(PAGE),
            world.path("Kept/Commentary.md"),
            world.path("Notes/Kept.md"),
        ] {
            assert_ne!(
                fs::read_to_string(page).ok().as_deref(),
                Some(AFTER),
                "{case}"
            );
        }
        let source = fs::read(world.path("Kept/Plan.md"))
            .or_else(|_| fs::read(world.path("Notes/Plan.md")))
            .ok();
        assert_eq!(source, before, "{case}");
    }
}

#[test]
fn an_edit_after_staging_is_caught_by_the_exact_recheck() {
    let world = world();
    let session = world.session("main");
    let edits: [(&str, Hook); 2] = [
        (
            "same file, new words",
            Box::new(|page: &Path| fs::write(page, "# Commentary on Plan\n\nMine.\n").unwrap()),
        ),
        (
            "identical bytes, another file",
            Box::new(|page: &Path| {
                let copy = page.with_extension("copy");
                fs::write(&copy, BEFORE).unwrap();
                fs::rename(&copy, page).unwrap();
            }),
        ),
    ];
    for (case, edit) in edits {
        let ready = world.ready_in("main", &session);
        let before = world.text(PAGE);
        world.io.after_stage(edit);
        let operation = uuid();
        let receipt = world.submit("main", &append(&operation, &ready, &ready.baseline, AFTER));
        assert_eq!(receipt, changed(&operation), "{case}");
        assert_ne!(world.text(PAGE), AFTER, "{case}");
        assert_eq!(world.names("Notes"), ["Commentary.md", "Plan.md"], "{case}");
        assert_eq!(world.pinned(), 0, "{case}");
        // The earlier text kept for the attempt is an ordinary version now; nothing was lost.
        assert!(world.history(PAGE).contains(&digest(&before)), "{case}");
        fs::write(world.path(PAGE), BEFORE).unwrap();
    }
}

/// Without a verified kept copy of the earlier text, nothing is replaced.
#[test]
fn no_page_is_replaced_without_its_earlier_text_kept_on_disk() {
    for layout in ["store is a file", "history is linked away"] {
        let world = world();
        let store = world.path(".leadinglight");
        match layout {
            "store is a file" => fs::write(&store, "").unwrap(),
            _ => {
                let away = world.dir.path().join("away");
                fs::create_dir_all(&away).unwrap();
                fs::create_dir_all(&store).unwrap();
                std::os::unix::fs::symlink(&away, store.join("history")).unwrap();
            }
        }
        let ready = world.ready("main");
        let operation = uuid();
        let receipt = world.submit("main", &append(&operation, &ready, &ready.baseline, AFTER));
        assert_eq!(
            receipt,
            refused(&operation, ProposalRefusal::StorageUnavailable),
            "{layout}"
        );
        assert_eq!(world.text(PAGE), BEFORE, "{layout}");
        assert_eq!(world.extensions.runs.undo_slots(&ready.session), Some(0));
    }
}

/// Astra final review: a kept version whose durability was never confirmed is never trusted.
/// It became visible before its location's sync failed, or its location's parent sync failed
/// when the location was created. While that sync keeps failing, every append is refused before
/// the page changes; once it recovers, the same kept version is proven, pinned, and the append
/// writes.
#[test]
fn an_append_waits_for_a_failed_history_sync_to_succeed_before_writing() {
    for fault in [SyncFault::Location, SyncFault::Parent] {
        let world = world();
        let session = world.session("main");
        let (before, after) = match fault {
            // A first append leaves this page's history location and its record in place.
            SyncFault::Location => {
                let first = world.ready_in("main", &session);
                let operation = uuid();
                let receipt =
                    world.submit("main", &append(&operation, &first, &first.baseline, AFTER));
                appended(&world, &receipt, &operation, true);
                world.extensions.end_run("main", &session, &first.key);
                (AFTER.to_string(), format!("{AFTER}\n> Third passage\n"))
            }
            SyncFault::Parent => (BEFORE.to_string(), AFTER.to_string()),
        };
        let pinned = world.pinned();
        let kept = |world: &World| {
            world
                .history(PAGE)
                .into_iter()
                .filter(|sha| *sha == digest(&before))
                .count()
        };

        fail_history_syncs(Some(fault));
        let mut refusals = Vec::new();
        for _ in 0..2 {
            let ready = world.ready_in("main", &session);
            let operation = uuid();
            let receipt =
                world.submit("main", &append(&operation, &ready, &ready.baseline, &after));
            refusals.push((operation, receipt));
            world.extensions.end_run("main", &session, &ready.key);
        }
        fail_history_syncs(None);
        for (operation, receipt) in &refusals {
            assert_eq!(
                receipt,
                &refused(operation, ProposalRefusal::StorageUnavailable),
                "{fault:?}"
            );
        }
        assert_eq!(world.text(PAGE), before, "{fault:?}");
        // One attempt left its version visible but unproven; the other found it and refused too.
        assert_eq!(kept(&world), 1, "{fault:?}");
        assert_eq!(world.pinned(), pinned, "{fault:?}");

        let ready = world.ready_in("main", &session);
        let operation = uuid();
        let receipt = world.submit("main", &append(&operation, &ready, &ready.baseline, &after));
        assert!(
            matches!(&receipt, ProposalReceipt::Committed { before_sha256: Some(earlier), .. } if *earlier == digest(&before)),
            "{fault:?}: {receipt:?}"
        );
        assert_eq!(world.text(PAGE), after, "{fault:?}");
        assert_eq!(kept(&world), 1, "{fault:?}");
        assert_eq!(world.pinned(), pinned + 1, "{fault:?}");
        world.source_untouched();
    }
}

#[test]
fn a_page_held_by_another_writer_is_busy() {
    let world = world();
    let ready = world.ready("main");
    let held = crate::leadinglight_history::lease(&[world.path(PAGE)]).unwrap();
    let operation = uuid();
    let receipt = world.submit("main", &append(&operation, &ready, &ready.baseline, AFTER));
    drop(held);
    assert_eq!(receipt, refused(&operation, ProposalRefusal::Busy));
    assert_eq!(world.text(PAGE), BEFORE);
    assert_eq!(world.pinned(), 0);
}

/// A session's undo table is bounded; when it is full an append is refused before it writes,
/// and releasing a token makes room. Nothing offered is ever evicted.
#[test]
fn a_full_undo_table_refuses_an_append_before_it_writes() {
    let world = world();
    let session = world.session("main");
    let mut tokens = Vec::new();
    let mut text = BEFORE.to_string();
    for number in 0..MAX_UNDO_PER_SESSION {
        let ready = world.ready_in("main", &session);
        let next = format!("{text}\n> Passage {number}\n");
        let operation = uuid();
        match world.submit("main", &append(&operation, &ready, &ready.baseline, &next)) {
            ProposalReceipt::Committed {
                undo_receipt: Some(token),
                ..
            } => tokens.push(token),
            other => panic!("{other:?}"),
        }
        // Ending the run keeps its Undo; it also keeps the session's live runs within bounds.
        world.extensions.end_run("main", &session, &ready.key);
        text = next;
    }
    let ready = world.ready_in("main", &session);
    let operation = uuid();
    let full = append(
        &operation,
        &ready,
        &ready.baseline,
        &format!("{text}\n> One more\n"),
    );
    assert_eq!(
        world.submit("main", &full),
        refused(&operation, ProposalRefusal::Busy)
    );
    assert_eq!(world.text(PAGE), text);
    assert_eq!(world.pinned(), MAX_UNDO_PER_SESSION);
    assert_eq!(
        world.extensions.release_undo("main", &session, &tokens[0]),
        ReleaseUndoReply::Released
    );
    let ready = world.ready_in("main", &session);
    let operation = uuid();
    let fits = append(
        &operation,
        &ready,
        &ready.baseline,
        &format!("{text}\n> One more\n"),
    );
    assert!(matches!(
        world.submit("main", &fits),
        ProposalReceipt::Committed { .. }
    ));
    assert_eq!(world.pinned(), MAX_UNDO_PER_SESSION);
}

// --- Joins and lost replies ------------------------------------------------------------------------

/// Close waits for the admitted append; the write keeps its true result, but its session is gone,
/// so its Undo is too. The kept earlier text stays as an ordinary page-history version.
#[test]
fn closing_joins_an_admitted_append_and_takes_its_undo_with_it() {
    let world = world();
    let ready = world.ready("main");
    let (started, release) = world.io.gate();
    let operation = uuid();
    let write = {
        let extensions = Arc::clone(&world.extensions);
        let request = append(&operation, &ready, &ready.baseline, AFTER);
        thread::spawn(move || extensions.submit("main", &request))
    };
    started.recv().unwrap();
    let (closed_tx, closed) = mpsc::channel();
    let closer = {
        let extensions = Arc::clone(&world.extensions);
        let session = ready.session.clone();
        thread::spawn(move || {
            closed_tx
                .send(extensions.close_session("main", &session))
                .unwrap()
        })
    };
    assert!(closed.recv_timeout(Duration::from_millis(200)).is_err());
    assert_eq!(
        world.extensions.close_session("other", &ready.session),
        CloseSessionReply::Unknown
    );
    release.send(()).unwrap();
    assert_eq!(closed.recv().unwrap(), CloseSessionReply::Closed);
    closer.join().unwrap();
    let receipt = write.join().unwrap();
    let token = appended(&world, &receipt, &operation, true);
    assert_eq!(world.text(PAGE), AFTER);
    assert_eq!(world.pinned(), 0);
    assert!(world.history(PAGE).contains(&digest(BEFORE)));
    let undo = world
        .extensions
        .undo("main", &undo_request(&uuid(), &ready.session, &token));
    assert!(
        matches!(
            undo,
            UndoReceipt::Refused {
                reason: UndoRefusal::SessionClosed,
                ..
            }
        ),
        "{undo:?}"
    );
}

/// A window that reloads never waits for the write; the write finishes and drops its pin.
#[test]
fn forgetting_a_window_never_waits_and_leaves_no_undo_behind() {
    let world = world();
    let ready = world.ready("main");
    let (started, release) = world.io.gate();
    let operation = uuid();
    let write = {
        let extensions = Arc::clone(&world.extensions);
        let request = append(&operation, &ready, &ready.baseline, AFTER);
        thread::spawn(move || extensions.submit("main", &request))
    };
    started.recv().unwrap();
    world.extensions.forget_owner("main");
    release.send(()).unwrap();
    appended(&world, &write.join().unwrap(), &operation, true);
    assert_eq!(world.pinned(), 0);
    assert_eq!(world.extensions.runs.undo_tokens(&ready.session), 0);
}

#[test]
fn a_failed_publication_proves_nothing_was_written() {
    let world = world();
    let ready = world.ready("main");
    world.io.set(Replace::Fail);
    let operation = uuid();
    let receipt = world.submit("main", &append(&operation, &ready, &ready.baseline, AFTER));
    assert_eq!(
        receipt,
        refused(&operation, ProposalRefusal::StorageUnavailable)
    );
    assert_eq!(world.text(PAGE), BEFORE);
    assert_eq!(world.pinned(), 0);
    assert_eq!(world.extensions.runs.undo_slots(&ready.session), Some(0));
}

/// A lost reply is uncertain, answered again by query and resubmission, never retried, and never
/// a usable-looking Undo; the earlier text stays recoverable in page history.
#[test]
fn a_lost_publication_is_uncertain_and_offers_no_undo() {
    let world = world();
    let ready = world.ready("main");
    world.io.set(Replace::Lost);
    let operation = uuid();
    let request = append(&operation, &ready, &ready.baseline, AFTER);
    let receipt = world.submit("main", &request);
    assert_eq!(receipt, ProposalReceipt::uncertain(&operation));
    assert_eq!(
        world.extensions.query("main", &operation),
        QueryReply::Receipt(receipt.clone())
    );
    assert_eq!(world.submit("main", &request), receipt);
    assert_eq!(world.extensions.runs.undo_tokens(&ready.session), 0);
    assert_eq!(world.extensions.runs.undo_slots(&ready.session), Some(0));
    assert_eq!(world.pinned(), 0);
    assert!(world.history(PAGE).contains(&digest(BEFORE)));
}

#[test]
fn an_unsynced_append_is_committed_but_not_durable() {
    let world = world();
    let ready = world.ready("main");
    world.io.unsynced.store(true, Ordering::SeqCst);
    let operation = uuid();
    let receipt = world.submit("main", &append(&operation, &ready, &ready.baseline, AFTER));
    world.io.unsynced.store(false, Ordering::SeqCst);
    appended(&world, &receipt, &operation, false);
    assert_eq!(world.text(PAGE), AFTER);
}

// --- The bundled commentary ------------------------------------------------------------------------

/// On a host whose desktop services are qualified, the bundled commentary is on by default and
/// runs; turning it off revokes its run and stops new ones.
#[test]
fn the_bundled_commentary_runs_by_default_on_a_qualified_host_until_turned_off() {
    use super::create::NativeCreateIo;
    use super::manifest::Capability;
    use super::wire::{DeactivationReply, ListReply, RunRefusal};

    const COMMENTARY: &str = "leadinglight.passage-commentary";
    let dir = tempfile::tempdir().unwrap();
    let vault = dir.path().join("vault");
    fs::create_dir_all(&vault).unwrap();
    let roots = test_roots(&vault);
    let extensions = Extensions::with_host(
        dir.path().join("store"),
        Box::new(NativeCreateIo),
        Capability::ALL.to_vec(),
    );
    let ListReply::Ok { extensions: listed } = extensions.list(Some(&roots)) else {
        panic!("the vault lists");
    };
    let sha = listed
        .iter()
        .find(|extension| extension.package_id == COMMENTARY)
        .and_then(|extension| extension.active_sha256.clone())
        .expect("commentary is on by default");
    let OpenSessionReply::Open { session_id } = extensions.open_session("main", Some(&roots))
    else {
        panic!("the session opens");
    };
    let begin = BeginRequest {
        session_id,
        package_sha256: sha.clone(),
        command_id: "comment".to_string(),
        invocation_id: "k1".to_string(),
    };
    assert!(matches!(
        extensions.begin_run("main", &begin),
        RunAdmission::Admitted { .. }
    ));
    assert_eq!(
        extensions.deactivate(Some(&roots), COMMENTARY, &sha),
        DeactivationReply::Inactive { revoked_runs: 1 }
    );
    let again = BeginRequest {
        invocation_id: "k2".to_string(),
        ..begin
    };
    assert_eq!(
        extensions.begin_run("main", &again),
        RunAdmission::Refused {
            reason: RunRefusal::NotActive
        }
    );
}
