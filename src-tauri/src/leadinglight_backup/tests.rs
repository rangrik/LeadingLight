//! Seams of M6 backup and restore: the copy contract, the path rule, publication, cancel, and
//! the untrusted manifest. Synthetic temporary folders only.

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::backup;
use super::fsx::{self, AFTER_OPEN};
use super::registry::Op;
use super::restore;
use super::rules::{ENTRY_CAP, MANIFEST, RESTORE_MARKER};
use super::*;
use crate::leadinglight_history::history_outcome::ListVersionsOutcome;
use crate::leadinglight_history::outcome::{OriginalRequest, SaveOutcome};
use crate::leadinglight_history::{list_versions, page_key, save_page, PageTarget};

const BOM_CRLF: &str = "\u{feff}# Plan \u{2713}\r\nzwei Zeilen \u{2014} na\u{ef}ve \u{65e5}\u{672c}\u{8a9e} \u{1f600}\r\n";
const SECRET: &[u8] = b"outside-secret-7f3a";

fn roots(dir: &Path) -> VaultRoots {
    VaultRoots {
        requested: dir.to_path_buf(),
        canonical: dir.canonicalize().unwrap(),
    }
}

fn put(dir: &Path, rel: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
    path
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Every regular file under `dir`, by relative path, never through a link.
fn files(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    walkdir::WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| {
            let rel = entry.path().strip_prefix(dir).unwrap();
            (
                rel.to_string_lossy().into_owned(),
                fs::read(entry.path()).unwrap(),
            )
        })
        .collect()
}

/// Saves `after` over `before` through the real ordinary save, which keeps `before` as a version.
fn save_version(ws: &Path, rel: &str, before: &str, after: &str) {
    let path = put(ws, rel, before.as_bytes());
    let request = OriginalRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        vault_path: text(ws),
        session: "backup-test".into(),
        path: text(&path),
        seq: 1,
        submitted_sha256: fsx::hex(&crate::vault::staged_file::sha256(after.as_bytes())),
    };
    let target = PageTarget {
        key: page_key(&path).unwrap(),
        path,
    };
    let outcome = save_page(&request, after, Some(&target));
    assert!(
        matches!(outcome, SaveOutcome::Committed { history: None, .. }),
        "{outcome:?}"
    );
}

fn rows(ws: &Path, rel: &str) -> Vec<(String, String)> {
    let path = ws.join(rel);
    let target = PageTarget {
        key: page_key(&path).unwrap(),
        path,
    };
    match list_versions(&roots(ws), &target, None) {
        ListVersionsOutcome::Ok { versions, .. } => versions
            .into_iter()
            .map(|row| (row.id, row.sha256))
            .collect(),
        other => panic!("{other:?}"),
    }
}

fn run_backup(ws: &Path, dest: &Path) -> BackupResult {
    let job =
        prepare_backup(roots(ws), &text(dest), Vec::new()).unwrap_or_else(|why| panic!("{why:?}"));
    backup::run(&Op::new(Kind::Backup), job)
}

fn saved(result: BackupResult) -> SavedBackup {
    match result {
        BackupResult::Complete(saved) | BackupResult::Incomplete(saved) => saved,
        other => panic!("{other:?}"),
    }
}

fn run_inspect(backup: &Path) -> InspectResult {
    restore::inspect(
        &Op::new(Kind::Inspect),
        prepare_inspect(&text(backup)).unwrap(),
    )
}

fn sha_of(backup: &Path) -> String {
    match run_inspect(backup) {
        InspectResult::Ok {
            manifest_sha256, ..
        } => manifest_sha256,
        other => panic!("{other:?}"),
    }
}

fn run_restore(backup: &Path, sha: &str, parent: &Path, name: &str) -> RestoreResult {
    let job = prepare_restore(&text(backup), sha, &text(parent), name, &[]).unwrap();
    restore::restore(&Op::new(Kind::Restore), job)
}

/// A workspace with pages, an attachment, views, a saved version and things never copied.
fn workspace() -> TempDir {
    let ws = TempDir::new().unwrap();
    let dir = ws.path();
    put(dir, "notes/plan.md", BOM_CRLF.as_bytes());
    put(dir, "empty.md", b"");
    put(
        dir,
        "attachments/pic.png",
        &[0, 159, 146, 150, 255, 0, 13, 10],
    );
    put(dir, ".laputa/views/work.yml", b"name: Work\n");
    put(dir, ".git/config", b"[core]\n");
    put(dir, ".DS_Store", b"junk");
    put(dir, ".laputa-cache.json", b"{}");
    put(dir, ".leadinglight-kept/stage.md", b"staged");
    put(
        dir,
        ".leadinglight/trash/0123456789abcdef0123456789abcdef/item.json",
        b"{}",
    );
    put(dir, ".leadinglight/trash.lock", b"");
    save_version(dir, "notes/draft.md", "first words\n", "second words\n");
    ws
}

/// Seam: the backup format and restore. Catches lost or changed bytes or times, copied internals
/// or Trash, and saved versions that no longer list after a restore.
#[test]
fn a_backup_restores_exact_bytes_times_and_saved_versions_into_a_new_folder() {
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    let saved = saved(run_backup(ws.path(), dest.path()));
    assert_eq!(saved.gaps.total, 0);
    assert_eq!(saved.trash_items_not_included, 1);
    assert_eq!(saved.versions_skipped, 0);
    let backup = PathBuf::from(&saved.folder);
    let copied = files(&backup.join("workspace"));
    let user: Vec<&String> = copied
        .keys()
        .filter(|path| !path.starts_with(".leadinglight"))
        .collect();
    assert_eq!(
        user,
        [
            ".laputa/views/work.yml",
            "attachments/pic.png",
            "empty.md",
            "notes/draft.md",
            "notes/plan.md"
        ]
    );
    assert!(copied
        .keys()
        .all(|path| !path.contains("trash") && !path.contains(".git")));
    assert_eq!(
        copied
            .keys()
            .filter(|path| path.starts_with(".leadinglight/history/versions/"))
            .count(),
        3
    );
    assert_eq!(saved.files, copied.len() as u64);

    let parent = TempDir::new().unwrap();
    let sha = sha_of(&backup);
    let restored = match run_restore(&backup, &sha, parent.path(), "Restored") {
        RestoreResult::Restored {
            folder,
            times_kept: true,
            ..
        } => PathBuf::from(folder),
        other => panic!("{other:?}"),
    };
    assert_eq!(files(&restored), copied);
    assert!(!restored.join(RESTORE_MARKER).exists());
    let modified = |path: &Path| fsx::modified_ms(&fs::metadata(path).unwrap());
    assert_eq!(
        modified(&restored.join("notes/plan.md")),
        modified(&ws.path().join("notes/plan.md"))
    );
    assert_eq!(
        rows(&restored, "notes/draft.md"),
        rows(ws.path(), "notes/draft.md")
    );
    assert_eq!(rows(&restored, "notes/draft.md").len(), 1);
}

