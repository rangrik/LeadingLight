//! E2 seams: exact earlier text kept for the Undo of a guarded extension write. Catches a kept
//! version that the capture policy skipped, that is not on disk and verified when the pin is
//! given, that any pruning path removes while pinned, or that reads back other than exactly.
//! Synthetic vaults only.

use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::history_outcome::{ListVersionsOutcome, VersionReason, VersionRow};
use super::inventory::{Caps, CAPS, TEST_CAPS};
use super::lock::CopyLock;
use super::outcome::{OriginalRequest, SaveOutcome};
use super::page_write::{save_with, Holds};
use super::retention;
use super::versions::now_ms;
use super::{
    fail_history_syncs, hex, list_versions, page_key, pinned_in, read_retained, retain_version,
    PageTarget, RetainError, SyncFault, VaultRoots, REGISTRY,
};
use crate::vault::staged_file::{sha256, NativePlatform};

const DAY: u64 = 24 * 60 * 60 * 1000;

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
    fn page(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.dir.path().join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    fn key(&self, path: &Path) -> PathBuf {
        page_key(path).unwrap()
    }

    fn save(&self, path: &Path, content: &[u8]) -> SaveOutcome {
        let request = OriginalRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            vault_path: self.dir.path().to_string_lossy().into_owned(),
            session: "window".into(),
            path: path.to_string_lossy().into_owned(),
            seq: 1,
            submitted_sha256: hex(&sha256(content)),
        };
        let target = PageTarget {
            path: path.to_path_buf(),
            key: self.key(path),
        };
        save_with(
            &REGISTRY,
            &NativePlatform,
            &request,
            content,
            Some(&target),
            Holds::Keep,
        )
    }

    fn rows(&self, path: &Path) -> Vec<VersionRow> {
        let target = PageTarget {
            path: path.to_path_buf(),
            key: self.key(path),
        };
        match list_versions(&self.roots, &target, None) {
            ListVersionsOutcome::Ok { versions, .. } => versions,
            other => panic!("{other:?}"),
        }
    }

    fn ids(&self, path: &Path) -> Vec<String> {
        self.rows(path).into_iter().map(|row| row.id).collect()
    }

    fn version_dir(&self, id: &str) -> PathBuf {
        self.roots
            .canonical
            .join(".leadinglight/history/versions")
            .join(id)
    }
}

fn digest(bytes: &[u8]) -> String {
    hex(&sha256(bytes))
}

#[test]
fn exact_text_is_kept_and_verified_whatever_the_policy_would_say() {
    let vault = vault();
    let page = vault.page("Commentary.md", b"");
    // An empty page is never an ordinary version, but it is exact earlier text all the same.
    let empty = retain_version(&vault.roots, &vault.key(&page), b"").unwrap();
    assert_eq!((empty.sha256(), empty.length()), (digest(b"").as_str(), 0));
    assert_eq!(read_retained(&empty).unwrap(), b"");
    let rows = vault.rows(&page);
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (rows[0].id.as_str(), rows[0].length, rows[0].reason),
        (empty.id().as_str(), 0, VersionReason::Checkpoint)
    );

    // A tiny change seconds after a kept version, which the policy skips, is kept here.
    fs::write(&page, b"one").unwrap();
    let one = retain_version(&vault.roots, &vault.key(&page), b"one").unwrap();
    let small = retain_version(&vault.roots, &vault.key(&page), b"one!").unwrap();
    assert_ne!(one.id(), small.id());
    assert_eq!(read_retained(&small).unwrap(), b"one!");
    assert_eq!(vault.rows(&page).len(), 3);

    // The identical version already kept is pinned again instead of written twice.
    let again = retain_version(&vault.roots, &vault.key(&page), b"one").unwrap();
    assert_eq!(again.id(), one.id());
    assert_eq!(vault.rows(&page).len(), 3);
    assert_eq!(pinned_in(&vault.roots.canonical), 4);
    drop((empty, one, small, again));
    assert_eq!(pinned_in(&vault.roots.canonical), 0);
    // Unpinned, they are ordinary versions and stay listed until ordinary retention lets go.
    assert_eq!(vault.rows(&page).len(), 3);
}

