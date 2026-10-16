//! S0 regressions. Each test names the seam it guards and the failure it catches.

use std::cell::RefCell;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Barrier, Mutex};
use std::thread;

use serde_json::{json, Value};
use tempfile::TempDir;

use super::copy::copy_with;
use super::history_outcome::{HistoryNote, NotKeptReason};
use super::outcome::*;
use super::page_write::{check_with, save_with, Holds, Steps};
use super::registry::{BUSY_MESSAGE, HELD_MESSAGE};
use super::resolve::AFTER_PROOF;
use super::*;
use crate::commands::{
    move_to_local_trash, rename_note_blocking, rename_vault_folder, set_note_favorite_blocking,
    sync_note_title_blocking, update_frontmatter_blocking,
};
use crate::frontmatter::FrontmatterValue;
use crate::vault::atomic_replace::PublishError;
use crate::vault::staged_file::{sha256, NativePlatform, Platform};
use crate::vault::{
    rename_attachment, rename_note_filename, AttachmentRenameRequest, RenameNoteFilenameRequest,
};

struct Vault {
    dir: TempDir,
    roots: VaultRoots,
}

fn vault() -> Vault {
    let dir = TempDir::new().unwrap();
    let roots = VaultRoots {
        requested: dir.path().to_path_buf(),
        canonical: dir.path().canonicalize().unwrap(),
    };
    Vault { dir, roots }
}

impl Vault {
    fn path(&self, name: &str) -> PathBuf {
        self.dir.path().join(name)
    }

    fn page(&self, name: &str, body: &str) -> PathBuf {
        let path = self.path(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, body).unwrap();
        path
    }

    fn request(&self, path: &Path, seq: u64, content: &str) -> OriginalRequest {
        OriginalRequest {
            request_id: uuid(),
            vault_path: self.dir.path().to_string_lossy().into_owned(),
            session: "window".to_string(),
            path: path.to_string_lossy().into_owned(),
            seq,
            submitted_sha256: hex(&sha256(content.as_bytes())),
        }
    }
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn wire(value: impl serde::Serialize) -> Value {
    serde_json::to_value(value).unwrap()
}

fn target(path: &Path) -> PageTarget {
    PageTarget {
        path: path.to_path_buf(),
        key: page_key(path).unwrap(),
    }
}

fn save(request: &OriginalRequest, content: &str) -> SaveOutcome {
    save_page(request, content, Some(&target(Path::new(&request.path))))
}

/// Check as the command runs it, with the request's own vault.
fn check_save(request: &OriginalRequest) -> SaveRequestState {
    let requested = PathBuf::from(&request.vault_path);
    let canonical = requested.canonicalize().unwrap();
    super::check_save(
        request,
        Some(&VaultRoots {
            requested,
            canonical,
        }),
    )
}

fn confirmed(seq: u64, content: &str) -> ConfirmedSnapshot {
    ConfirmedSnapshot {
        seq,
        content_sha256: hex(&sha256(content.as_bytes())),
    }
}

fn refused(reason: ResolutionRefusal) -> ResolutionOutcome {
    ResolutionOutcome::Refused { reason }
}

type Publish = dyn Fn(&Path, &Path) -> Result<PathBuf, PublishError> + Sync;

/// Runs a step after staging and decides how publish ends.
struct Scripted<'a> {
    after_stage: &'a (dyn Fn(&Path) + Sync),
    publish: &'a Publish,
    synced: bool,
}

impl Platform for Scripted<'_> {
    fn publish(&self, original: &Path, staged: &Path) -> Result<PathBuf, PublishError> {
        (self.publish)(original, staged)
    }

    fn sync_dir(&self, _dir: &Path) -> std::io::Result<()> {
        self.synced
            .then_some(())
            .ok_or(std::io::ErrorKind::Other.into())
    }
}

impl Steps for Scripted<'_> {
    fn after_stage(&self, path: &Path) {
        (self.after_stage)(path)
    }
}

fn scripted<'a>(after_stage: &'a (dyn Fn(&Path) + Sync), publish: &'a Publish) -> Scripted<'a> {
    Scripted {
        after_stage,
        publish,
        synced: true,
    }
}

fn nothing(_: &Path) {}

fn native(original: &Path, staged: &Path) -> Result<PathBuf, PublishError> {
    NativePlatform.publish(original, staged)
}

/// Claims the original moved elsewhere, so nothing on disk is proven.
fn lost(original: &Path, _: &Path) -> Result<PathBuf, PublishError> {
    Err(PublishError {
        original_at: Some(original.with_extension("moved")),
        message: "lost".to_string(),
    })
}