/// Seam: the walk and leaf opens. Catches a link or special file silently skipped, or bytes from
/// outside the workspace copied through a link.
#[test]
fn links_and_special_files_are_disclosed_gaps_and_outside_bytes_are_never_read() {
    let ws = workspace();
    let outside = TempDir::new().unwrap();
    put(outside.path(), "secret.md", SECRET);
    symlink(
        outside.path().join("secret.md"),
        ws.path().join("linked.md"),
    )
    .unwrap();
    symlink(outside.path(), ws.path().join("linked-folder")).unwrap();
    let _socket = std::os::unix::net::UnixListener::bind(ws.path().join("socket")).unwrap();
    let dest = TempDir::new().unwrap();
    let result = run_backup(ws.path(), dest.path());
    let BackupResult::Incomplete(saved) = result else {
        panic!("{result:?}");
    };
    assert_eq!(saved.gaps.counts.get(&GapReason::Link), Some(&2));
    assert_eq!(saved.gaps.counts.get(&GapReason::Special), Some(&1));
    let all = files(dest.path());
    assert!(all
        .values()
        .all(|bytes| !bytes.windows(SECRET.len()).any(|w| w == SECRET)));
    assert!(
        fsx::open_read(&ws.path().join("linked.md")).is_err(),
        "leaf open must not follow"
    );
}

/// Seam: the source and destination guards. Catches a backup into any workspace, or a restore
/// into a workspace or into the backup itself, before anything is written.
#[test]
fn destinations_inside_workspaces_or_the_backup_are_refused_before_writing() {
    let ws = workspace();
    let other = TempDir::new().unwrap();
    let known = vec![other.path().canonicalize().unwrap()];
    let refused = |dest: &Path, known: Vec<PathBuf>| {
        prepare_backup(roots(ws.path()), &text(dest), known).err()
    };
    fs::create_dir(ws.path().join("inside")).unwrap();
    assert_eq!(
        refused(&ws.path().join("inside"), Vec::new()),
        Some(StartRefusal::DestinationInWorkspace)
    );
    assert_eq!(
        refused(ws.path(), Vec::new()),
        Some(StartRefusal::DestinationInWorkspace)
    );
    assert_eq!(
        refused(other.path(), known.clone()),
        Some(StartRefusal::DestinationInWorkspace)
    );
    assert_eq!(
        refused(&ws.path().join("missing"), Vec::new()),
        Some(StartRefusal::DestinationMissing)
    );
    assert_eq!(
        refused(&ws.path().join("empty.md"), Vec::new()),
        Some(StartRefusal::DestinationNotFolder)
    );

    let dest = TempDir::new().unwrap();
    let backup = PathBuf::from(saved(run_backup(ws.path(), dest.path())).folder);
    let restore = |parent: &Path, name: &str, known: &[PathBuf]| {
        prepare_restore(&text(&backup), "x", &text(parent), name, known).err()
    };
    assert_eq!(
        restore(other.path(), "R", &known),
        Some(StartRefusal::ParentInWorkspace)
    );
    assert_eq!(
        restore(&backup, "R", &[]),
        Some(StartRefusal::ParentInBackup)
    );
    for name in ["", ".hidden", "a/b", "a:b", " padded", "..", "x\u{7}"] {
        assert_eq!(
            restore(dest.path(), name, &[]),
            Some(StartRefusal::NameInvalid),
            "{name:?}"
        );
    }
    assert_eq!(fs::read_dir(other.path()).unwrap().count(), 0);
}

/// Seam: publication. Catches a manifest replacing a stranger's file, a backup published into a
/// swapped folder, or cleanup that touches a foreign tree.
#[test]
fn a_stranger_manifest_or_a_swapped_folder_blocks_publication_without_touching_them() {
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    backup::BEFORE_COMMIT.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|root: &Path| {
            fs::write(root.join(MANIFEST), b"stranger").unwrap();
        }))
    });
    let result = run_backup(ws.path(), dest.path());
    backup::BEFORE_COMMIT.with(|hook| *hook.borrow_mut() = None);
    let BackupResult::Failed {
        reason: BackupFailure::DestinationChanged,
        leftover: Some(left),
        ..
    } = result
    else {
        panic!("{result:?}");
    };
    assert_eq!(
        files(Path::new(&left)),
        BTreeMap::from([(MANIFEST.to_string(), b"stranger".to_vec())])
    );

    let dest = TempDir::new().unwrap();
    let moved = dest.path().join("moved-away");
    let moved_hook = moved.clone();
    backup::BEFORE_COMMIT.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move |root: &Path| {
            fs::rename(root, &moved_hook).unwrap();
            fs::create_dir(root).unwrap();
            fs::write(root.join("theirs.md"), b"theirs").unwrap();
        }))
    });
    let result = run_backup(ws.path(), dest.path());
    backup::BEFORE_COMMIT.with(|hook| *hook.borrow_mut() = None);
    let BackupResult::Failed {
        reason: BackupFailure::DestinationChanged,
        leftover: Some(left),
        ..
    } = result
    else {
        panic!("{result:?}");
    };
    assert_eq!(
        files(Path::new(&left)),
        BTreeMap::from([("theirs.md".to_string(), b"theirs".to_vec())])
    );
    assert!(!Path::new(&left).join(MANIFEST).exists());
    assert!(
        !moved.join(MANIFEST).exists(),
        "the moved copy is never published"
    );
}

