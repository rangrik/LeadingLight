//! The guarded move behind Undo of an extension-created page. Catches a page moved although it
//! no longer holds exactly the bytes that write left, an edit during record preparation slipping
//! past the final check, a record left behind by a refusal, or an unproven move called a refusal.

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::{
    list_trash, move_exact_to_trash, restore_from_trash, ExactTrashOutcome, BEFORE_EXACT_MOVE,
};
use crate::vault::staged_file::sha256;

const LIMIT: u64 = 1024 * 1024;
const CREATED: &[u8] = b"# Commentary on Plan\n\n[Source](Plan.md)\n\n> A passage\n";

fn digest(bytes: &[u8]) -> String {
    sha256(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn vault() -> (TempDir, PathBuf) {
    let dir = TempDir::new().unwrap();
    let page = dir.path().join("Notes").join("Commentary on Plan.md");
    fs::create_dir_all(page.parent().unwrap()).unwrap();
    fs::write(&page, CREATED).unwrap();
    fs::write(dir.path().join("Notes").join("Plan.md"), b"# Plan\n").unwrap();
    (dir, page)
}

fn items(root: &Path) -> usize {
    list_trash(root).unwrap().len()
}

/// What happens to the page between its creation and the guarded move.
type Change = fn(&Path);

fn trash_entries(root: &Path) -> usize {
    fs::read_dir(root.join(".leadinglight/trash"))
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .count()
        })
        .unwrap_or(0)
}

#[test]
fn moves_the_exact_page_and_trash_can_restore_it() {
    let (dir, page) = vault();
    let moved = move_exact_to_trash(
        dir.path(),
        "Notes/Commentary on Plan.md",
        &digest(CREATED),
        LIMIT,
    );
    assert!(matches!(moved, ExactTrashOutcome::Moved), "{moved:?}");
    assert!(!page.exists());
    assert_eq!(
        fs::read(dir.path().join("Notes/Plan.md")).unwrap(),
        b"# Plan\n"
    );
    let listed = list_trash(dir.path()).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        listed[0].original_path.as_deref(),
        Some("Notes/Commentary on Plan.md")
    );
    assert_eq!(listed[0].title.as_deref(), Some("Commentary on Plan"));
    let restored = restore_from_trash(dir.path(), &[listed[0].id.clone()]).unwrap();
    assert!(restored.failed.is_empty(), "{:?}", restored.failed);
    assert_eq!(fs::read(&page).unwrap(), CREATED);
}

#[test]
fn a_page_that_is_not_exactly_the_written_one_stays_and_leaves_no_record() {
    let other = digest(b"something else");
    let cases: [(&str, Change); 5] = [
        ("edited", |page| {
            fs::write(page, b"# Commentary on Plan\n\nMy own words\n").unwrap()
        }),
        ("hard linked", |page| {
            fs::hard_link(page, page.with_extension("link")).unwrap()
        }),
        ("symlinked", |page| {
            let moved = page.with_extension("moved");
            fs::rename(page, &moved).unwrap();
            std::os::unix::fs::symlink(&moved, page).unwrap();
        }),
        ("grown", |page| {
            fs::write(page, vec![b'x'; 2 * 1024 * 1024]).unwrap()
        }),
        ("unchanged, wrong digest", |_| {}),
    ];
    for (case, change) in cases {
        let (dir, page) = vault();
        change(&page);
        let expected = if case == "unchanged, wrong digest" {
            other.clone()
        } else {
            digest(CREATED)
        };
        let outcome =
            move_exact_to_trash(dir.path(), "Notes/Commentary on Plan.md", &expected, LIMIT);
        assert!(
            matches!(outcome, ExactTrashOutcome::Changed),
            "{case}: {outcome:?}"
        );
        assert!(fs::symlink_metadata(&page).is_ok(), "{case}");
        assert_eq!(trash_entries(dir.path()), 0, "{case}");
    }

    let (dir, page) = vault();
    fs::remove_file(&page).unwrap();
    let outcome = move_exact_to_trash(
        dir.path(),
        "Notes/Commentary on Plan.md",
        &digest(CREATED),
        LIMIT,
    );
    assert!(matches!(outcome, ExactTrashOutcome::Missing), "{outcome:?}");
}

/// The page reached through a linked folder is not the page that was written there.
#[test]
fn a_folder_swapped_for_a_link_is_never_followed() {
    let (dir, _) = vault();
    let notes = dir.path().join("Notes");
    let kept = dir.path().join("Kept");
    fs::rename(&notes, &kept).unwrap();
    std::os::unix::fs::symlink(&kept, &notes).unwrap();
    let outcome = move_exact_to_trash(
        dir.path(),
        "Notes/Commentary on Plan.md",
        &digest(CREATED),
        LIMIT,
    );
    assert!(matches!(outcome, ExactTrashOutcome::Changed), "{outcome:?}");
    assert_eq!(
        fs::read(kept.join("Commentary on Plan.md")).unwrap(),
        CREATED
    );
}

/// Astra acceptance 3: an edit while the Trash record is being prepared stops the final move.
#[test]
fn an_edit_during_record_preparation_stops_the_final_move() {
    for edit in ["same size", "replaced by an identical copy"] {
        let (dir, page) = vault();
        BEFORE_EXACT_MOVE.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move |page: &Path| match edit {
                "same size" => {
                    let mut changed = CREATED.to_vec();
                    changed[2] = b'X';
                    fs::write(page, changed).unwrap();
                }
                _ => {
                    let copy = page.with_extension("copy");
                    fs::write(&copy, CREATED).unwrap();
                    fs::rename(&copy, page).unwrap();
                }
            }));
        });
        let outcome = move_exact_to_trash(
            dir.path(),
            "Notes/Commentary on Plan.md",
            &digest(CREATED),
            LIMIT,
        );
        BEFORE_EXACT_MOVE.with(|hook| *hook.borrow_mut() = None);
        assert!(
            matches!(outcome, ExactTrashOutcome::Changed),
            "{edit}: {outcome:?}"
        );
        assert!(page.exists(), "{edit}");
        assert_eq!(trash_entries(dir.path()), 0, "{edit}");
        assert_eq!(items(dir.path()), 0, "{edit}");
    }
}

#[test]
fn a_store_that_cannot_be_used_moves_nothing() {
    let (dir, page) = vault();
    fs::write(dir.path().join(".leadinglight"), b"").unwrap();
    let outcome = move_exact_to_trash(
        dir.path(),
        "Notes/Commentary on Plan.md",
        &digest(CREATED),
        LIMIT,
    );
    assert!(
        matches!(outcome, ExactTrashOutcome::NotMoved(_)),
        "{outcome:?}"
    );
    assert_eq!(fs::read(&page).unwrap(), CREATED);
}