fn run(platform: &impl Steps, request: &OriginalRequest, content: &str) -> SaveOutcome {
    let target = target(Path::new(&request.path));
    save_with(
        &REGISTRY,
        platform,
        request,
        content.as_bytes(),
        Some(&target),
        Holds::Keep,
    )
}

/// Seam: the frozen JSON that Queue parses. Catches a renamed tag or field.
#[test]
fn wire_shapes_match_the_frozen_api() {
    let request = OriginalRequest {
        request_id: "r".into(),
        vault_path: "/v".into(),
        session: "s".into(),
        path: "/v/a.md".into(),
        seq: 3,
        submitted_sha256: "h".into(),
    };
    let hold = HoldInfo {
        request_id: "r".into(),
        kind: HoldKind::Uncertain,
        seq: 3,
        submitted_sha256: "h".into(),
    };
    let envelope = json!({"requestId": "r", "vaultPath": "/v", "session": "s", "path": "/v/a.md",
        "seq": 3, "submittedSha256": "h"});
    let cases = [
        (
            wire(SaveOutcome::refused(Refusal::Held {
                held_by: "r".into(),
                held_request: request,
                held_kind: HoldKind::Missing,
            })),
            json!({"status": "refused", "reason": "held", "heldBy": "r", "heldRequest": envelope,
                "heldKind": "missing"}),
        ),
        (
            wire(SaveOutcome::Uncertain {
                hold,
                original_at: None,
                staged_at: Some("/x".into()),
            }),
            json!({"status": "uncertain", "hold": {"requestId": "r", "kind": "uncertain", "seq": 3,
                "submittedSha256": "h"}, "originalAt": null, "stagedAt": "/x"}),
        ),
        (
            wire(SaveRequestState::Retired {
                terminal: Terminal::Conflict,
                resolved: true,
            }),
            json!({"state": "retired", "terminal": "conflict", "resolved": true}),
        ),
        (
            wire(CopyOutcome::FolderUnavailable {
                recorded_folder: "/f".into(),
            }),
            json!({"status": "folderUnavailable", "recordedFolder": "/f"}),
        ),
        (
            wire(ResolutionOutcome::Resolved {
                action_id: "a".into(),
                hold_retired: true,
                leftovers: vec![],
            }),
            json!({"status": "resolved", "actionId": "a", "holdRetired": true, "leftovers": []}),
        ),
    ];
    for (actual, expected) in cases {
        assert_eq!(actual, expected);
    }
    let mut extra = envelope;
    extra["extra"] = json!(1);
    assert!(serde_json::from_value::<OriginalRequest>(extra).is_err());
}

/// Seam: registration before publication. Catches a replayed envelope writing twice and a
/// reused ID with a different envelope being accepted.
#[test]
fn a_save_runs_once_and_its_id_binds_one_envelope() {
    let vault = vault();
    let page = vault.page("a.md", "old");
    let request = vault.request(&page, 1, "new");
    let committed = save(&request, "new");
    assert_eq!(
        committed,
        SaveOutcome::Committed {
            written: true,
            durable: true,
            history: None
        }
    );
    fs::write(&page, "edited elsewhere").unwrap();
    assert_eq!(save(&request, "new"), committed);
    assert_eq!(fs::read_to_string(&page).unwrap(), "edited elsewhere");

    let mut reused = request.clone();
    reused.seq = 2;
    assert_eq!(
        save(&reused, "new"),
        SaveOutcome::refused(Refusal::RequestMismatch)
    );
    assert_eq!(check_save(&reused), SaveRequestState::Mismatch);
    let wrong_text = vault.request(&page, 3, "new");
    assert_eq!(
        save(&wrong_text, "other"),
        SaveOutcome::refused(Refusal::RequestMismatch)
    );
}

/// Seam: recovery binds an unseen request first. Catches a late original publishing after its
/// text was already copied or checked.
#[test]
fn recovery_voids_an_unseen_request_so_a_late_save_cannot_publish() {
    let vault = vault();
    let page = vault.page("a.md", "old");
    let checked = vault.request(&page, 1, "late");
    assert_eq!(check_save(&checked), SaveRequestState::Voided);
    assert_eq!(
        save(&checked, "late"),
        SaveOutcome::refused(Refusal::RequestVoided)
    );

    let copied = vault.request(&page, 2, "late");
    let draft = DraftSnapshot {
        seq: 2,
        content: "late".into(),
    };
    let created = wire(copy_draft(&copied, &draft, &uuid(), None, &vault.roots));
    assert_eq!(created["relativePath"], "a-2.md");
    assert_eq!(
        save(&copied, "late"),
        SaveOutcome::refused(Refusal::RequestVoided)
    );
    assert_eq!(fs::read_to_string(&page).unwrap(), "old");
}