/// Seam: cancel and completion share one lock. Catches a cancel before the completion point
/// leaving a backup, or a cancel after it turning success into "cancelled".
#[test]
fn cancel_before_completion_removes_what_was_made_and_after_it_changes_nothing() {
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    let op = std::sync::Arc::new(Op::new(Kind::Backup));
    let cancel = std::sync::Arc::clone(&op);
    backup::BEFORE_COMMIT.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move |_: &Path| {
            cancel.request_cancel();
        }))
    });
    let job = prepare_backup(roots(ws.path()), &text(dest.path()), Vec::new()).unwrap();
    let result = backup::run(&op, job);
    backup::BEFORE_COMMIT.with(|hook| *hook.borrow_mut() = None);
    assert_eq!(result, BackupResult::Cancelled { leftover: None });
    assert_eq!(fs::read_dir(dest.path()).unwrap().count(), 0);

    let late = Op::new(Kind::Backup);
    assert!(late
        .complete(|| Ok::<_, ()>(OpResult::Restore(RestoreResult::NameTaken)))
        .is_some_and(|done| done.is_ok()));
    assert!(
        !late.request_cancel(),
        "a cancel after the completion point is refused"
    );
    assert!(!late.cancelled());
}

/// Seam: one stable read per file. Catches bytes from a file that changed mid-read being kept
/// as if stable, and a file that never settles being dropped silently.
#[test]
fn a_changed_file_is_retried_and_one_that_keeps_changing_is_a_gap() {
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    let plan = ws.path().join("notes/plan.md");
    let mut once = true;
    AFTER_OPEN.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move |path: &Path| {
            if once && path.ends_with("notes/plan.md") {
                once = false;
                fs::write(path, b"rewritten while reading").unwrap();
            }
        }))
    });
    let saved = saved(run_backup(ws.path(), dest.path()));
    AFTER_OPEN.with(|hook| *hook.borrow_mut() = None);
    assert_eq!(saved.gaps.total, 0);
    let backup = PathBuf::from(&saved.folder);
    assert_eq!(
        fs::read(backup.join("workspace/notes/plan.md")).unwrap(),
        b"rewritten while reading"
    );

    let dest = TempDir::new().unwrap();
    let mut n = 0;
    AFTER_OPEN.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move |path: &Path| {
            if path.ends_with("notes/plan.md") {
                n += 1;
                fs::write(path, format!("edit {n}")).unwrap();
            }
        }))
    });
    let result = run_backup(ws.path(), dest.path());
    AFTER_OPEN.with(|hook| *hook.borrow_mut() = None);
    let BackupResult::Incomplete(saved) = result else {
        panic!("{result:?}");
    };
    assert_eq!(saved.gaps.sample[0].path.as_deref(), Some("notes/plan.md"));
    assert_eq!(saved.gaps.sample[0].reason, GapReason::Changing);
    let backup = PathBuf::from(&saved.folder);
    assert!(!backup.join("workspace/notes/plan.md").exists());
    assert!(plan.exists());
}

/// Seam: ancestor and leaf checks after counting. Catches a page or folder swapped for a link
/// between the count and the open being read through that link.
#[test]
fn a_page_or_folder_swapped_for_a_link_after_counting_is_never_read_through() {
    let ws = workspace();
    let outside = TempDir::new().unwrap();
    put(outside.path(), "plan.md", SECRET);
    put(outside.path(), "pic.png", SECRET);
    let dest = TempDir::new().unwrap();
    let (root, away) = (ws.path().to_path_buf(), outside.path().to_path_buf());
    let mut swapped = false;
    AFTER_OPEN.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move |path: &Path| {
            if !swapped && path.ends_with(".laputa/views/work.yml") {
                swapped = true;
                fs::rename(root.join("attachments"), root.join("attachments-old")).unwrap();
                symlink(&away, root.join("attachments")).unwrap();
                fs::remove_file(root.join("notes/plan.md")).unwrap();
                symlink(away.join("plan.md"), root.join("notes/plan.md")).unwrap();
            }
        }))
    });
    let result = run_backup(ws.path(), dest.path());
    AFTER_OPEN.with(|hook| *hook.borrow_mut() = None);
    let BackupResult::Incomplete(saved) = result else {
        panic!("{result:?}");
    };
    let reasons: Vec<_> = saved
        .gaps
        .sample
        .iter()
        .map(|s| (s.path.clone().unwrap(), s.reason))
        .collect();
    assert!(
        reasons.contains(&("attachments/pic.png".into(), GapReason::Changing)),
        "{reasons:?}"
    );
    assert!(
        reasons.contains(&("notes/plan.md".into(), GapReason::Link)),
        "{reasons:?}"
    );
    let all = files(dest.path());
    assert!(all
        .values()
        .all(|bytes| !bytes.windows(SECRET.len()).any(|w| w == SECRET)));
}

fn edit_manifest(backup: &Path, edit: impl FnOnce(&mut serde_json::Value)) {
    let path = backup.join(MANIFEST);
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    edit(&mut value);
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
}

fn damaged(backup: &Path) -> Vec<Problem> {
    match run_inspect(backup) {
        InspectResult::Damaged { problems } => problems.counts.into_keys().collect(),
        other => panic!("{other:?}"),
    }
}