#[test]
fn an_ordinary_version_with_the_same_bytes_is_reused_after_verification() {
    let vault = vault();
    let page = vault.page("Commentary.md", b"first text");
    assert!(matches!(
        vault.save(&page, b"second text"),
        SaveOutcome::Committed { written: true, .. }
    ));
    let ordinary = vault.ids(&page);
    assert_eq!(ordinary.len(), 1);
    let kept = retain_version(&vault.roots, &vault.key(&page), b"first text").unwrap();
    assert_eq!(kept.id(), ordinary[0]);
    // Damaged in place: it no longer counts as the same text, so a fresh copy is written.
    let payload = vault.version_dir(&ordinary[0]).join("payload");
    drop(kept);
    fs::write(&payload, b"FIRST TEXT").unwrap();
    let fresh = retain_version(&vault.roots, &vault.key(&page), b"first text").unwrap();
    assert_ne!(fresh.id(), ordinary[0]);
    assert_eq!(read_retained(&fresh).unwrap(), b"first text");
}

/// Capture pruning, the per-location tiers and the budget pass all leave a pinned version, and
/// all of them let it go once the pin is released.
#[test]
fn a_pinned_version_survives_every_pruning_path_until_it_is_released() {
    let vault = vault();
    let page = vault.page("Commentary.md", &[b'a'; 1_000]);
    let pinned = retain_version(&vault.roots, &vault.key(&page), &[b'a'; 1_000]).unwrap();
    TEST_CAPS.set(Some(Caps {
        per_location: 3,
        ..CAPS
    }));
    // Each save replaces everything, so each is a big change the policy keeps; the first one
    // replaces the pinned text itself, which is already kept.
    let mut notes = Vec::new();
    for fill in [b'b', b'c', b'd', b'e', b'f'] {
        match vault.save(&page, &[fill; 1_000]) {
            SaveOutcome::Committed {
                written: true,
                history,
                ..
            } => notes.push(history),
            other => panic!("{other:?}"),
        }
    }
    TEST_CAPS.set(None);
    // Capture made room from the unpinned ones only, and every version that should be kept was.
    assert!(notes.iter().all(Option::is_none), "{notes:?}");
    let ids = vault.ids(&page);
    assert!(ids.contains(&pinned.id()), "{ids:?}");
    assert_eq!(ids.len(), 3, "{ids:?}");

    let squeezed = Caps {
        per_location: 1,
        budget_bytes: 1,
        ..CAPS
    };
    let much_later = now_ms() + 400 * DAY;
    assert!(retention::maintain(&vault.roots.canonical, squeezed, much_later).is_some());
    let ids = vault.ids(&page);
    assert!(ids.contains(&pinned.id()), "{ids:?}");
    assert_eq!(ids.len(), 2, "the pinned one and the newest: {ids:?}");
    assert_eq!(read_retained(&pinned).unwrap(), vec![b'a'; 1_000]);

    let id = pinned.id();
    drop(pinned);
    assert!(retention::maintain(&vault.roots.canonical, squeezed, much_later).is_some());
    let ids = vault.ids(&page);
    assert!(!ids.contains(&id), "{ids:?}");
    assert_eq!(ids.len(), 1);
}