/// Seam: the page is inspected without following it. Catches writes through links, recreated
/// missing pages, and a held refusal without the envelope another window needs.
#[test]
fn unsafe_pages_are_held_or_refused_without_touching_disk() {
    let vault = vault();
    let outside = TempDir::new().unwrap();
    let elsewhere = outside.path().join("t.md");
    fs::write(&elsewhere, "outside").unwrap();
    symlink(&elsewhere, vault.path("link.md")).unwrap();
    let hard = vault.page("hard.md", "hard");
    fs::hard_link(&hard, vault.path("hard-copy.md")).unwrap();
    let locked = vault.page("locked.md", "locked");
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o444)).unwrap();
    fs::create_dir(vault.path("folder.md")).unwrap();

    let cases = [
        ("gone.md", "missing", true),
        ("no-folder/gone.md", "parentMissing", true),
        ("link.md", "symlink", true),
        ("hard.md", "linked", true),
        ("locked.md", "readOnly", false),
        ("folder.md", "readFailed", false),
    ];
    for (name, reason, held) in cases {
        let path = vault.path(name);
        let first = vault.request(&path, 1, "new");
        let outcome = wire(save(&first, "new"));
        assert_eq!(outcome["reason"], reason, "{name}");
        assert_eq!(outcome.get("hold").is_some(), held, "{name}");
        let second = wire(save(&vault.request(&path, 2, "newer"), "newer"));
        assert_eq!(
            second["reason"],
            if held { "held" } else { reason },
            "{name}"
        );
        if held {
            assert_eq!(second["heldRequest"], wire(&first), "{name}");
        }
    }
    assert_eq!(fs::read_to_string(&elsewhere).unwrap(), "outside");
    assert_eq!(fs::read_to_string(&hard).unwrap(), "hard");
    assert!(!vault.path("gone.md").exists());
    assert!(!vault.path("no-folder").exists());
}

