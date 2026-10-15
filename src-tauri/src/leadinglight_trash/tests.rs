use super::restore::{inject, Fault};
use super::FailureCode::*;
use super::*;
use std::collections::HashMap;
use std::time::Duration;
use tempfile::TempDir;

const LOCK_HOLDER_ENV: &str = "LEADINGLIGHT_TRASH_LOCK_HOLDER";
const LOCK_HOLDER_READY: &str = "leadinglight-trash-lock-held";

fn write(root: &Path, relative: &str, bytes: &[u8]) -> PathBuf {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
    path
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn trash_one(root: &Path, path: &Path) -> String {
    let report = move_to_trash(root, &[text(path)]).unwrap();
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    report.moved[0].id.clone()
}

fn restore_ids(root: &Path, ids: &[&str]) -> LocalTrashRestoreReport {
    let ids = ids.iter().map(|id| id.to_string()).collect::<Vec<_>>();
    restore_from_trash(root, &ids).unwrap()
}

fn listed(root: &Path) -> Vec<LocalTrashItem> {
    list_trash(root).unwrap()
}

fn item_dir(root: &Path, id: &str) -> PathBuf {
    root.join(".leadinglight/trash").join(id)
}

fn record(original_path: &str, source_identity: Option<[u64; 2]>) -> TrashRecord {
    TrashRecord {
        version: RECORD_VERSION,
        original_path: original_path.to_string(),
        title: "Title".to_string(),
        deleted_at: 1,
        source_identity,
    }
}

fn set_modified(path: &Path) -> SystemTime {
    let modified = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(modified)
        .unwrap();
    modified
}

fn modified(path: &Path) -> SystemTime {
    fs::metadata(path).unwrap().modified().unwrap()
}

fn git(root: &Path, args: &[&str]) -> String {
    let output = crate::hidden_command("git")
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn git_sees_store(root: &Path) -> bool {
    git(root, &["status", "--porcelain", "--untracked-files=all"]).contains(".leadinglight")
}

#[test]
fn batch_round_trip_keeps_bytes_time_and_folder() {
    let vault = TempDir::new().unwrap();
    let markdown = "---\nstatus: draft\n---\n# Plän ✨\n\n![a](./img/a.png)\n".as_bytes();
    let binary = (0..=255).collect::<Vec<u8>>();
    let pages = [
        write(vault.path(), "Projects/plan.md", markdown),
        write(vault.path(), "Projects/empty.md", b""),
        write(vault.path(), "photo.png", &binary),
    ];
    let time = set_modified(&pages[0]);
    let inputs = pages.iter().map(|page| text(page)).collect::<Vec<_>>();

    let moved = move_to_trash(vault.path(), &inputs).unwrap().moved;
    assert_eq!(moved.len(), 3);
    assert!(pages.iter().all(|page| !page.exists()));
    let items = listed(vault.path());
    let plan = items.iter().find(|item| item.id == moved[0].id).unwrap();
    assert_eq!(plan.state, ItemState::Ready);
    assert_eq!(plan.original_path.as_deref(), Some("Projects/plan.md"));
    assert!(plan.title.as_deref().unwrap().starts_with("Plän"));
    assert_eq!(plan.file_kind, "markdown");
    assert_eq!(plan.restored_path, None);

    let ids = moved
        .iter()
        .map(|item| item.id.as_str())
        .collect::<Vec<_>>();
    let report = restore_ids(vault.path(), &ids);
    assert_eq!(report.restored.len(), 3);
    assert!(report
        .restored
        .iter()
        .all(|item| !item.renamed && !item.relocated && !item.cleanup_pending));
    assert!(report.restored.iter().all(|item| item.entry.is_some()));
    assert_eq!(fs::read(&pages[0]).unwrap(), markdown);
    assert_eq!(fs::read(&pages[1]).unwrap(), b"");
    assert_eq!(fs::read(&pages[2]).unwrap(), binary);
    assert_eq!(modified(&pages[0]), time);
    assert!(listed(vault.path()).is_empty());
}

#[test]
fn trashed_pages_leave_scan_search_and_git() {
    let vault = TempDir::new().unwrap();
    git(vault.path(), &["init", "-q"]);
    let page = write(vault.path(), "gone.md", b"# Gone\nzebraquartz\n");
    write(vault.path(), "kept.md", b"# Kept\n");
    trash_one(vault.path(), &page);

    let entries = crate::vault::scan_vault(vault.path(), &HashMap::new()).unwrap();
    let names = entries
        .iter()
        .map(|entry| entry.filename.as_str())
        .collect::<Vec<_>>();
    assert_eq!(names, ["kept.md"]);
    let search = crate::search::search_vault_with_options(crate::search::SearchOptions {
        vault_path: text(vault.path()),
        query: "zebraquartz".to_string(),
        mode: "keyword".to_string(),
        limit: 10,
        hide_gitignored_files: false,
        exclude_frontmatter: false,
    })
    .unwrap();
    assert!(search.results.is_empty());
    assert!(!git_sees_store(vault.path()));
}

#[test]
fn existing_git_rules_are_kept_and_made_effective() {
    let cases = [
        "",
        "# mine\n!trash/\n",
        "keep-me\n*\r\n",
        "*\n!trash/",
        "custom\n*  \n",
    ];
    for existing in cases {
        let vault = TempDir::new().unwrap();
        git(vault.path(), &["init", "-q"]);
        let rules_path = write(
            vault.path(),
            ".leadinglight/.gitignore",
            existing.as_bytes(),
        );
        let page = write(vault.path(), "page.md", b"page");
        trash_one(vault.path(), &page);

        let rules = fs::read(&rules_path).unwrap();
        assert!(rules.starts_with(existing.as_bytes()), "{existing:?}");
        assert!(store::ignores_whole_store(&rules), "{existing:?}");
        if store::ignores_whole_store(existing.as_bytes()) {
            assert_eq!(rules, existing.as_bytes());
        }
        assert!(!git_sees_store(vault.path()), "{existing:?}");
    }
}

#[cfg(unix)]
#[test]
fn unusable_git_exclusion_refuses_the_move_and_keeps_the_page() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    for case in ["folder", "symlink", "unreadable", "unwritable"] {
        let vault = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let page = write(vault.path(), "page.md", b"page");
        let base = vault.path().join(".leadinglight");
        fs::create_dir_all(base.join("trash")).unwrap();
        fs::write(base.join("trash.lock"), b"").unwrap();
        let rules = base.join(".gitignore");
        let privileged = match case {
            "folder" => {
                fs::create_dir(&rules).unwrap();
                false
            }
            "symlink" => {
                let target = write(outside.path(), "rules", b"!*\n");
                symlink(target, &rules).unwrap();
                false
            }
            "unreadable" => {
                fs::write(&rules, b"mine\n").unwrap();
                fs::set_permissions(&rules, fs::Permissions::from_mode(0o000)).unwrap();
                fs::read(&rules).is_ok()
            }
            _ => {
                fs::set_permissions(&base, fs::Permissions::from_mode(0o555)).unwrap();
                tempfile::NamedTempFile::new_in(&base).is_ok()
            }
        };
        // Permission cases mean nothing to a user who can bypass permissions.
        if !privileged {
            let error = move_to_trash(vault.path(), &[text(&page)]).unwrap_err();
            assert!(
                error.starts_with("Local Trash is unavailable"),
                "{case}: {error}"
            );
            assert_eq!(fs::read(&page).unwrap(), b"page", "{case}");
            assert_eq!(
                fs::read_dir(base.join("trash")).unwrap().count(),
                0,
                "{case}"
            );
            assert_eq!(
                fs::read(outside.path().join("rules")).ok(),
                (case == "symlink").then(|| b"!*\n".to_vec())
            );
        }
        fs::set_permissions(&base, fs::Permissions::from_mode(0o755)).unwrap();
        if case == "unreadable" {
            fs::set_permissions(&rules, fs::Permissions::from_mode(0o644)).unwrap();
        }
    }
}

#[test]
fn restore_takes_a_free_name_beside_newer_entries_in_both_publish_modes() {
    let modes: [&[Fault]; 2] = [&[], &[Fault::NoHardLinks]];
    for faults in modes {
        let vault = TempDir::new().unwrap();
        let page = write(vault.path(), "Notes/plan.md", b"old");
        let time = set_modified(&page);
        let id = trash_one(vault.path(), &page);
        write(vault.path(), "Notes/plan.md", b"new");
        fs::create_dir(vault.path().join("Notes/plan-2.md")).unwrap();

        inject(faults);
        let restored = restore_ids(vault.path(), &[id.as_str()]).restored.remove(0);
        inject(&[]);
        assert_eq!(restored.relative_path, "Notes/plan-3.md");
        assert!(restored.renamed && !restored.relocated && !restored.cleanup_pending);
        assert_eq!(fs::read(&page).unwrap(), b"new");
        let copy = vault.path().join("Notes/plan-3.md");
        assert_eq!(fs::read(&copy).unwrap(), b"old");
        assert_eq!(modified(&copy), time);
        assert!(listed(vault.path()).is_empty());
    }
}

#[test]
fn a_restore_past_its_commit_point_is_never_published_twice() {
    let modes: [&[Fault]; 2] = [
        &[Fault::PayloadUnlink],
        &[Fault::NoHardLinks, Fault::PayloadUnlink],
    ];
    for faults in modes {
        let vault = TempDir::new().unwrap();
        let page = write(vault.path(), "Notes/plan.md", b"plan");
        let time = set_modified(&page);
        let id = trash_one(vault.path(), &page);

        inject(faults);
        let first = restore_ids(vault.path(), &[id.as_str()]).restored.remove(0);
        assert!(first.cleanup_pending && first.entry.is_some());
        for _ in 0..2 {
            let item = listed(vault.path()).remove(0);
            assert_eq!(item.state, ItemState::CleanupPending);
            assert_eq!(item.restored_path.as_deref(), Some("Notes/plan.md"));
            let again = restore_ids(vault.path(), &[id.as_str()]).restored.remove(0);
            assert_eq!(again.relative_path, "Notes/plan.md");
            assert!(again.cleanup_pending && again.entry.is_some());
        }
        inject(&[]);

        assert!(listed(vault.path()).is_empty());
        assert_eq!(fs::read_dir(vault.path().join("Notes")).unwrap().count(), 1);
        assert_eq!(fs::read(&page).unwrap(), b"plan");
        assert_eq!(modified(&page), time);
        assert_eq!(
            restore_ids(vault.path(), &[id.as_str()]).failed[0].code,
            NotFound
        );
    }
}

#[test]
fn restore_stays_in_trash_when_its_folder_cannot_be_used() {
    let vault = TempDir::new().unwrap();
    let page = write(vault.path(), "Projects/plan.md", b"body");
    let id = trash_one(vault.path(), &page);
    fs::remove_dir(vault.path().join("Projects")).unwrap();
    fs::write(vault.path().join("Projects"), b"a file in the way").unwrap();

    let report = restore_ids(vault.path(), &[id.as_str()]);
    assert_eq!(report.failed[0].code, OriginalLocationUnavailable);
    let payload = item_dir(vault.path(), &id).join(PAYLOAD_FILE);
    assert_eq!(fs::read(payload).unwrap(), b"body");
    assert_eq!(listed(vault.path())[0].state, ItemState::Ready);
    assert!(!vault.path().join("plan.md").exists());

    // A folder that is simply gone is recreated in place.
    fs::remove_file(vault.path().join("Projects")).unwrap();
    let report = restore_ids(vault.path(), &[id.as_str()]);
    assert_eq!(report.restored[0].relative_path, "Projects/plan.md");
    assert_eq!(fs::read(&page).unwrap(), b"body");
}

#[cfg(unix)]
#[test]
fn interrupted_move_is_tidied_only_with_proof() {
    let vault = TempDir::new().unwrap();
    let anchor = write(vault.path(), "anchor.md", b"anchor");
    let anchor_id = trash_one(vault.path(), &anchor);
    // Stopped after the record was written, before the rename: the same file is still there.
    let page = write(vault.path(), "page.md", b"still here");
    let stopped = item_dir(vault.path(), &"a".repeat(32));
    fs::create_dir(&stopped).unwrap();
    write_json(
        &stopped,
        RECORD_FILE,
        &record("page.md", identity_of(&page)),
    )
    .unwrap();
    // The file is gone and a newer page took its name: the record stays visible.
    let newer = write(vault.path(), "newer.md", b"newer page");
    let replaced_id = "e".repeat(32);
    let replaced = item_dir(vault.path(), &replaced_id);
    fs::create_dir(&replaced).unwrap();
    write_json(&replaced, RECORD_FILE, &record("newer.md", Some([0, 0]))).unwrap();
    // Stopped right after the item folder was created.
    let empty = item_dir(vault.path(), &"b".repeat(32));
    fs::create_dir(&empty).unwrap();
    fs::write(empty.join(".tmpABCDEF"), b"{").unwrap();

    let items = listed(vault.path());
    let ids = items
        .iter()
        .map(|item| item.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, [anchor_id.as_str(), replaced_id.as_str()]);
    assert_eq!(items[1].state, ItemState::Missing);
    assert!(!stopped.exists() && !empty.exists());
    assert_eq!(fs::read(&page).unwrap(), b"still here");
    assert_eq!(fs::read(&newer).unwrap(), b"newer page");
}

#[cfg(unix)]
#[test]
fn interrupted_restore_is_finished_only_with_proof() {
    let vault = TempDir::new().unwrap();
    let linked = write(vault.path(), "linked.md", b"one");
    let copied = write(vault.path(), "copied.md", b"two");
    let occupied = write(vault.path(), "occupied.md", b"three");
    let linked_id = trash_one(vault.path(), &linked);
    let copied_id = trash_one(vault.path(), &copied);
    let occupied_id = trash_one(vault.path(), &occupied);
    let intent = |target: &str, identity: Option<[u64; 2]>| serde_json::json!({ "version": 1, "target": target, "identity": identity });
    // Stopped after the hard link, before the commit mark.
    let linked_dir = item_dir(vault.path(), &linked_id);
    let payload = linked_dir.join(PAYLOAD_FILE);
    fs::hard_link(&payload, &linked).unwrap();
    write_json(
        &linked_dir,
        INTENT_FILE,
        &intent("linked.md", identity_of(&payload)),
    )
    .unwrap();
    // Stopped after a copy was renamed in, before the commit mark.
    let copied_dir = item_dir(vault.path(), &copied_id);
    write(vault.path(), "copied.md", b"two");
    write_json(
        &copied_dir,
        INTENT_FILE,
        &intent("copied.md", identity_of(&copied)),
    )
    .unwrap();
    // Stopped before publishing; someone else's file holds that name.
    let occupied_dir = item_dir(vault.path(), &occupied_id);
    write(vault.path(), "occupied.md", b"someone else");
    let payload = occupied_dir.join(PAYLOAD_FILE);
    write_json(
        &occupied_dir,
        INTENT_FILE,
        &intent("occupied.md", identity_of(&payload)),
    )
    .unwrap();

    let ids = listed(vault.path())
        .into_iter()
        .map(|item| item.id)
        .collect::<Vec<_>>();
    assert_eq!(ids, [occupied_id.clone()]);
    assert!(!linked_dir.exists() && !copied_dir.exists());
    assert_eq!(fs::read(&linked).unwrap(), b"one");
    assert_eq!(fs::read(&copied).unwrap(), b"two");
    assert_eq!(fs::read(&occupied).unwrap(), b"someone else");
    assert_eq!(fs::read(payload).unwrap(), b"three");
    assert!(!occupied_dir.join(INTENT_FILE).exists());
}

#[cfg(unix)]
#[test]
fn recovery_needs_proof_inside_the_vault_before_removing_a_trash_copy() {
    use std::os::unix::fs::symlink;

    // An intent, then the Trash file vanished and nothing was published: still visible.
    let vault = TempDir::new().unwrap();
    let lost = write(vault.path(), "lost.md", b"lost");
    let lost_id = trash_one(vault.path(), &lost);
    let lost_dir = item_dir(vault.path(), &lost_id);
    let payload = lost_dir.join(PAYLOAD_FILE);
    let intent =
        serde_json::json!({ "version": 1, "target": "lost.md", "identity": identity_of(&payload) });
    write_json(&lost_dir, INTENT_FILE, &intent).unwrap();
    fs::remove_file(payload).unwrap();
    assert_eq!(listed(vault.path())[0].state, ItemState::Missing);
    assert!(lost_dir.join(RECORD_FILE).exists());

    // Published, cleanup failed, then its folder moved out of the vault behind a symlink.
    let outside = TempDir::new().unwrap();
    let page = write(vault.path(), "Projects/plan.md", b"plan");
    let id = trash_one(vault.path(), &page);
    inject(&[Fault::PayloadUnlink]);
    let first = restore_ids(vault.path(), &[id.as_str()]).restored.remove(0);
    inject(&[]);
    assert!(first.cleanup_pending && first.entry.is_some());
    let moved_out = outside.path().join("Projects");
    fs::rename(vault.path().join("Projects"), &moved_out).unwrap();
    symlink(&moved_out, vault.path().join("Projects")).unwrap();

    let item = listed(vault.path())
        .into_iter()
        .find(|item| item.id == id)
        .unwrap();
    assert_eq!(item.state, ItemState::CleanupPending);
    // A retry keeps the copy, publishes nothing new and never reads the outside page.
    let retry = restore_ids(vault.path(), &[id.as_str()]).restored.remove(0);
    assert_eq!(retry.relative_path, "Projects/plan.md");
    assert!(retry.cleanup_pending && retry.entry.is_none());
    let payload = item_dir(vault.path(), &id).join(PAYLOAD_FILE);
    assert_eq!(fs::read(&payload).unwrap(), b"plan");
    assert_eq!(fs::read_dir(&moved_out).unwrap().count(), 1);
    assert_eq!(fs::read(moved_out.join("plan.md")).unwrap(), b"plan");

    // Once the copy is gone the restore finishes, still without reading the outside page.
    fs::remove_file(&payload).unwrap();
    let finished = restore_ids(vault.path(), &[id.as_str()]).restored.remove(0);
    assert!(!finished.cleanup_pending && finished.entry.is_none());
    assert!(!item_dir(vault.path(), &id).exists());
    assert_eq!(fs::read_dir(&moved_out).unwrap().count(), 1);
}

#[test]
fn unreadable_or_unsafe_records_stay_visible_and_restore_to_top_level() {
    let vault = TempDir::new().unwrap();
    let bad_records: [&[u8]; 3] = [
        b"{ not json",
        br#"{"version":1,"originalPath":"../escape.md","title":"t","deletedAt":1}"#,
        br#"{"version":1,"originalPath":".leadinglight/x.md","title":"t","deletedAt":1}"#,
    ];
    for (index, bad_record) in bad_records.into_iter().enumerate() {
        let page = write(vault.path(), &format!("Deep/note-{index}.md"), b"# Note\n");
        let id = trash_one(vault.path(), &page);
        fs::write(item_dir(vault.path(), &id).join(RECORD_FILE), bad_record).unwrap();

        let item = listed(vault.path())
            .into_iter()
            .find(|item| item.id == id)
            .unwrap();
        let expected = format!("recovered-{}.md", &id[..8]);
        assert_eq!(item.state, ItemState::NeedsAttention);
        assert_eq!((item.title, item.original_path), (None, None));
        assert_eq!(item.filename, expected);
        let restored = restore_ids(vault.path(), &[id.as_str()]).restored.remove(0);
        assert_eq!(restored.relative_path, expected);
        assert!(restored.relocated);
        assert_eq!(fs::read(vault.path().join(&expected)).unwrap(), b"# Note\n");
    }
    assert!(!vault.path().parent().unwrap().join("escape.md").exists());
    assert!(!vault.path().join(".leadinglight/x.md").exists());
}

#[test]
fn record_without_its_file_stays_listed_as_missing() {
    let vault = TempDir::new().unwrap();
    let page = write(vault.path(), "lost.md", b"x");
    let id = trash_one(vault.path(), &page);
    fs::remove_file(item_dir(vault.path(), &id).join(PAYLOAD_FILE)).unwrap();

    for _ in 0..2 {
        let items = listed(vault.path());
        assert_eq!(
            (items[0].state, items[0].size_bytes),
            (ItemState::Missing, None)
        );
    }
    let report = restore_ids(vault.path(), &[id.as_str()]);
    assert_eq!(report.failed[0].code, PayloadMissing);
    assert!(item_dir(vault.path(), &id).join(RECORD_FILE).exists());
}

#[test]
fn batch_refuses_unsafe_paths_and_still_moves_the_rest() {
    let vault = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let foreign = write(outside.path(), "foreign.md", b"foreign");
    let good = write(vault.path(), "good.md", b"good");
    write(vault.path(), ".git/config", b"config");
    write(vault.path(), "notes/.hidden.md", b"hidden");
    fs::create_dir(vault.path().join("Folder")).unwrap();
    let inputs = [
        text(&good),
        text(&good),
        text(&foreign),
        "../escape.md".to_string(),
        ".git/config".to_string(),
        "notes/.hidden.md".to_string(),
        text(vault.path()),
        "Folder".to_string(),
        "absent.md".to_string(),
    ];

    let report = move_to_trash(vault.path(), &inputs).unwrap();
    assert_eq!(report.moved.len(), 1);
    let codes = report
        .failed
        .iter()
        .map(|failure| failure.code)
        .collect::<Vec<_>>();
    assert_eq!(
        codes,
        [
            OutsideVault,
            OutsideVault,
            InternalLocation,
            InternalLocation,
            InternalLocation,
            NotAFile,
            NotFound
        ]
    );
    assert_eq!(fs::read(&foreign).unwrap(), b"foreign");
    assert!(vault.path().join(".git/config").exists());
    assert!(vault.path().join("notes/.hidden.md").exists());
}

#[cfg(unix)]
#[test]
fn symlinks_never_lead_pages_out_of_the_vault() {
    use std::os::unix::fs::symlink;

    let vault = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let target = write(outside.path(), "target.md", b"outside");
    symlink(&target, vault.path().join("link.md")).unwrap();
    symlink(outside.path(), vault.path().join("linked")).unwrap();
    let inputs = ["link.md".to_string(), "linked/target.md".to_string()];
    let report = move_to_trash(vault.path(), &inputs).unwrap();
    let codes = report
        .failed
        .iter()
        .map(|failure| failure.code)
        .collect::<Vec<_>>();
    assert_eq!(codes, [Symlink, OutsideVault]);
    assert_eq!(fs::read(&target).unwrap(), b"outside");

    // The original folder now points outside the vault, then into a hidden folder.
    let page = write(vault.path(), "Projects/plan.md", b"plan");
    let id = trash_one(vault.path(), &page);
    fs::create_dir(vault.path().join(".git")).unwrap();
    for destination in [outside.path().to_path_buf(), vault.path().join(".git")] {
        let _ = fs::remove_dir(vault.path().join("Projects"));
        let _ = fs::remove_file(vault.path().join("Projects"));
        symlink(&destination, vault.path().join("Projects")).unwrap();
        let report = restore_ids(vault.path(), &[id.as_str()]);
        assert_eq!(report.failed[0].code, OriginalLocationUnavailable);
        assert!(!destination.join("plan.md").exists());
    }
    assert_eq!(listed(vault.path())[0].state, ItemState::Ready);
}

#[cfg(unix)]
#[test]
fn symlinked_store_lock_or_item_is_never_followed() {
    use std::os::unix::fs::symlink;

    for layout in ["store", "trash", "lock"] {
        let vault = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let page = write(vault.path(), "page.md", b"page");
        let base = vault.path().join(".leadinglight");
        if layout == "store" {
            symlink(outside.path(), &base).unwrap();
        } else {
            fs::create_dir(&base).unwrap();
            let name = if layout == "trash" {
                "trash"
            } else {
                "trash.lock"
            };
            symlink(outside.path().join(name), base.join(name)).unwrap();
        }
        let error = move_to_trash(vault.path(), &[text(&page)]).unwrap_err();
        assert!(
            error.starts_with("Local Trash is unavailable"),
            "{layout}: {error}"
        );
        assert_eq!(fs::read(&page).unwrap(), b"page");
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0, "{layout}");
    }

    // An item folder that is a link is ignored by list and restore.
    let vault = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let anchor = write(vault.path(), "anchor.md", b"anchor");
    let anchor_id = trash_one(vault.path(), &anchor);
    write(outside.path(), PAYLOAD_FILE, b"planted");
    write_json(outside.path(), RECORD_FILE, &record("planted.md", None)).unwrap();
    let planted = "d".repeat(32);
    symlink(outside.path(), item_dir(vault.path(), &planted)).unwrap();
    let ids = listed(vault.path())
        .into_iter()
        .map(|item| item.id)
        .collect::<Vec<_>>();
    assert_eq!(ids, [anchor_id]);
    assert_eq!(
        restore_ids(vault.path(), &[planted.as_str()]).failed[0].code,
        NotFound
    );
    assert!(!vault.path().join("planted.md").exists());
    assert_eq!(
        fs::read(outside.path().join(PAYLOAD_FILE)).unwrap(),
        b"planted"
    );
}