/// Seam: the manifest is untrusted. Catches forged paths reaching internal artifacts or outside
/// the folder, inconsistent counts, unknown fields or versions, and oversized manifests.
#[test]
fn a_forged_or_damaged_manifest_is_refused_by_inspection_and_restore() {
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    let backup = PathBuf::from(saved(run_backup(ws.path(), dest.path())).folder);
    let original = fs::read(backup.join(MANIFEST)).unwrap();
    let restore_original = || fs::write(backup.join(MANIFEST), &original).unwrap();
    let first_entry = |value: &serde_json::Value| value["files"][0].clone();

    let forged_path = |path: &'static str| {
        move |value: &mut serde_json::Value| {
            let mut entry = first_entry(value);
            entry["path"] = path.into();
            value["files"].as_array_mut().unwrap().push(entry);
            value["totalFiles"] = (value["totalFiles"].as_u64().unwrap() + 1).into();
            let bytes = value["totalBytes"].as_u64().unwrap()
                + value["files"][0]["bytes"].as_u64().unwrap();
            value["totalBytes"] = bytes.into();
        }
    };
    for path in [
        "../escape.md",
        "/abs.md",
        ".git/config",
        ".leadinglight/trash/0123456789abcdef0123456789abcdef/restore.json",
        ".leadinglight/history/tmp/x.tmpv",
        ".leadinglight-kept/x.md",
        "C:/drive.md",
        "a\\b.md",
        ".LeadingLight/trash/0123456789abcdef0123456789abcdef/restore.json",
        ".GIT/config",
        ".LEADINGLIGHT-kept/x.md",
    ] {
        edit_manifest(&backup, forged_path(path));
        assert!(damaged(&backup).contains(&Problem::BadPath), "{path}");
        restore_original();
    }
    edit_manifest(&backup, forged_path(".laputa/views/work.yml"));
    assert!(damaged(&backup).contains(&Problem::DuplicatePath));
    restore_original();
    edit_manifest(&backup, forged_path("empty.md/inner.md"));
    assert!(damaged(&backup).contains(&Problem::PathConflict));
    restore_original();
    edit_manifest(&backup, |value| value["version"] = 2.into());
    assert_eq!(damaged(&backup), [Problem::UnsupportedVersion]);
    restore_original();
    edit_manifest(&backup, |value| value["surprise"] = true.into());
    assert_eq!(damaged(&backup), [Problem::ManifestInvalid]);
    restore_original();
    edit_manifest(&backup, |value| value["gapsTotal"] = 1.into());
    assert_eq!(damaged(&backup), [Problem::ManifestInvalid]);
    restore_original();
    edit_manifest(&backup, |value| {
        value["files"][0]["bytes"] = (1u64 << 53).into()
    });
    assert!(damaged(&backup).contains(&Problem::ManifestInvalid));
    restore_original();
    fs::File::create(backup.join(MANIFEST))
        .unwrap()
        .set_len((64 << 20) + 1)
        .unwrap();
    assert_eq!(damaged(&backup), [Problem::ManifestTooLarge]);
    restore_original();
    fs::remove_file(backup.join(MANIFEST)).unwrap();
    assert_eq!(run_inspect(&backup), InspectResult::NotBackup);
    restore_original();

    ENTRY_CAP.with(|cap| cap.set(3));
    let too_many = damaged(&backup);
    ENTRY_CAP.with(|cap| cap.set(super::rules::MAX_ENTRIES));
    assert_eq!(too_many, [Problem::TooLarge]);
    assert!(matches!(
        run_inspect(&backup),
        InspectResult::Ok { extra_files: 0, .. }
    ));
}

/// Seam: restore never trusts inspection. Catches a backup changed after a successful inspection
/// still being published, or a restore that overwrites or reuses an existing folder.
#[test]
fn a_backup_changed_after_inspection_is_never_published_and_names_are_never_reused() {
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    let backup = PathBuf::from(saved(run_backup(ws.path(), dest.path())).folder);
    let sha = sha_of(&backup);
    let parent = TempDir::new().unwrap();
    fs::create_dir(parent.path().join("Taken")).unwrap();
    put(parent.path(), "Taken/mine.md", b"mine");
    assert_eq!(
        run_restore(&backup, &sha, parent.path(), "Taken"),
        RestoreResult::NameTaken
    );
    assert_eq!(
        fs::read(parent.path().join("Taken/mine.md")).unwrap(),
        b"mine"
    );

    let page = backup.join("workspace/notes/plan.md");
    let mut bytes = fs::read(&page).unwrap();
    bytes[4] ^= 1;
    fs::write(&page, &bytes).unwrap();
    let result = run_restore(&backup, &sha, parent.path(), "Fresh");
    let RestoreResult::BackupChanged {
        problems,
        leftover: None,
    } = result
    else {
        panic!("{result:?}");
    };
    assert_eq!(problems.sample[0].path.as_deref(), Some("notes/plan.md"));
    assert!(!parent.path().join("Fresh").exists());

    edit_manifest(&backup, |value| value["workspaceName"] = "Renamed".into());
    let result = run_restore(&backup, &sha, parent.path(), "Fresh");
    assert!(
        matches!(result, RestoreResult::BackupChanged { leftover: None, .. }),
        "{result:?}"
    );
    assert!(!parent.path().join("Fresh").exists());
}

/// Seam: the unfinished marker. Catches a restore claimed complete, or its marker erased, while
/// partial or unverified data remains in the new folder.
#[test]
fn the_unfinished_marker_stays_while_any_partial_restore_remains() {
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    let backup = PathBuf::from(saved(run_backup(ws.path(), dest.path())).folder);
    let sha = sha_of(&backup);
    let parent = TempDir::new().unwrap();

    restore::BEFORE_COMPLETE.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|root: &Path| {
            fs::remove_file(root.join(RESTORE_MARKER)).unwrap();
            fs::write(root.join(RESTORE_MARKER), b"not ours").unwrap();
        }))
    });
    let result = run_restore(&backup, &sha, parent.path(), "Uncertain");
    restore::BEFORE_COMPLETE.with(|hook| *hook.borrow_mut() = None);
    let RestoreResult::Failed {
        reason: RestoreFailure::Io,
        leftover: Some(left),
        ..
    } = result
    else {
        panic!("{result:?}");
    };
    assert!(Path::new(&left).join(RESTORE_MARKER).exists());

    let page = backup.join("workspace/notes/plan.md");
    let mut bytes = fs::read(&page).unwrap();
    bytes[4] ^= 1;
    fs::write(&page, &bytes).unwrap();
    let stranger = parent.path().join("Partial/theirs.md");
    let stranger_hook = stranger.clone();
    AFTER_OPEN.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move |path: &Path| {
            if path.ends_with(".laputa/views/work.yml") {
                fs::write(&stranger_hook, b"theirs").unwrap();
            }
        }))
    });
    let result = run_restore(&backup, &sha, parent.path(), "Partial");
    AFTER_OPEN.with(|hook| *hook.borrow_mut() = None);
    let RestoreResult::BackupChanged {
        leftover: Some(left),
        ..
    } = result
    else {
        panic!("{result:?}");
    };
    assert_eq!(
        files(Path::new(&left)).into_keys().collect::<Vec<_>>(),
        [RESTORE_MARKER, "theirs.md"]
    );
}