/// Seam: the exact recheck between staging and publish. Catches an outside edit that keeps size
/// and time being overwritten, and an unreadable page being reported as an edit.
#[test]
fn outside_edits_conflict_and_unreadable_pages_refuse() {
    let vault = vault();
    let page = vault.page("a.md", "Keep this");
    let same_size_and_time = |path: &Path| {
        let modified = fs::metadata(path).unwrap().modified().unwrap();
        fs::write(path, "Lose this").unwrap();
        let file = fs::File::options().write(true).open(path).unwrap();
        file.set_modified(modified).unwrap();
    };
    let outcome = run(
        &scripted(&same_size_and_time, &native),
        &vault.request(&page, 1, "mine"),
        "mine",
    );
    assert!(
        matches!(outcome, SaveOutcome::Conflict { .. }),
        "{outcome:?}"
    );
    assert_eq!(fs::read_to_string(&page).unwrap(), "Lose this");

    let other = vault.page("b.md", "Keep this");
    let unreadable =
        |path: &Path| fs::set_permissions(path, fs::Permissions::from_mode(0o000)).unwrap();
    let outcome = run(
        &scripted(&unreadable, &native),
        &vault.request(&other, 1, "mine"),
        "mine",
    );
    fs::set_permissions(&other, fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(outcome, SaveOutcome::refused(Refusal::ReadFailed));
    assert_eq!(fs::read_to_string(&other).unwrap(), "Keep this");
}

/// Seam: admission and leases share one lock. Catches a mutation or second save slipping in
/// while a save sits between its checks and its publish, and a panic leaving a page stuck.
#[test]
fn a_running_save_blocks_others_and_a_panic_still_finishes() {
    let vault = vault();
    let page = vault.page("a.md", "old");
    let request = vault.request(&page, 1, "new");
    let (reached, resume) = (Barrier::new(2), Barrier::new(2));
    let pause = |_: &Path| {
        reached.wait();
        resume.wait();
    };
    let platform = scripted(&pause, &native);
    let second = vault.request(&page, 2, "newer");
    // Asserted only after the paused save is released, so a failure reports instead of hanging.
    let (during, finished) = thread::scope(|scope| {
        let running = scope.spawn(|| run(&platform, &request, "new"));
        reached.wait();
        let during = (
            check_save(&request),
            save(&second, "newer"),
            lease(&[&page]).err(),
            discard(&request, &uuid(), &confirmed(1, "new")),
        );
        resume.wait();
        (during, running.join().unwrap())
    });
    let busy = SaveOutcome::refused(Refusal::Busy);
    let lease_busy = Some(BUSY_MESSAGE.to_string());
    assert_eq!(
        during,
        (
            SaveRequestState::Running,
            busy,
            lease_busy,
            ResolutionOutcome::Running
        )
    );
    assert!(
        matches!(finished, SaveOutcome::Committed { .. }),
        "{finished:?}"
    );

    let panicking = |_: &Path| panic!("injected");
    let later = vault.request(&page, 3, "later");
    let outcome = run(&scripted(&panicking, &native), &later, "later");
    assert!(
        matches!(outcome, SaveOutcome::Uncertain { .. }),
        "{outcome:?}"
    );
    assert!(matches!(
        check_save(&later),
        SaveRequestState::Done {
            outcome: SaveOutcome::Uncertain { .. }
        }
    ));
}

/// Seam: what publish reports versus what is on disk. Catches a failed publish claimed as saved,
/// Check re-proving an uncertain save wrongly, and a non-durable commit being written again.
#[test]
fn publish_results_are_truthful_and_check_reproves_uncertain_saves() {
    let vault = vault();
    let page = vault.page("a.md", "old");
    let refuse = |_: &Path, _: &Path| -> Result<PathBuf, PublishError> {
        Err(PublishError {
            original_at: None,
            message: "no".to_string(),
        })
    };
    let failed = SaveOutcome::Failed {
        reason: FailedReason::Publish,
    };
    let outcome = run(
        &scripted(&nothing, &refuse),
        &vault.request(&page, 1, "new"),
        "new",
    );
    assert_eq!(outcome, failed);

    let unchanged = vault.request(&page, 2, "new");
    let outcome = run(&scripted(&nothing, &lost), &unchanged, "new");
    let SaveOutcome::Uncertain {
        staged_at: Some(staged),
        ..
    } = outcome
    else {
        panic!("{outcome:?}");
    };
    assert!(Path::new(&staged).exists());
    assert_eq!(
        check_save(&unchanged),
        SaveRequestState::Done { outcome: failed }
    );
    assert!(!Path::new(&staged).exists());

    let landed = vault.request(&page, 3, "new");
    run(&scripted(&nothing, &lost), &landed, "new");
    fs::write(&page, "new").unwrap();
    let proven = SaveOutcome::Committed {
        written: true,
        durable: false,
        history: None,
    };
    assert_eq!(
        check_save(&landed),
        SaveRequestState::Done {
            outcome: proven.clone()
        }
    );

    let unproven = vault.request(&page, 4, "newest");
    run(&scripted(&nothing, &lost), &unproven, "newest");
    fs::write(&page, "someone else").unwrap();
    assert!(matches!(
        check_save(&unproven),
        SaveRequestState::Done {
            outcome: SaveOutcome::Uncertain { .. }
        }
    ));

    let other = vault.page("b.md", "old");
    let quiet = vault.request(&other, 1, "new");
    let unsynced = Scripted {
        synced: false,
        ..scripted(&nothing, &native)
    };
    // The failed history sync is reported once; a replay or Check repeats only the save.
    let noted = SaveOutcome::Committed {
        written: true,
        durable: false,
        history: Some(HistoryNote::NotKept {
            reason: NotKeptReason::Unavailable,
        }),
    };
    assert_eq!(run(&unsynced, &quiet, "new"), noted);
    fs::write(&other, "later edit").unwrap();
    assert_eq!(save(&quiet, "new"), proven);
    assert_eq!(
        check_save(&quiet),
        SaveRequestState::Done { outcome: proven }
    );
    assert_eq!(fs::read_to_string(&other).unwrap(), "later edit");
}

/// Seam: only live holds and the latest save per page keep full records. Catches unbounded
/// records and a compacted record inventing an outcome.
#[test]
fn older_saves_compact_to_their_terminal_class() {
    static LOCAL: Registry = Registry::new();
    let vault = vault();
    let page = vault.page("a.md", "0");
    let requests: Vec<_> = (1..=3)
        .map(|seq| {
            let content = seq.to_string();
            let request = vault.request(&page, seq, &content);
            let target = target(&page);
            save_with(
                &LOCAL,
                &NativePlatform,
                &request,
                content.as_bytes(),
                Some(&target),
                Holds::Keep,
            );
            request
        })
        .collect();
    assert_eq!(LOCAL.full_records(), 1);
    assert_eq!(
        check_with(&LOCAL, &requests[0], None),
        SaveRequestState::Retired {
            terminal: Terminal::Committed,
            resolved: false
        }
    );
    let replay = save_with(
        &LOCAL,
        &NativePlatform,
        &requests[0],
        b"1",
        Some(&target(&page)),
        Holds::Keep,
    );
    assert_eq!(replay, SaveOutcome::refused(Refusal::RequestVoided));
}

/// Seam: a final disposition is bound to one exact action. Catches a discard that must read an
/// unsafe page, a reused action ID changing meaning, and a hold outliving its resolution.
#[test]
fn discard_settles_a_hold_without_reading_the_page() {
    let vault = vault();
    let outside = TempDir::new().unwrap();
    let elsewhere = outside.path().join("t.md");
    fs::write(&elsewhere, "outside").unwrap();
    let link = vault.path("link.md");
    symlink(&elsewhere, &link).unwrap();
    let request = vault.request(&link, 1, "mine");
    save(&request, "mine");

    let action = uuid();
    let newer = confirmed(4, "newer text");
    let resolved = discard(&request, &action, &newer);
    assert_eq!(
        resolved,
        ResolutionOutcome::Resolved {
            action_id: action.clone(),
            hold_retired: true,
            leftovers: vec![]
        }
    );
    assert_eq!(discard(&request, &action, &newer), resolved);
    let changed = ConfirmedSnapshot { seq: 5, ..newer };
    assert_eq!(
        discard(&request, &action, &changed),
        refused(ResolutionRefusal::ActionMismatch)
    );
    assert_eq!(
        check_save(&request),
        SaveRequestState::Retired {
            terminal: Terminal::Refused,
            resolved: true
        }
    );
    let next = wire(save(&vault.request(&link, 6, "x"), "x"));
    assert_eq!(next["reason"], "symlink");
    assert_eq!(fs::read_to_string(&elsewhere).unwrap(), "outside");
}

/// Seam: copy ownership across lost replies. Catches adopting a same-text file someone else made,
/// a retry making a second copy, and copies landing outside the vault.
#[test]
fn copies_use_fresh_names_and_a_retry_returns_the_same_copy() {
    let vault = vault();
    let page = vault.page("notes/plan.md", "old");
    vault.page("notes/plan-2.md", "draft");
    let request = vault.request(&page, 1, "x");
    let draft = DraftSnapshot {
        seq: 7,
        content: "draft".into(),
    };
    let operation = uuid();
    let copies: Vec<_> = thread::scope(|scope| {
        let attempts: Vec<_> = (0..2)
            .map(|_| scope.spawn(|| copy_draft(&request, &draft, &operation, None, &vault.roots)))
            .collect();
        attempts
            .into_iter()
            .map(|attempt| attempt.join().unwrap())
            .collect()
    });
    let expected = CopyOutcome::Created {
        path: vault.path("notes/plan-3.md").to_string_lossy().into_owned(),
        relative_path: "notes/plan-3.md".into(),
        durable: true,
    };
    assert_eq!(copies, [expected.clone(), expected.clone()]);
    assert_eq!(
        copy_draft(&request, &draft, &operation, None, &vault.roots),
        expected
    );
    assert_eq!(
        fs::read_to_string(vault.path("notes/plan-3.md")).unwrap(),
        "draft"
    );
    let names: Vec<_> = fs::read_dir(vault.path("notes"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(names.len(), 3, "{names:?}");
    let ignore = vault
        .roots
        .canonical
        .join(".leadinglight/history/.gitignore");
    assert_eq!(fs::read(ignore).unwrap(), b"*\n");

    let newer = DraftSnapshot {
        seq: 8,
        ..draft.clone()
    };
    let mismatch = CopyOutcome::Refused {
        reason: CopyRefusal::OperationMismatch,
    };
    assert_eq!(
        copy_draft(&request, &newer, &operation, None, &vault.roots),
        mismatch
    );
    let outside = TempDir::new().unwrap();
    let elsewhere = outside.path().to_string_lossy().into_owned();
    let outcome = copy_draft(&request, &draft, &uuid(), Some(&elsewhere), &vault.roots);
    assert_eq!(
        outcome,
        CopyOutcome::Refused {
            reason: CopyRefusal::OutsideVault
        }
    );
    let outcome = copy_draft(&request, &draft, &uuid(), Some("missing"), &vault.roots);
    assert!(
        matches!(outcome, CopyOutcome::FolderUnavailable { .. }),
        "{outcome:?}"
    );
}

/// Seam: the copy lock and its order before the registry. Catches racing another window's copy
/// step, and saves stalling behind a held copy lock.
#[test]
fn a_held_copy_lock_answers_busy_while_saves_continue() {
    let vault = vault();
    let page = vault.page("a.md", "old");
    let request = vault.request(&page, 1, "x");
    let draft = DraftSnapshot {
        seq: 1,
        content: "x".into(),
    };
    let store = vault.roots.canonical.join(".leadinglight");
    fs::create_dir(&store).unwrap();
    let other_window = fs::File::create(store.join("history.lock")).unwrap();
    other_window.lock().unwrap();

    let outcome = copy_draft(&request, &draft, &uuid(), None, &vault.roots);
    assert_eq!(
        outcome,
        CopyOutcome::Refused {
            reason: CopyRefusal::Busy
        }
    );
    let outcome = release_with_copy(&request, &uuid(), &confirmed(1, "x"), &uuid(), &vault.roots);
    assert_eq!(outcome, refused(ResolutionRefusal::Busy));
    let quick = vault.request(&page, 2, "y");
    assert!(matches!(save(&quick, "y"), SaveOutcome::Committed { .. }));
    assert!(matches!(check_save(&quick), SaveRequestState::Done { .. }));
}

/// Seam: keep-copy needs current proof whenever it may settle the only pending text. Catches
/// settling on an edited, replaced or missing copy, including on an exact retry.
#[test]
fn keep_copy_settles_only_while_the_copy_holds_the_confirmed_text() {
    let vault = vault();
    let page = vault.path("gone.md");
    let request = vault.request(&page, 1, "text");
    save(&request, "text");
    let draft = DraftSnapshot {
        seq: 2,
        content: "text".into(),
    };
    let snapshot = confirmed(2, "text");
    let (operation, action) = (uuid(), uuid());
    let release = |action: &str, snapshot: &ConfirmedSnapshot| {
        release_with_copy(&request, action, snapshot, &operation, &vault.roots)
    };
    assert_eq!(
        release(&action, &snapshot),
        refused(ResolutionRefusal::CopyNotPublished)
    );
    let CopyOutcome::Created { path, .. } =
        copy_draft(&request, &draft, &operation, None, &vault.roots)
    else {
        panic!("copy was not created");
    };
    let copy = PathBuf::from(path);
    assert!(!page.exists());

    let newer = confirmed(3, "text and more");
    assert_eq!(
        release(&uuid(), &newer),
        refused(ResolutionRefusal::CopyChanged)
    );
    assert_eq!(
        release(&uuid(), &confirmed(3, "text")),
        refused(ResolutionRefusal::CopyChanged),
        "same bytes from a newer draft are not this copy"
    );
    fs::write(&copy, "edited").unwrap();
    assert_eq!(
        release(&action, &snapshot),
        refused(ResolutionRefusal::CopyChanged)
    );
    fs::write(&copy, "text").unwrap();
    let resolved = release(&action, &snapshot);
    assert!(
        matches!(
            resolved,
            ResolutionOutcome::Resolved {
                hold_retired: true,
                ..
            }
        ),
        "{resolved:?}"
    );
    assert_eq!(release(&action, &snapshot), resolved);
    fs::remove_file(&copy).unwrap();
    fs::write(&copy, "text").unwrap();
    assert_eq!(
        release(&action, &snapshot),
        refused(ResolutionRefusal::CopyNotOwned)
    );

    let stranger = vault.request(&page, 9, "text");
    let outcome = release_with_copy(&stranger, &uuid(), &snapshot, &operation, &vault.roots);
    assert_eq!(outcome, refused(ResolutionRefusal::OperationMismatch));
}

/// Seam: keep-copy claims its copy the way saves and mutations do. Catches a save or mutation
/// changing the copy while it is proven, or before the resolution is recorded.
#[test]
fn keep_copy_and_writes_to_the_copy_exclude_each_other() {
    let vault = vault();
    let request = vault.request(&vault.path("gone.md"), 1, "text");
    save(&request, "text");
    let draft = DraftSnapshot {
        seq: 1,
        content: "text".into(),
    };
    let operation = uuid();
    let CopyOutcome::Created { path, .. } =
        copy_draft(&request, &draft, &operation, None, &vault.roots)
    else {
        panic!("copy was not created");
    };
    let copy = PathBuf::from(path);
    let release = || {
        release_with_copy(
            &request,
            &uuid(),
            &confirmed(1, "text"),
            &operation,
            &vault.roots,
        )
    };
    let busy = refused(ResolutionRefusal::Busy);

    let (reached, resume) = (Barrier::new(2), Barrier::new(2));
    let pause = |_: &Path| {
        reached.wait();
        resume.wait();
    };
    let refuse = |_: &Path, _: &Path| -> Result<PathBuf, PublishError> {
        Err(PublishError {
            original_at: None,
            message: "no".to_string(),
        })
    };
    let platform = scripted(&pause, &refuse);
    let edit = vault.request(&copy, 1, "edit");
    let during_save = thread::scope(|scope| {
        let running = scope.spawn(|| run(&platform, &edit, "edit"));
        reached.wait();
        let during = release();
        resume.wait();
        running.join().unwrap();
        during
    });
    assert_eq!(during_save, busy, "a save is running on the copy");
    let mutation = lease(&[&copy]).unwrap();
    assert_eq!(release(), busy, "a mutation is running on the copy");
    drop(mutation);

    let attempts = Rc::new(RefCell::new(Vec::new()));
    let (seen, page) = (attempts.clone(), copy.to_string_lossy().into_owned());
    let (root, late) = (
        vault.roots.requested.clone(),
        vault.request(&copy, 2, "edit"),
    );
    AFTER_PROOF.set(Some(Box::new(move || {
        seen.borrow_mut()
            .push(wire(save(&late, "edit"))["reason"].clone());
        let root = Some(root.to_string_lossy().into_owned());
        let favorite = set_note_favorite_blocking(page.clone(), true, Some(0), root);
        seen.borrow_mut().push(json!(favorite.err()));
    })));
    let resolved = release();
    AFTER_PROOF.set(None);
    assert!(
        matches!(resolved, ResolutionOutcome::Resolved { .. }),
        "{resolved:?}"
    );
    assert_eq!(*attempts.borrow(), [json!("busy"), json!(BUSY_MESSAGE)]);
    assert_eq!(fs::read_to_string(&copy).unwrap(), "text");
}

/// Seam: later recovery re-checks the page's folder before any read. Catches Check, a copy
/// retry or keep-copy reading through a folder that was swapped for a link out of the vault.
#[test]
fn recovery_never_reads_through_a_folder_swapped_for_an_outside_link() {
    let vault = vault();
    let page = vault.page("notes/a.md", "old");
    let request = vault.request(&page, 1, "new");
    let SaveOutcome::Uncertain {
        staged_at: Some(staged),
        ..
    } = run(&scripted(&nothing, &lost), &request, "new")
    else {
        panic!("save was not uncertain");
    };
    let draft = DraftSnapshot {
        seq: 1,
        content: "new".into(),
    };
    let operation = uuid();
    let created = copy_draft(&request, &draft, &operation, None, &vault.roots);
    assert!(
        matches!(created, CopyOutcome::Created { .. }),
        "{created:?}"
    );

    let outside = TempDir::new().unwrap();
    let moved = outside.path().join("notes");
    fs::rename(vault.path("notes"), &moved).unwrap();
    symlink(&moved, vault.path("notes")).unwrap();

    let state = check_save(&request);
    assert!(
        matches!(
            state,
            SaveRequestState::Done {
                outcome: SaveOutcome::Uncertain { .. }
            }
        ),
        "{state:?}"
    );
    assert!(Path::new(&staged).exists());
    let candidate = vault.roots.canonical.join("notes/a-2.md");
    assert_eq!(
        copy_draft(&request, &draft, &operation, None, &vault.roots),
        CopyOutcome::Uncertain {
            candidate_path: Some(candidate.to_string_lossy().into_owned())
        }
    );
    assert_eq!(
        release_with_copy(
            &request,
            &uuid(),
            &confirmed(1, "new"),
            &operation,
            &vault.roots
        ),
        refused(ResolutionRefusal::CopyNotOwned)
    );
}

/// Seam: the copy intent is on disk, folder entry included, before the copy is published.
/// Catches publishing a copy whose record a retry needs could still be lost.
#[test]
fn a_copy_is_not_published_until_its_intent_is_durable() {
    let vault = vault();
    let request = vault.request(&vault.page("a.md", "old"), 1, "x");
    let draft = DraftSnapshot {
        seq: 1,
        content: "draft".into(),
    };
    let operation = uuid();
    let unsynced = Scripted {
        synced: false,
        ..scripted(&nothing, &native)
    };
    let outcome = copy_with(&unsynced, &request, &draft, &operation, None, &vault.roots);
    assert!(matches!(outcome, CopyOutcome::Failed { .. }), "{outcome:?}");
    assert!(!vault.path("a-2.md").exists());
    let intent = format!(".leadinglight/history/copy-{operation}.json");
    assert!(!vault.path(&intent).exists());
    let retried = copy_draft(&request, &draft, &operation, None, &vault.roots);
    assert!(
        matches!(retried, CopyOutcome::Created { durable: true, .. }),
        "{retried:?}"
    );
}

/// Seam: note and attachment renames rewrite linked pages under the same leases as saves.
/// Catches a rename writing its stale copy over a page that is saving or held for a decision.
#[test]
fn renames_skip_linked_pages_that_are_saving_or_held() {
    let vault = vault();
    let renamed = vault.page("plan.md", "# Plan\n");
    let image = vault.page("attachments/a.png", "png");
    let linked = "See [[plan]] and ![[attachments/a.png]].\n";
    let saving = vault.page("saving.md", linked);
    let held = vault.page("held.md", linked);
    run(
        &scripted(&nothing, &lost),
        &vault.request(&held, 1, "x"),
        "x",
    );

    let counts = Mutex::new(Vec::new());
    let rename_now = |_: &Path| {
        let root = vault.dir.path().to_string_lossy();
        let note = rename_note_filename(RenameNoteFilenameRequest {
            vault_path: &root,
            old_path: &renamed.to_string_lossy(),
            new_filename_stem: "goals",
        })
        .unwrap();
        let attachment = rename_attachment(AttachmentRenameRequest {
            requested_name: "b.png",
            source_path: &image.to_string_lossy(),
            vault_path: &root,
        })
        .unwrap();
        *counts.lock().unwrap() = vec![
            (note.updated_files, note.failed_updates),
            (attachment.updated_files, attachment.failed_updates),
        ];
    };
    let mine = "See [[plan]] and ![[attachments/a.png]] today.\n";
    let outcome = run(
        &scripted(&rename_now, &native),
        &vault.request(&saving, 1, mine),
        mine,
    );
    assert!(
        matches!(outcome, SaveOutcome::Committed { .. }),
        "{outcome:?}"
    );
    assert_eq!(*counts.lock().unwrap(), [(0, 2), (0, 2)]);
    assert_eq!(fs::read_to_string(&saving).unwrap(), mine);
    assert_eq!(fs::read_to_string(&held).unwrap(), linked);
}

/// Seam: mutations lease their pages for their whole run. Catches a rename, Trash move, folder
/// rename (also through a folder link), title sync or frontmatter write changing a page whose
/// text is waiting for a decision.
#[tokio::test]
async fn mutations_refuse_a_held_page_until_it_is_resolved() {
    let vault = vault();
    let page = vault.page("folder/held.md", "---\nStatus: Draft\n---\n# Held\n");
    symlink(vault.path("folder"), vault.path("alias")).unwrap();
    let request = vault.request(&page, 1, "mine");
    run(&scripted(&nothing, &lost), &request, "mine");
    let root = vault.dir.path().to_string_lossy().into_owned();
    let path = page.to_string_lossy().into_owned();
    let status = || FrontmatterValue::String("Done".into());
    let rename = json!({"vaultPath": root, "oldPath": path, "newTitle": "Renamed"});
    let attempts = vec![
        update_frontmatter_blocking(path.clone(), "Status".into(), status(), Some(root.clone()))
            .map(drop),
        set_note_favorite_blocking(path.clone(), true, Some(0), Some(root.clone())).map(drop),
        rename_note_blocking(serde_json::from_value(rename).unwrap()).map(drop),
        rename_vault_folder(root.clone(), "folder".into(), "renamed".into()).map(drop),
        move_to_local_trash(root.clone(), vec![path.clone()])
            .await
            .map(drop),
        rename_vault_folder(root.clone(), "alias".into(), "renamed".into()).map(drop),
        sync_note_title_blocking(page.clone(), Some(vault.dir.path().into())).map(drop),
    ];
    let held = Err(HELD_MESSAGE.to_string());
    assert_eq!(attempts, vec![held; attempts.len()]);
    assert!(page.exists());

    discard(&request, &uuid(), &confirmed(1, "mine"));
    assert!(update_frontmatter_blocking(path, "Status".into(), status(), Some(root)).is_ok());
}

/// Seam: the old save command now runs the same pipeline. Catches it recreating a deleted page or
/// leaving a hold that no window can resolve.
#[test]
fn legacy_save_reports_refusals_and_never_holds() {
    let vault = vault();
    let root = vault.dir.path().to_string_lossy().into_owned();
    let gone = vault.path("gone.md");
    assert_eq!(
        legacy_save(&target(&gone), &root, "x"),
        Err("refused: missing".to_string())
    );
    assert!(!gone.exists());
    let after = wire(save(&vault.request(&gone, 1, "y"), "y"));
    assert_eq!(after["reason"], "missing");

    let page = vault.page("a.md", "old");
    legacy_save(&target(&page), &root, "new").unwrap();
    assert_eq!(fs::read_to_string(&page).unwrap(), "new");
}