#[test]
fn nothing_is_pinned_when_the_text_cannot_be_kept_exactly() {
    // The store is a file, or its history folder links elsewhere.
    for layout in ["file", "linked"] {
        let vault = vault();
        let page = vault.page("Commentary.md", b"text");
        let store = vault.roots.canonical.join(".leadinglight");
        match layout {
            "file" => fs::write(&store, b"").unwrap(),
            _ => {
                let elsewhere = TempDir::new().unwrap();
                fs::create_dir(&store).unwrap();
                symlink(elsewhere.path(), store.join("history")).unwrap();
            }
        }
        let kept = retain_version(&vault.roots, &vault.key(&page), b"text");
        assert_eq!(kept.err(), Some(RetainError::Unavailable), "{layout}");
        assert_eq!(pinned_in(&vault.roots.canonical), 0, "{layout}");
    }

    // Over the version bound, or no room left that this page's own unpinned versions could free.
    let vault = vault();
    let page = vault.page("Commentary.md", b"text");
    let other = vault.page("Other.md", b"other");
    let held = retain_version(&vault.roots, &vault.key(&other), b"other").unwrap();
    TEST_CAPS.set(Some(Caps {
        version_bytes: 3,
        ..CAPS
    }));
    let large = retain_version(&vault.roots, &vault.key(&page), b"text");
    TEST_CAPS.set(Some(Caps {
        versions: 1,
        ..CAPS
    }));
    let full = retain_version(&vault.roots, &vault.key(&page), b"text");
    TEST_CAPS.set(None);
    assert_eq!(large.err(), Some(RetainError::Full));
    assert_eq!(full.err(), Some(RetainError::Full));
    assert!(vault.rows(&page).is_empty());
    drop(held);

    // The store's lock is taken for longer than a keep waits.
    let busy = vault.page("Busy.md", b"busy");
    let lock = CopyLock::acquire(&vault.roots.canonical).unwrap();
    let waited = retain_version(&vault.roots, &vault.key(&busy), b"busy");
    drop(lock);
    assert_eq!(waited.err(), Some(RetainError::Busy));
    assert_eq!(pinned_in(&vault.roots.canonical), 0);
}

#[test]
fn a_removed_or_damaged_version_never_reads_back_as_the_kept_text() {
    let vault = vault();
    let page = vault.page("Commentary.md", b"kept text");
    let kept = retain_version(&vault.roots, &vault.key(&page), b"kept text").unwrap();
    let dir = vault.version_dir(&kept.id());
    fs::write(dir.join("payload"), b"KEPT TEXT").unwrap();
    assert_eq!(read_retained(&kept).err(), Some(RetainError::Unavailable));
    fs::remove_file(dir.join("payload")).unwrap();
    fs::remove_file(dir.join("version.json")).unwrap();
    fs::remove_dir(&dir).unwrap();
    assert_eq!(read_retained(&kept).err(), Some(RetainError::Unavailable));
}

/// Astra final review: a version whose durability was never confirmed is not a recovery copy.
/// A version renamed into place before its location's sync failed, or written into a location
/// whose parent's sync failed when it was created, is listed but unproven. Found again, it is
/// pinned only once a sync of every entry it depends on succeeds, and never written twice.
#[test]
fn a_version_whose_sync_failed_is_pinned_only_once_a_sync_succeeds() {
    for fault in [SyncFault::Location, SyncFault::Parent] {
        let vault = vault();
        let page = vault.page("Commentary.md", b"first");
        if matches!(fault, SyncFault::Location) {
            // The location and its record exist, so the next version is renamed in first.
            drop(retain_version(&vault.roots, &vault.key(&page), b"first").unwrap());
        }
        fail_history_syncs(Some(fault));
        let attempts: Vec<Option<RetainError>> = (0..2)
            .map(|_| retain_version(&vault.roots, &vault.key(&page), b"second").err())
            .collect();
        fail_history_syncs(None);
        assert_eq!(attempts, [Some(RetainError::Unavailable); 2], "{fault:?}");
        assert_eq!(pinned_in(&vault.roots.canonical), 0, "{fault:?}");
        let second = |rows: Vec<VersionRow>| {
            rows.into_iter()
                .filter(|row| row.sha256 == digest(b"second"))
                .count()
        };
        assert_eq!(second(vault.rows(&page)), 1, "{fault:?}");

        let proven = retain_version(&vault.roots, &vault.key(&page), b"second").unwrap();
        assert_eq!(second(vault.rows(&page)), 1, "{fault:?}");
        assert_eq!(read_retained(&proven).unwrap(), b"second", "{fault:?}");
        assert_eq!(pinned_in(&vault.roots.canonical), 1, "{fault:?}");
    }
}