/// Seam: output name collisions on a case-insensitive disk. Catches two backup entries merged
/// into one file, or an overwrite, when names differ only by case.
#[test]
fn names_that_collide_on_the_output_disk_fail_without_overwriting() {
    let probe = TempDir::new().unwrap();
    fs::write(probe.path().join("a"), b"").unwrap();
    if !probe.path().join("A").exists() {
        return; // a case-sensitive disk cannot collide this way
    }
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    let backup = PathBuf::from(saved(run_backup(ws.path(), dest.path())).folder);
    edit_manifest(&backup, |value| {
        let entry = value["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["path"] == "empty.md")
            .cloned()
            .unwrap();
        let mut twin = entry.clone();
        twin["path"] = "EMPTY.md".into();
        value["files"].as_array_mut().unwrap().push(twin);
        value["totalFiles"] = (value["totalFiles"].as_u64().unwrap() + 1).into();
    });
    let sha = sha_of(&backup);
    let parent = TempDir::new().unwrap();
    let result = run_restore(&backup, &sha, parent.path(), "Twins");
    let RestoreResult::Failed {
        reason: RestoreFailure::Io,
        path: Some(path),
        leftover: None,
    } = result
    else {
        panic!("{result:?}");
    };
    assert_eq!(path, "EMPTY.md");
    assert!(!parent.path().join("Twins").exists());
}

/// Seam: the operation registry. Catches a repeated start making a second backup, a reused id
/// with other arguments being accepted, and a start that is not a UUID.
#[test]
fn a_repeated_start_never_makes_a_second_backup() {
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let args = [text(ws.path()), text(dest.path())];
    let start = |args: [String; 2]| {
        start_backup(&id, &[&args[0], &args[1]], || {
            prepare_backup(roots(ws.path()), &args[1], Vec::new())
        })
    };
    assert_eq!(when_free(|| start(args.clone())), StartAnswer::Started);
    let finished = loop {
        if let OperationState::Finished {
            kind: Kind::Backup,
            result,
        } = state(&id)
        {
            break result;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    };
    assert_eq!(
        start(args.clone()),
        StartAnswer::Finished { result: finished }
    );
    assert_eq!(fs::read_dir(dest.path()).unwrap().count(), 1);
    let other = [args[0].clone(), text(ws.path())];
    assert_eq!(
        start(other),
        StartAnswer::Refused {
            reason: StartRefusal::OperationMismatch
        }
    );
    assert_eq!(cancel(&id), CancelAnswer { accepted: false });
    let bad = start_inspect("NOT-A-UUID", "/tmp");
    assert_eq!(
        bad,
        StartAnswer::Refused {
            reason: StartRefusal::OperationMismatch
        }
    );
    assert_eq!(
        state(&uuid::Uuid::new_v4().to_string()),
        OperationState::Unknown
    );
}

/// Seam: the preflight bound. Catches a workspace over the limit being partly written before
/// the refusal.
#[test]
fn a_workspace_over_the_entry_limit_is_refused_before_writing() {
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    ENTRY_CAP.with(|cap| cap.set(4));
    let result = run_backup(ws.path(), dest.path());
    ENTRY_CAP.with(|cap| cap.set(super::rules::MAX_ENTRIES));
    assert_eq!(
        result,
        BackupResult::Failed {
            reason: BackupFailure::TooLarge,
            path: None,
            leftover: None
        }
    );
    assert_eq!(fs::read_dir(dest.path()).unwrap().count(), 0);
}

/// Seam: saved versions pass history's own checks. Catches a damaged or unlisted version copied
/// as intact, or an omitted one not counted.
#[test]
fn a_damaged_saved_version_is_counted_as_skipped_not_copied() {
    let ws = workspace();
    let versions = ws.path().join(".leadinglight/history/versions");
    let payload = files(&versions)
        .into_keys()
        .find(|path| path.ends_with("/payload"))
        .unwrap();
    let mut bytes = fs::read(versions.join(&payload)).unwrap();
    bytes[0] ^= 1;
    fs::write(versions.join(&payload), &bytes).unwrap();
    // A version-shaped folder history never lists counts as omitted too.
    let loc = payload.split('/').next().unwrap();
    let unlisted = format!("{loc}/0000000000001-0000000000000000-000000");
    put(&versions, &format!("{unlisted}/version.json"), b"{}");
    put(&versions, &format!("{unlisted}/payload"), b"x");
    let dest = TempDir::new().unwrap();
    let result = run_backup(ws.path(), dest.path());
    let BackupResult::Complete(saved) = result else {
        panic!("{result:?}");
    };
    assert_eq!(saved.versions_skipped, 2);
    let copied = files(&PathBuf::from(&saved.folder).join("workspace"));
    assert!(copied.keys().all(|path| !path.starts_with(".leadinglight")));
}

/// Seam: the chosen destination is pinned. Catches output written into a folder swapped in
/// after the check.
#[test]
fn a_destination_swapped_after_the_check_receives_nothing() {
    let ws = workspace();
    let base = TempDir::new().unwrap();
    let chosen = base.path().join("chosen");
    fs::create_dir(&chosen).unwrap();
    let job = prepare_backup(roots(ws.path()), &text(&chosen), Vec::new()).unwrap();
    fs::rename(&chosen, base.path().join("original")).unwrap();
    fs::create_dir(&chosen).unwrap();
    let result = backup::run(&Op::new(Kind::Backup), job);
    assert_eq!(
        result,
        BackupResult::Failed {
            reason: BackupFailure::DestinationChanged,
            path: None,
            leftover: None
        }
    );
    assert_eq!(fs::read_dir(&chosen).unwrap().count(), 0);
    assert_eq!(
        fs::read_dir(base.path().join("original")).unwrap().count(),
        0
    );
}

/// Seam: the wire shape shared with `backupContract.ts`. Catches a renamed or extra field that
/// the UI and bridge parsers would reject.
#[test]
fn answers_serialize_exactly_as_the_shared_contract() {
    use serde_json::json;
    let mut gaps = Summary::default();
    gaps.add(Some("a.md".into()), GapReason::Link);
    let saved = SavedBackup {
        folder: "/b".into(),
        folder_name: "b".into(),
        files: 2,
        bytes: 3,
        durable: true,
        gaps,
        versions_skipped: 1,
        trash_items_not_included: 4,
    };
    let finished = StartAnswer::Finished {
        result: OpResult::Backup(BackupResult::Incomplete(saved)),
    };
    assert_eq!(
        wire(&finished),
        json!({"status": "finished", "result": {"status": "incomplete", "folder": "/b",
            "folderName": "b", "files": 2, "bytes": 3, "durable": true,
            "gaps": {"total": 1, "counts": {"link": 1}, "sample": [{"path": "a.md", "reason": "link"}]},
            "versionsSkipped": 1, "trashItemsNotIncluded": 4}})
    );
    let running = OperationState::Running {
        kind: Kind::Restore,
        phase: Phase::Copying,
        progress: Some(Progress {
            files: 1,
            total_files: Some(2),
            bytes: 3,
            total_bytes: None,
        }),
        cancel_requested: false,
    };
    assert_eq!(
        wire(&running),
        json!({"state": "running", "kind": "restore", "phase": "copying", "cancelRequested": false,
            "progress": {"files": 1, "totalFiles": 2, "bytes": 3, "totalBytes": null}})
    );
    let changed = RestoreResult::BackupChanged {
        problems: Summary::default(),
        leftover: None,
    };
    assert_eq!(
        wire(&changed),
        json!({"status": "backupChanged", "leftover": null,
            "problems": {"total": 0, "counts": {}, "sample": []}})
    );
    let refused = StartAnswer::Refused {
        reason: StartRefusal::Unavailable,
    };
    assert_eq!(
        wire(&refused),
        json!({"status": "refused", "reason": "unavailable"})
    );
    assert_eq!(wire(&OperationState::Unknown), json!({"state": "unknown"}));
    assert_eq!(
        wire(&CancelAnswer { accepted: true }),
        json!({"accepted": true})
    );
}

fn wire<T: serde::Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}

/// Starts once no other test's operation holds the single slot.
fn when_free(start: impl Fn() -> StartAnswer) -> StartAnswer {
    loop {
        match start() {
            StartAnswer::Refused {
                reason: StartRefusal::Busy,
            } => std::thread::sleep(std::time::Duration::from_millis(10)),
            answer => return answer,
        }
    }
}

/// Seam: the path rule on a case-insensitive disk. Catches an alias of the store, Git or a
/// staging name being copied or restored as an ordinary file.
#[test]
fn reserved_names_match_in_any_letter_case() {
    use super::rules::{classify, skip_dir, Class};
    let loc = "0123456789abcdef0123456789abcdef";
    for path in [
        format!(".LeadingLight/trash/{loc}/restore.json"),
        format!(".LeadingLight/history/versions/{loc}/location.json"),
        ".GIT/config".to_string(),
        "notes/.Git/HEAD".to_string(),
        ".LEADINGLIGHT-kept/x.md".to_string(),
        ".Laputa-Cache.json".to_string(),
        "notes/.ds_store".to_string(),
    ] {
        assert_eq!(classify(&path), Class::Excluded, "{path}");
    }
    assert!(skip_dir(".LeadingLight"));
    let canonical = format!(".leadinglight/history/versions/{loc}/location.json");
    assert_eq!(classify(&canonical), Class::Version);
    assert_eq!(classify("notes/LeadingLight notes.md"), Class::User);
}

/// Seam: cancel against the completion point. Catches a cancel slipping in while the final step
/// runs, a failed final step counted as complete, or the step running after a cancel won.
#[test]
fn a_cancel_waits_for_a_running_completion_and_never_undoes_it() {
    use std::sync::{mpsc, Arc};
    let done = || OpResult::Restore(RestoreResult::NameTaken);
    let op = Arc::new(Op::new(Kind::Restore));
    let (entered, inside) = mpsc::channel();
    let (release, released) = mpsc::channel::<()>();
    let worker = Arc::clone(&op);
    let completing = std::thread::spawn(move || {
        worker.complete(|| {
            entered.send(()).unwrap();
            released.recv().unwrap();
            Ok::<_, ()>(done())
        })
    });
    inside.recv().unwrap();
    let canceller = Arc::clone(&op);
    let cancelling = std::thread::spawn(move || canceller.request_cancel());
    std::thread::sleep(std::time::Duration::from_millis(50));
    assert!(
        !cancelling.is_finished(),
        "cancel waits while the final step runs"
    );
    release.send(()).unwrap();
    assert_eq!(completing.join().unwrap(), Some(Ok(done())));
    assert!(!cancelling.join().unwrap());

    let failing = Op::new(Kind::Restore);
    assert_eq!(failing.complete(|| Err::<OpResult, _>(())), Some(Err(())));
    assert!(
        failing.request_cancel(),
        "a failed final step commits nothing"
    );

    let first = Op::new(Kind::Backup);
    assert!(first.request_cancel());
    let ran = first.complete(|| -> Result<OpResult, ()> { panic!("must not run") });
    assert!(ran.is_none());
}

/// Seam: an unexpected stop after completion. Catches a completed backup or restore later being
/// reported as an unfinished failure.
#[test]
fn an_unwind_after_completion_still_reports_the_completed_result() {
    let id = uuid::Uuid::new_v4().to_string();
    let restored = OpResult::Restore(RestoreResult::Restored {
        folder: "/restored".into(),
        folder_name: "restored".into(),
        files: 1,
        bytes: 2,
        durable: true,
        times_kept: true,
    });
    let expected = restored.clone();
    let answer = when_free(|| {
        let restored = restored.clone();
        super::registry::start(
            &id,
            Kind::Restore,
            &["x"],
            || Ok(()),
            move |op, ()| {
                let _ = op.complete(|| Ok::<_, ()>(restored));
                panic!("an unwind after the completion point");
            },
        )
    });
    assert_eq!(answer, StartAnswer::Started);
    loop {
        if let OperationState::Finished { result, .. } = state(&id) {
            assert_eq!(result, expected);
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

/// Seam: backup reads history without touching it. Catches a backup creating a lock file,
/// rewriting a custom exclusion or repairing any store metadata in the source workspace.
#[test]
fn a_backup_leaves_the_source_history_store_byte_for_byte_unchanged() {
    let ws = workspace();
    let store = ws.path().join(".leadinglight");
    fs::write(store.join("history/.gitignore"), b"custom\n").unwrap();
    fs::remove_file(store.join("history.lock")).unwrap();
    let before = files(&store);
    let dest = TempDir::new().unwrap();
    let saved = saved(run_backup(ws.path(), dest.path()));
    assert_eq!((saved.gaps.total, saved.versions_skipped), (0, 0));
    assert_eq!(files(&store), before);
    assert!(!store.join("history.lock").exists());
    let copied = files(&PathBuf::from(&saved.folder).join("workspace"));
    assert_eq!(
        copied
            .keys()
            .filter(|path| path.starts_with(".leadinglight/history/versions/"))
            .count(),
        3
    );
}

/// Seam: an unreadable history store. Catches a backup claiming completeness when its saved
/// versions could not be read at all.
#[test]
fn an_unreadable_history_store_is_a_disclosed_gap_not_an_empty_one() {
    use std::os::unix::fs::PermissionsExt;
    let ws = workspace();
    let versions = ws.path().join(".leadinglight/history/versions");
    let set = |mode| fs::set_permissions(&versions, fs::Permissions::from_mode(mode)).unwrap();
    set(0o000);
    let dest = TempDir::new().unwrap();
    let result = run_backup(ws.path(), dest.path());
    set(0o755);
    let BackupResult::Incomplete(saved) = result else {
        panic!("{result:?}");
    };
    assert_eq!(saved.gaps.counts.get(&GapReason::Unreadable), Some(&1));
    assert_eq!(
        saved.gaps.sample[0].path.as_deref(),
        Some(".leadinglight/history/versions")
    );
}

/// Seam: one budget across files and history. Catches saved versions being enumerated past
/// the limit the file walk left, and any write before that refusal.
#[test]
fn history_shares_the_entry_budget_and_overflow_is_refused_before_writing() {
    let ws = TempDir::new().unwrap();
    save_version(
        ws.path(),
        "notes/draft.md",
        "first words\n",
        "second words\n",
    );
    let dest = TempDir::new().unwrap();
    // The walk sees notes/, notes/draft.md and .leadinglight/; history needs at least two more.
    ENTRY_CAP.with(|cap| cap.set(4));
    let result = run_backup(ws.path(), dest.path());
    ENTRY_CAP.with(|cap| cap.set(super::rules::MAX_ENTRIES));
    assert_eq!(
        result,
        BackupResult::Failed {
            reason: BackupFailure::TooLarge,
            path: None,
            leftover: None
        }
    );
    assert_eq!(fs::read_dir(dest.path()).unwrap().count(), 0);
}

/// Seam: cancel during the check pass. Catches a cancel waiting through the full re-read of a
/// large file instead of stopping within one chunk.
#[test]
fn a_cancel_during_the_check_pass_stops_within_one_chunk() {
    use std::cell::Cell;
    use std::rc::Rc;
    use std::sync::Arc;
    let ws = workspace();
    put(ws.path(), "attachments/big.bin", &vec![7u8; 4 << 20]);
    let dest = TempDir::new().unwrap();
    let op = Arc::new(Op::new(Kind::Backup));
    let chunks = Rc::new(Cell::new(0));
    let (cancel, seen) = (Arc::clone(&op), Rc::clone(&chunks));
    fsx::DURING_CHECK.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move |path: &Path| {
            if path.ends_with("attachments/big.bin") {
                seen.set(seen.get() + 1);
                cancel.request_cancel();
            }
        }))
    });
    let job = prepare_backup(roots(ws.path()), &text(dest.path()), Vec::new()).unwrap();
    let result = backup::run(&op, job);
    fsx::DURING_CHECK.with(|hook| *hook.borrow_mut() = None);
    assert_eq!(result, BackupResult::Cancelled { leftover: None });
    assert_eq!(
        chunks.get(),
        1,
        "one 1 MiB chunk of four, then the cancel was seen"
    );
    assert_eq!(fs::read_dir(dest.path()).unwrap().count(), 0);
}