/// Runs only as the child of the cross-process test: holds the lock until it is killed.
#[test]
#[ignore = "helper process for another_process_holding_the_vault_lock_blocks_until_it_exits"]
fn leadinglight_trash_lock_holder_process() {
    let Ok(path) = std::env::var(LOCK_HOLDER_ENV) else {
        return;
    };
    let holder = fs::File::options()
        .read(true)
        .write(true)
        .open(path)
        .unwrap();
    holder.lock().unwrap();
    println!("{LOCK_HOLDER_READY}");
    std::thread::sleep(Duration::from_secs(60));
}

#[cfg(unix)]
#[test]
fn another_process_holding_the_vault_lock_blocks_until_it_exits() {
    use std::io::{BufRead, BufReader};
    use std::os::unix::fs::symlink;
    use std::process::{Command, Stdio};

    let vault = TempDir::new().unwrap();
    let anchor = write(vault.path(), "anchor.md", b"anchor");
    trash_one(vault.path(), &anchor);
    let page = write(vault.path(), "page.md", b"page");
    let stopped = item_dir(vault.path(), &"c".repeat(32));
    fs::create_dir(&stopped).unwrap();
    write_json(
        &stopped,
        RECORD_FILE,
        &record("page.md", identity_of(&page)),
    )
    .unwrap();
    // The other process reaches the same vault through another path.
    let aliases = TempDir::new().unwrap();
    let alias = aliases.path().join("vault");
    symlink(vault.path(), &alias).unwrap();

    let mut holder = Command::new(std::env::current_exe().unwrap())
        .args([
            "leadinglight_trash::tests::leadinglight_trash_lock_holder_process",
            "--exact",
            "--ignored",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(LOCK_HOLDER_ENV, alias.join(".leadinglight/trash.lock"))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut output = BufReader::new(holder.stdout.take().unwrap()).lines();
    let ready = output
        .by_ref()
        .map_while(Result::ok)
        .any(|line| line.contains(LOCK_HOLDER_READY));
    assert!(ready, "the lock holder process did not start");

    let root = vault.path().to_path_buf();
    let lister = std::thread::spawn(move || list_trash(&root));
    std::thread::sleep(Duration::from_millis(300));
    let classified = !stopped.join(RECORD_FILE).exists() || lister.is_finished();
    // Ending the other process is what releases its lock.
    holder.kill().unwrap();
    holder.wait().unwrap();
    assert!(
        !classified,
        "Trash state was inspected while another process held the lock"
    );
    assert_eq!(lister.join().unwrap().unwrap().len(), 1);
    assert!(!stopped.exists());
    drop(output);
}

#[test]
fn each_restore_id_succeeds_or_fails_alone() {
    let vault = TempDir::new().unwrap();
    let page = write(vault.path(), "page.md", b"page");
    let id = trash_one(vault.path(), &page);
    let unknown = "f".repeat(32);

    let report = restore_ids(
        vault.path(),
        &["../../etc", unknown.as_str(), id.as_str(), id.as_str()],
    );
    assert_eq!(report.restored.len(), 1);
    let codes = report
        .failed
        .iter()
        .map(|failure| failure.code)
        .collect::<Vec<_>>();
    assert_eq!(codes, [InvalidId, NotFound]);
    assert_eq!(
        restore_ids(vault.path(), &[id.as_str()]).failed[0].code,
        NotFound
    );
    assert_eq!(fs::read(&page).unwrap(), b"page");
}