/// A hook that appends one byte to `name` each time it runs, counting runs in `calls`. The cap
/// only keeps a regression from growing the file forever.
fn appender(name: &'static str, calls: std::rc::Rc<std::cell::Cell<u32>>) -> Box<dyn FnMut(&Path)> {
    use std::io::Write;
    Box::new(move |path: &Path| {
        if path.ends_with(name) && calls.get() < 1_000 {
            calls.set(calls.get() + 1);
            let mut file = fs::OpenOptions::new().append(true).open(path).unwrap();
            file.write_all(b"+").unwrap();
        }
    })
}

/// Seam: each read attempt stops at the size it first saw. Catches a source that keeps growing
/// being read toward an end that never comes, instead of becoming a changing gap.
#[test]
fn a_source_that_keeps_growing_becomes_a_gap_after_bounded_reads() {
    use std::cell::Cell;
    use std::rc::Rc;
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    let calls = Rc::new(Cell::new(0));
    let hook = appender("notes/plan.md", Rc::clone(&calls));
    fsx::DURING_READ.with(|slot| *slot.borrow_mut() = Some(hook));
    let result = run_backup(ws.path(), dest.path());
    fsx::DURING_READ.with(|slot| *slot.borrow_mut() = None);
    let BackupResult::Incomplete(saved) = result else {
        panic!("{result:?}");
    };
    assert_eq!(saved.gaps.sample[0].path.as_deref(), Some("notes/plan.md"));
    assert_eq!(saved.gaps.sample[0].reason, GapReason::Changing);
    assert_eq!(
        calls.get(),
        3,
        "one chunk per attempt, then the extra byte is seen"
    );
}

/// Seam: the check pass stops at the expected size. Catches a copy that keeps growing being read
/// toward an end that never comes, instead of failing the check.
#[test]
fn a_copy_that_grows_during_the_check_fails_after_a_bounded_read() {
    use std::cell::Cell;
    use std::rc::Rc;
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    let calls = Rc::new(Cell::new(0));
    let hook = appender("notes/plan.md", Rc::clone(&calls));
    fsx::DURING_CHECK.with(|slot| *slot.borrow_mut() = Some(hook));
    let result = run_backup(ws.path(), dest.path());
    fsx::DURING_CHECK.with(|slot| *slot.borrow_mut() = None);
    assert_eq!(
        result,
        BackupResult::Failed {
            reason: BackupFailure::CheckFailed,
            path: Some("notes/plan.md".into()),
            leftover: None
        }
    );
    assert_eq!(calls.get(), 1, "one chunk, then the extra byte is seen");
    assert_eq!(fs::read_dir(dest.path()).unwrap().count(), 0);
}

/// A backed-up workspace, its inspected manifest hash, and one copied byte flipped so a restore
/// fails partway and has to clean up.
fn failing_restore_source() -> (TempDir, TempDir, PathBuf, String) {
    let ws = workspace();
    let dest = TempDir::new().unwrap();
    let backup = PathBuf::from(saved(run_backup(ws.path(), dest.path())).folder);
    let sha = sha_of(&backup);
    let page = backup.join("workspace/notes/plan.md");
    let mut bytes = fs::read(&page).unwrap();
    bytes[4] ^= 1;
    fs::write(&page, &bytes).unwrap();
    (ws, dest, backup, sha)
}

fn restore_leftover(backup: &Path, sha: &str, parent: &Path, name: &str) -> PathBuf {
    let result = run_restore(backup, sha, parent, name);
    fsx::BEFORE_ROOT_REMOVE.with(|hook| *hook.borrow_mut() = None);
    let RestoreResult::BackupChanged {
        leftover: Some(left),
        ..
    } = result
    else {
        panic!("{result:?}");
    };
    PathBuf::from(left)
}

/// Seam: the last step of cleanup. Catches a restore folder that could not be removed being
/// left without its unfinished marker, or a marker written into a folder that is not ours.
#[test]
fn a_restore_folder_that_cannot_be_removed_is_marked_unfinished_again() {
    use std::os::unix::fs::PermissionsExt;
    let (_ws, _dest, backup, sha) = failing_restore_source();
    let marker = |dir: &Path| fs::read(dir.join(RESTORE_MARKER)).unwrap();
    let expected = format!("{{\"manifestSha256\":\"{sha}\"}}\n").into_bytes();

    // The parent stops allowing removal just as cleanup reaches the folder itself.
    let parent = TempDir::new().unwrap();
    let locked = parent.path().to_path_buf();
    fsx::BEFORE_ROOT_REMOVE.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move |_: &Path| {
            fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
        }))
    });
    let left = restore_leftover(&backup, &sha, parent.path(), "Stuck");
    fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        files(&left).into_keys().collect::<Vec<_>>(),
        [RESTORE_MARKER]
    );
    assert_eq!(marker(&left), expected);

    // A stranger's file arrives at the same moment: it stays, and so does the marker.
    let parent = TempDir::new().unwrap();
    fsx::BEFORE_ROOT_REMOVE.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|root: &Path| {
            fs::write(root.join("late.md"), b"late").unwrap();
        }))
    });
    let left = restore_leftover(&backup, &sha, parent.path(), "Late");
    assert_eq!(
        files(&left).into_keys().collect::<Vec<_>>(),
        [RESTORE_MARKER, "late.md"]
    );
    assert_eq!(fs::read(left.join("late.md")).unwrap(), b"late");
    assert_eq!(marker(&left), expected);

    // The folder is swapped for a foreign one: nothing is written into it.
    let parent = TempDir::new().unwrap();
    fsx::BEFORE_ROOT_REMOVE.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|root: &Path| {
            fs::rename(root, root.with_file_name("Swapped-ours")).unwrap();
            fs::create_dir(root).unwrap();
            fs::write(root.join("theirs.md"), b"theirs").unwrap();
        }))
    });
    let left = restore_leftover(&backup, &sha, parent.path(), "Swapped");
    assert_eq!(
        files(&left),
        BTreeMap::from([("theirs.md".to_string(), b"theirs".to_vec())])
    );
}

/// Seam: proving the folder holds only the marker. Catches an unreadable entry being taken as
/// absent, so the marker is removed from a folder that may still hold something.
#[test]
fn an_unreadable_entry_keeps_the_unfinished_marker() {
    let (_ws, _dest, backup, sha) = failing_restore_source();
    let parent = TempDir::new().unwrap();
    fsx::ENTRY_ERROR.with(|error| error.set(true));
    let left = restore_leftover(&backup, &sha, parent.path(), "Unproven");
    fsx::ENTRY_ERROR.with(|error| error.set(false));
    assert_eq!(
        files(&left).into_keys().collect::<Vec<_>>(),
        [RESTORE_MARKER]
    );
}
