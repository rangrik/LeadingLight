//! S1a seams: the keep policy, capture inside the save, the locked store, its integrity, and
//! exact copies. Synthetic vaults only.

use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tempfile::TempDir;

use super::history_outcome::{
    HealthState, HistoryHealth, HistoryNote, ListLocationsOutcome, ListVersionsOutcome,
    NotKeptReason, ReadVersionOutcome, VersionCopyOutcome, VersionCopyRefusal, VersionReason,
    VersionRow,
};
use super::inventory::{Caps, CAPS, TEST_CAPS};
use super::lock::CopyLock;
use super::outcome::{OriginalRequest, SaveOutcome};
use super::page_write::{save_with, Holds, Steps};
use super::policy::{decide, Kept, Seen};
use super::retention::{self, plan, Item};
use super::versions::{location_key, read_verified, Fault, FAULT};
use super::{
    copy_version, hex, history_health, list_locations, list_versions, page_key, read_version,
    PageTarget, VaultRoots, REGISTRY,
};
use crate::vault::atomic_replace::PublishError;
use crate::vault::staged_file::{sha256, NativePlatform, Platform};

const LOCK_HOLDER_ENV: &str = "LEADINGLIGHT_HISTORY_LOCK_HOLDER";
const LOCK_HOLDER_READY: &str = "leadinglight-history-lock-held";
const MINUTE: u64 = 60_000;
const HOUR: u64 = 60 * MINUTE;
const DAY: u64 = 24 * HOUR;

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

/// A page save with a step after staging and a choice of whether folder syncs succeed.
struct Disk<'a> {
    after_stage: &'a (dyn Fn(&Path) + Sync),
    synced: bool,
}

impl Platform for Disk<'_> {
    fn publish(&self, original: &Path, staged: &Path) -> Result<PathBuf, PublishError> {
        NativePlatform.publish(original, staged)
    }

    fn sync_dir(&self, _dir: &Path) -> std::io::Result<()> {
        self.synced
            .then_some(())
            .ok_or(std::io::ErrorKind::Other.into())
    }
}

impl Steps for Disk<'_> {
    fn after_stage(&self, path: &Path) {
        (self.after_stage)(path)
    }
}

fn nothing(_: &Path) {}

const PLAIN: Disk<'static> = Disk {
    after_stage: &nothing,
    synced: true,
};

impl Vault {
    fn path(&self, name: &str) -> PathBuf {
        self.dir.path().join(name)
    }

    fn page(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.path(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        path
    }

    fn history(&self) -> PathBuf {
        self.roots.canonical.join(".leadinglight/history")
    }

    fn save_on(&self, disk: &impl Steps, path: &Path, content: &[u8]) -> SaveOutcome {
        let request = OriginalRequest {
            request_id: uuid(),
            vault_path: self.dir.path().to_string_lossy().into_owned(),
            session: "window".into(),
            path: path.to_string_lossy().into_owned(),
            seq: 1,
            submitted_sha256: hex(&sha256(content)),
        };
        let target = target(path);
        save_with(
            &REGISTRY,
            disk,
            &request,
            content,
            Some(&target),
            Holds::Keep,
        )
    }

    fn save(&self, path: &Path, content: &[u8]) -> SaveOutcome {
        self.save_on(&PLAIN, path, content)
    }

    fn rows(&self, page: &Path) -> Vec<VersionRow> {
        match list_versions(&self.roots, &target(page), None) {
            ListVersionsOutcome::Ok { versions, .. } => versions,
            other => panic!("{other:?}"),
        }
    }

    fn bytes(&self, row: &VersionRow) -> Vec<u8> {
        read_verified(&self.history(), &row.id, &row.sha256)
            .unwrap()
            .0
    }

    fn health(&self) -> HistoryHealth {
        history_health(&self.roots)
    }

    fn payload(&self, row: &VersionRow) -> PathBuf {
        self.history()
            .join("versions")
            .join(&row.id)
            .join("payload")
    }
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn target(path: &Path) -> PageTarget {
    PageTarget {
        path: path.to_path_buf(),
        key: page_key(path).unwrap(),
    }
}

fn committed(durable: bool) -> SaveOutcome {
    SaveOutcome::Committed {
        written: true,
        durable,
        history: None,
    }
}

fn noted(durable: bool, reason: NotKeptReason) -> SaveOutcome {
    SaveOutcome::Committed {
        written: true,
        durable,
        history: Some(HistoryNote::NotKept { reason }),
    }
}

fn not_keeping(health: &HistoryHealth) -> Option<NotKeptReason> {
    (health.state == HealthState::NotKeeping)
        .then_some(health.reason)
        .flatten()
}

fn wire(value: impl serde::Serialize) -> Value {
    serde_json::to_value(value).unwrap()
}

/// Seam: the keep policy. Catches lost first-minute text, a version for every autosave, and
/// identical bytes kept twice.
#[test]
fn policy_keeps_first_text_big_removals_and_checkpoints_only() {
    use VersionReason::*;
    let now = 10 * DAY;
    let sha = |bytes: &[u8]| hex(&sha256(bytes));
    let long: Vec<u8> = (0..3000).map(|i| b'a' + (i % 26) as u8).collect();
    let (shorter, shortest) = (&long[..900], &long[..500]);
    let fresh = Seen::default();
    let wrote = |bytes: &[u8]| Seen {
        this_run: true,
        last_written: Some(sha(bytes)),
    };
    let hashes: Vec<String> = [&b"hello"[..], &b"other"[..], &long[..], shorter]
        .iter()
        .map(|bytes| sha(bytes))
        .collect();
    let at = |age: u64, bytes: &[u8], index: usize| Kept {
        captured_at: now - age,
        length: bytes.len() as u64,
        sha256: &hashes[index],
    };
    type Case<'a> = (
        &'a [u8],
        &'a [u8],
        Vec<Kept<'a>>,
        &'a Seen,
        Option<VersionReason>,
    );
    let other = || vec![at(5_000, b"other", 1)];
    let cases: [Case<'_>; 11] = [
        (b"", b"new", vec![], &fresh, None),
        (b"hello", b"hello", vec![], &fresh, None),
        (b"hello", b"world", vec![], &fresh, Some(FirstSave)),
        (b"hello", b"world", vec![at(10, b"hello", 0)], &fresh, None),
        (b"hello", b"hello!", other(), &fresh, Some(SessionStart)),
        (
            b"hello",
            b"hello!",
            other(),
            &wrote(b"mine"),
            Some(ChangedElsewhere),
        ),
        // Clearing a five-byte page in its first minute.
        (b"hello", b"", other(), &wrote(b"hello"), Some(BigChange)),
        (b"hello", b"hello!", other(), &wrote(b"hello"), None),
        (
            b"hello",
            b"hello!",
            vec![at(MINUTE, b"other", 1)],
            &wrote(b"hello"),
            Some(Checkpoint),
        ),
        // Two big deletions a second apart are both kept.
        (
            shorter,
            shortest,
            vec![at(1_000, &long, 2)],
            &wrote(shorter),
            Some(BigChange),
        ),
        (
            b"hello",
            b"hey",
            vec![at(HOUR, b"hello", 0), at(10, b"other", 1)],
            &wrote(b"hello"),
            None,
        ),
    ];
    for (case, (p, n, kept, seen, expected)) in cases.iter().enumerate() {
        assert_eq!(
            decide(p, &sha(p), n, now, kept, seen),
            *expected,
            "case {case}"
        );
    }
}

/// Seam: the retention planner. Catches the newest version or a bucket's big change being
/// dropped, and growth past the tiers or the cap.
#[test]
fn retention_keeps_the_newest_and_each_buckets_big_change() {
    let now = 1_000 * DAY;
    let bucket = (now / HOUR - 5) * HOUR;
    let names: Vec<String> = (0..40).map(|i| format!("v{i:02}")).collect();
    let item = |index: usize, captured_at: u64, big: bool| Item {
        name: &names[index],
        captured_at,
        big,
        listable: true,
    };
    let mut items = vec![
        item(0, now - 200 * DAY, false),
        item(1, bucket + 10 * MINUTE, false),
        item(2, bucket + 20 * MINUTE, true),
        item(3, bucket + 30 * MINUTE, false),
    ];
    items.extend((1..=35).map(|minutes| item(3 + minutes, now - minutes as u64 * MINUTE, false)));
    // 30 recent stay, the newest (v04) among them; v02 is its hour's big change.
    let removed = plan(&items, now, 200);
    assert_eq!(removed, ["v00", "v01", "v38", "v37", "v36", "v35", "v34"]);
    let capped = plan(&items, now, 3);
    assert_eq!(items.len() - capped.len(), 3);
    assert!(!capped.contains(&"v04"), "the newest always stays");
}

/// Seam: capture inside the ordinary save. Catches a version missing or inexact before the new
/// bytes publish, a version for every small edit, a missed outside change, and a capture on an
/// early refusal or a no-op.
#[test]
fn a_save_keeps_the_text_it_replaces_before_publishing() {
    let vault = vault();
    let page = vault.page("notes/plan.md", b"first line\n");
    assert_eq!(vault.save(&page, b"rewritten\n"), committed(true));
    let rows = vault.rows(&page);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].reason, VersionReason::FirstSave);
    assert_eq!(rows[0].recorded_path, "notes/plan.md");
    assert_eq!(vault.bytes(&rows[0]), b"first line\n");
    let ListLocationsOutcome::Ok { locations, .. } = list_locations(&vault.roots, None) else {
        panic!("no locations");
    };
    assert_eq!(locations[0].path, "notes/plan.md");
    assert!(locations[0].exists);

    vault.save(&page, b"rewritten!\n");
    assert_eq!(vault.rows(&page).len(), 1, "a small edit within a minute");
    fs::write(&page, b"edited elsewhere\n").unwrap();
    vault.save(&page, b"mine\n");
    let rows = vault.rows(&page);
    assert_eq!(rows[0].reason, VersionReason::ChangedElsewhere);
    assert_eq!(vault.bytes(&rows[0]), b"edited elsewhere\n");

    let small = vault.page("small.md", b"hello");
    vault.save(&small, b"");
    assert_eq!(vault.bytes(&vault.rows(&small)[0]), b"hello");
    let long: Vec<u8> = (0..3000).map(|i| b'a' + (i % 26) as u8).collect();
    let big = vault.page("big.md", &long);
    vault.save(&big, &long[..900]);
    vault.save(&big, &long[..500]);
    let reasons: Vec<_> = vault.rows(&big).iter().map(|row| row.reason).collect();
    assert_eq!(
        reasons,
        [VersionReason::BigChange, VersionReason::FirstSave]
    );

    let quiet = self::vault();
    let same = quiet.page("same.md", b"same");
    quiet.save(&same, b"same");
    quiet.save(&quiet.path("gone.md"), b"x");
    assert!(!quiet.path(".leadinglight").exists());
}

/// Seam: history work must never change the save. Catches a history panic, a full disk on the
/// history write or a failed history sync turning into a page error, a hold or a lost save.
#[test]
fn history_failures_never_change_the_save() {
    use NotKeptReason::{LowSpace, Unavailable};
    let cases = [
        (Some(Fault::Panic), true, Unavailable),
        (Some(Fault::StorageFull), true, LowSpace),
        (None, false, Unavailable),
    ];
    for (fault, synced, reason) in cases {
        let vault = vault();
        let page = vault.page("a.md", b"keep me");
        FAULT.set(fault);
        let disk = Disk {
            after_stage: &nothing,
            synced,
        };
        let outcome = vault.save_on(&disk, &page, b"new");
        FAULT.set(None);
        // What S0 answers without capture, plus the note: an unsynced folder is only "not durable".
        assert_eq!(outcome, noted(synced, reason), "{reason:?}");
        assert_eq!(fs::read(&page).unwrap(), b"new");
        assert!(vault.rows(&page).is_empty());
        assert_eq!(not_keeping(&vault.health()), Some(reason));
        let leftovers = fs::read_dir(vault.history().join("tmp")).map_or(0, Iterator::count);
        assert_eq!(leftovers, 0, "{reason:?}");
    }
}

/// Seam: health after a skipped capture. Catches a policy skip clearing a remembered failure
/// that no later kept version has disproved.
#[test]
fn a_skipped_capture_keeps_the_last_failure() {
    let vault = vault();
    let page = vault.page("a.md", b"one");
    assert_eq!(vault.save(&page, b"two"), committed(true));
    FAULT.set(Some(Fault::StorageFull));
    let outcome = vault.save(&page, b"three");
    FAULT.set(None);
    assert_eq!(outcome, noted(true, NotKeptReason::LowSpace));
    // A small edit within a minute keeps nothing, so it proves nothing about the store.
    assert_eq!(vault.save(&page, b"three!"), committed(true));
    assert_eq!(not_keeping(&vault.health()), Some(NotKeptReason::LowSpace));
    assert_eq!(vault.save(&page, b"x"), committed(true));
    assert_eq!(vault.health().state, HealthState::On);
}

/// Seam: maintenance accounting after tmp cleanup. Catches pruning kept versions against bytes
/// that cleanup already freed, and an uncleanable leftover no longer counting.
#[test]
fn cleaned_leftovers_free_room_before_any_version_is_pruned() {
    let caps = Caps {
        budget_bytes: 20_000,
        ..CAPS
    };
    for cleanable in [true, false] {
        let vault = vault();
        let page = vault.page("a.md", &[b'a'; 4_000]);
        for fill in [b'b', b'c', b'd'] {
            assert_eq!(vault.save(&page, &[fill; 4_000]), committed(true));
        }
        let leftover = vault.history().join(format!("tmp/{:032x}.tmpv", 7));
        fs::create_dir(&leftover).unwrap();
        let name = if cleanable { "payload" } else { "notes.txt" };
        fs::write(leftover.join(name), [b'x'; 7_000]).unwrap();
        // The leftover is old; the versions are still in the recent tier.
        let later = super::versions::now_ms() + 90 * MINUTE;
        assert!(retention::maintain(&vault.roots.canonical, caps, later).is_some());
        assert_eq!(leftover.exists(), !cleanable);
        let kept = if cleanable { 3 } else { 2 };
        assert_eq!(vault.rows(&page).len(), kept, "cleanable {cleanable}");
    }
}

/// Seam: maintenance accounting after a partial removal. Catches bytes a parked version already
/// freed being paid for again with kept versions, in the tier pass or the budget pass.
#[test]
fn partly_removed_versions_are_recounted_before_more_are_pruned() {
    let caps = Caps {
        budget_bytes: 20_000,
        ..CAPS
    };
    for expired in [true, false] {
        let vault = vault();
        let page = vault.page("a.md", &[b'a'; 1_000]);
        for fill in [b'b', b'c', b'd'] {
            assert_eq!(vault.save(&page, &[fill; 1_000]), committed(true));
        }
        let now = super::versions::now_ms();
        // Malformed, so only its known files go: past every tier, or merely the oldest.
        let age = if expired { 400 * DAY } else { 30 * MINUTE };
        let entry = record(&vault, now - age, "a.md", "bad");
        fs::write(entry.join("payload"), [b'x'; 16_000]).unwrap();
        fs::write(entry.join("notes.txt"), b"keep").unwrap();
        let freed = 16_000 + fs::metadata(entry.join("version.json")).unwrap().len();
        let used = vault.health().used_bytes.unwrap();
        assert!(retention::maintain(&vault.roots.canonical, caps, now).is_some());
        assert_eq!(vault.rows(&page).len(), 3, "expired {expired}");
        assert_eq!(vault.health().used_bytes, Some(used - freed));
        let parked = vault.history().join("tmp").join(format!(
            "del-{}-{}",
            location_key("a.md"),
            entry.file_name().unwrap().to_string_lossy()
        ));
        assert_eq!(fs::read(parked.join("notes.txt")).unwrap(), b"keep");
    }
}

/// Seam: who owns a `tmp/` or version folder, and when. Catches deleting a lookalike or link
/// the writer never made, removing a fresh leftover, and losing count of a partial cleanup.
#[test]
fn only_old_writer_leftovers_are_removed() {
    let vault = vault();
    let page = vault.page("a.md", b"one");
    assert_eq!(vault.save(&page, b"two"), committed(true));
    let tmp = vault.history().join("tmp");
    let location = vault.history().join("versions").join(location_key("a.md"));
    let now = super::versions::now_ms();
    let lookalikes = [
        tmp.join("manual.tmpv"),
        tmp.join(format!("{}.tmpv", "A".repeat(32))),
        tmp.join("del-not-owned"),
        tmp.join(format!("del-{}-bad", "0".repeat(32))),
        location.join(format!("{now:013}-0123456789abcdef-abcdeg")),
        location.join("9007199254740992-0123456789abcdef-abcdef"),
    ];
    for odd in &lookalikes {
        fs::create_dir(odd).unwrap();
        fs::write(odd.join("payload"), b"mine").unwrap();
        let health = vault.health();
        assert_eq!(not_keeping(&health), Some(NotKeptReason::Unavailable));
        assert_eq!(health.attention, [odd.to_string_lossy()]);
        assert_eq!(
            retention::maintain(&vault.roots.canonical, CAPS, now + DAY),
            None
        );
        assert_eq!(fs::read(odd.join("payload")).unwrap(), b"mine");
        fs::remove_dir_all(odd).unwrap();
    }
    let outside = TempDir::new().unwrap();
    let link = tmp.join(format!("{:032x}.tmpv", 1));
    symlink(outside.path(), &link).unwrap();
    assert_eq!(
        not_keeping(&vault.health()),
        Some(NotKeptReason::Unavailable)
    );
    fs::remove_file(&link).unwrap();
    assert!(outside.path().exists());

    let young = tmp.join(format!("{:032x}.tmpv", 2));
    let partial = tmp.join(format!("{:032x}.tmpv", 3));
    for dir in [&young, &partial] {
        fs::create_dir(dir).unwrap();
        fs::write(dir.join("payload"), [b'x'; 100]).unwrap();
    }
    fs::write(partial.join("notes.txt"), b"keep").unwrap();
    let used = vault.health().used_bytes.unwrap();
    let maintain = |now| retention::maintain(&vault.roots.canonical, CAPS, now).is_some();
    assert!(maintain(super::versions::now_ms()));
    assert!(young.join("payload").exists(), "a fresh leftover stays");
    assert_eq!(vault.health().used_bytes, Some(used));
    assert!(maintain(super::versions::now_ms() + 2 * HOUR));
    assert!(!young.exists());
    assert_eq!(fs::read(partial.join("notes.txt")).unwrap(), b"keep");
    assert!(!partial.join("payload").exists());
    assert_eq!(vault.health().used_bytes, Some(used - 200));
    assert_eq!(vault.rows(&page).len(), 1);
}

/// A version folder for "a.md" with a hand-written record and a one-byte payload.
fn record(vault: &Vault, time: u64, path: &str, sha: &str) -> PathBuf {
    let location = vault.history().join("versions").join(location_key("a.md"));
    let entry = location.join(format!("{time:013}-0123456789abcdef-abcdef"));
    fs::create_dir(&entry).unwrap();
    fs::write(entry.join("payload"), b"x").unwrap();
    let meta = json!({"format": 1, "capturedAt": time, "reason": "checkpoint",
        "recordedPath": path, "length": 1, "sha256": sha});
    fs::write(entry.join("version.json"), meta.to_string()).unwrap();
    entry
}

/// Seam: version records read from disk. Catches a malformed hash panicking the scan, and a
/// record listed or kept as whole under another page's location.
#[test]
fn malformed_records_are_counted_and_never_listed() {
    let vault = vault();
    let page = vault.page("a.md", b"one");
    assert_eq!(vault.save(&page, b"two"), committed(true));
    let recent = super::versions::now_ms() - 5_000;
    let tail = "0".repeat(48);
    // 64 bytes, but byte 16 falls inside a two-byte character.
    let unicode = format!("0123456789abcde\u{e9}{}", "0".repeat(47));
    assert_eq!(unicode.len(), 64);
    record(&vault, recent, "a.md", &unicode);
    record(
        &vault,
        recent + 1,
        "a.md",
        &format!("0123456789ABCDEF{tail}"),
    );
    record(
        &vault,
        recent + 2,
        "b.md",
        &format!("0123456789abcdef{tail}"),
    );
    assert_eq!(vault.health().unreadable, 3);
    assert_eq!(vault.rows(&page).len(), 1);
    let id = format!(
        "{}/{recent:013}-0123456789abcdef-abcdef",
        location_key("a.md")
    );
    assert_eq!(
        read_version(&vault.roots, &id, &unicode),
        ReadVersionOutcome::Damaged
    );
    fs::write(&page, b"elsewhere").unwrap();
    assert_eq!(vault.save(&page, b"mine"), committed(true));
    assert_eq!(vault.rows(&page).len(), 2);
}

/// Seam: a record that cannot be read now. Catches it being taken for a malformed one and
/// pruned, when nothing is known about what it holds.
#[test]
fn an_unreadable_record_is_never_pruned() {
    let vault = vault();
    let page = vault.page("a.md", b"one");
    assert_eq!(vault.save(&page, b"two"), committed(true));
    let recent = super::versions::now_ms() - 5_000;
    let sha = format!("0123456789abcdef{}", "0".repeat(48));
    let meta = record(&vault, recent, "a.md", &sha).join("version.json");
    fs::set_permissions(&meta, fs::Permissions::from_mode(0o000)).unwrap();
    let health = vault.health();
    let later = super::versions::now_ms() + 400 * DAY;
    let maintained = retention::maintain(&vault.roots.canonical, CAPS, later);
    fs::set_permissions(&meta, fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(not_keeping(&health), Some(NotKeptReason::Unavailable));
    assert_eq!(health.attention, [meta.to_string_lossy()]);
    assert_eq!(maintained, None);
    assert!(meta.exists());
}

/// A whole version of "a.md" written by hand; zeros are written sparse when asked.
fn whole(vault: &Vault, time: u64, bytes: &[u8], sparse: bool) -> (String, String) {
    let sha = hex(&sha256(bytes));
    let loc = location_key("a.md");
    let name = format!("{time:013}-{}-abcdef", &sha[..16]);
    let entry = vault.history().join("versions").join(&loc).join(&name);
    fs::create_dir(&entry).unwrap();
    let payload = entry.join("payload");
    if sparse {
        let file = fs::File::create(&payload).unwrap();
        file.set_len(bytes.len() as u64).unwrap();
    } else {
        fs::write(&payload, bytes).unwrap();
    }
    let meta = json!({"format": 1, "capturedAt": time, "reason": "checkpoint",
        "recordedPath": "a.md", "length": bytes.len(), "sha256": sha});
    fs::write(entry.join("version.json"), meta.to_string()).unwrap();
    (format!("{loc}/{name}"), sha)
}

/// Seam: the bounded read behind preview and copy. Catches a record's length raising the read
/// bound, so an oversized or sparse payload is read whole, shown or copied.
#[test]
fn payloads_past_the_read_bound_are_refused_unread() {
    let vault = vault();
    let page = vault.page("a.md", b"one");
    assert_eq!(vault.save(&page, b"two"), committed(true));
    TEST_CAPS.set(Some(Caps {
        version_bytes: 1_024,
        ..CAPS
    }));
    let recent = super::versions::now_ms() - 5_000;
    // At the bound, one byte past it, and a sparse file whose record matches its zeros.
    for (offset, length, sparse) in [(0, 1_024, false), (1, 1_025, false), (2, 65_536, true)] {
        let bytes = vec![if sparse { 0 } else { b'x' }; length];
        let (id, sha) = whole(&vault, recent + offset, &bytes, sparse);
        let preview = read_version(&vault.roots, &id, &sha);
        let copied = copy_version(&id, &sha, Some(""), &uuid(), &vault.roots);
        if length <= 1_024 {
            assert!(matches!(
                preview,
                ReadVersionOutcome::Ok { length: 1_024, .. }
            ));
            assert_eq!(fs::read(vault.path("a-2.md")).unwrap(), bytes);
        } else {
            assert_eq!(preview, ReadVersionOutcome::Damaged, "{length}");
            let refused = VersionCopyRefusal::Damaged;
            assert_eq!(copied, VersionCopyOutcome::Refused { reason: refused });
        }
    }
    TEST_CAPS.set(None);
    assert!(!vault.path("a-3.md").exists());
}

/// Seam: what counts as one whole version. Catches the scan, the lists and preview or copy
/// disagreeing on an extra file or a missing, wrong or unreadable location record.
#[test]
fn scan_lists_and_reads_share_one_listable_rule() {
    let vault = vault();
    let pages: Vec<PathBuf> = ["a.md", "b.md", "c.md", "d.md"]
        .iter()
        .map(|name| {
            let page = vault.page(name, name.as_bytes());
            assert_eq!(vault.save(&page, b"new"), committed(true));
            page
        })
        .collect();
    let rows: Vec<VersionRow> = pages
        .iter()
        .map(|page| vault.rows(page)[0].clone())
        .collect();
    let location = |name: &str| vault.history().join("versions").join(location_key(name));
    let extra = vault.payload(&rows[0]).with_file_name("notes.txt");
    fs::write(&extra, b"keep").unwrap();
    fs::remove_file(location("b.md").join("location.json")).unwrap();
    let wrong = json!({"recordedPath": "a.md"}).to_string();
    fs::write(location("c.md").join("location.json"), &wrong).unwrap();
    let health = vault.health();
    assert_eq!((health.state, health.unreadable), (HealthState::On, 3));
    for (page, row) in pages.iter().zip(&rows).take(3) {
        assert!(vault.rows(page).is_empty(), "{}", page.display());
        let preview = read_version(&vault.roots, &row.id, &row.sha256);
        assert_eq!(preview, ReadVersionOutcome::Damaged);
        let refused = VersionCopyRefusal::Damaged;
        assert_eq!(
            copy_version(&row.id, &row.sha256, Some(""), &uuid(), &vault.roots),
            VersionCopyOutcome::Refused { reason: refused }
        );
    }
    let ListLocationsOutcome::Ok { locations, .. } = list_locations(&vault.roots, None) else {
        panic!("no locations");
    };
    let listed: Vec<&str> = locations.iter().map(|row| row.path.as_str()).collect();
    assert_eq!(listed, ["d.md"]);
    assert_eq!(vault.bytes(&vault.rows(&pages[3])[0]), b"d.md");
    // A version filed under a wrong record could never be listed, so none is kept there.
    fs::write(&pages[2], b"elsewhere").unwrap();
    let outcome = vault.save(&pages[2], b"mine");
    assert_eq!(outcome, noted(true, NotKeptReason::Unavailable));
    let record = location("c.md").join("location.json");
    assert_eq!(fs::read_to_string(&record).unwrap(), wrong);
    assert_eq!(fs::read(&extra).unwrap(), b"keep");

    // Unreadable is not wrong: nothing can be counted, so nothing may change.
    let record = location("d.md").join("location.json");
    fs::set_permissions(&record, fs::Permissions::from_mode(0o000)).unwrap();
    let health = vault.health();
    let later = super::versions::now_ms() + 400 * DAY;
    let maintained = retention::maintain(&vault.roots.canonical, CAPS, later);
    fs::set_permissions(&record, fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(health.attention, [record.to_string_lossy()]);
    assert_eq!(maintained, None);
    assert_eq!(vault.rows(&pages[3]).len(), 1);
}

/// Seam: admission reserves what the writer will store. Catches a new location's record being
/// under-reserved, so a capture lands past the budget.
#[test]
fn admission_reserves_the_exact_bytes_of_a_new_location() {
    // JSON escapes every quote, so this record is longer than its path suggests.
    let name = format!("{}\u{e9}.md", "\"".repeat(20));
    let measured = vault();
    let page = measured.page(&name, b"keep me");
    assert_eq!(measured.save(&page, b"new"), committed(true));
    let exact = measured.health().used_bytes.unwrap();
    for (budget, kept) in [(exact - 1, false), (exact, true)] {
        TEST_CAPS.set(Some(Caps {
            budget_bytes: budget,
            ..CAPS
        }));
        let vault = vault();
        let page = vault.page(&name, b"keep me");
        let outcome = vault.save(&page, b"new");
        TEST_CAPS.set(None);
        let expected = if kept {
            committed(true)
        } else {
            noted(true, NotKeptReason::Full)
        };
        assert_eq!(outcome, expected, "budget {budget}");
        assert_eq!(vault.rows(&page).len(), usize::from(kept));
    }
}

/// Seam: capture comes before the exact recheck. Catches losing the text that was read when
/// the save then finds the page changed and refuses to publish.
#[test]
fn a_conflict_still_keeps_the_text_it_read() {
    let vault = vault();
    let page = vault.page("a.md", b"what I read");
    let elsewhere = |path: &Path| fs::write(path, b"changed meanwhile").unwrap();
    let disk = Disk {
        after_stage: &elsewhere,
        synced: true,
    };
    let outcome = vault.save_on(&disk, &page, b"mine");
    assert!(
        matches!(outcome, SaveOutcome::Conflict { .. }),
        "{outcome:?}"
    );
    assert_eq!(fs::read(&page).unwrap(), b"changed meanwhile");
    assert_eq!(vault.bytes(&vault.rows(&page)[0]), b"what I read");
}

/// Seam: one capture at a time per vault, with no waiting. Catches a save stalling or failing
/// while another capture holds the store, and health claiming protection it has not checked.
#[test]
fn a_busy_store_skips_capture_and_health_says_so_truthfully() {
    let vault = vault();
    let page = vault.page("a.md", b"one");
    let held = CopyLock::try_acquire(&vault.roots.canonical).unwrap();
    let started = Instant::now();
    assert_eq!(vault.save(&page, b"two"), noted(true, NotKeptReason::Busy));
    assert!(
        started.elapsed() < Duration::from_millis(500),
        "the save waited"
    );
    assert_eq!(vault.health().state, HealthState::Unknown);
    drop(held);
    assert_eq!(not_keeping(&vault.health()), Some(NotKeptReason::Busy));

    assert_eq!(vault.save(&page, b"three"), committed(true));
    assert_eq!(vault.health().state, HealthState::On);
    assert_eq!(vault.bytes(&vault.rows(&page)[0]), b"two");
}

#[test]
#[ignore = "helper process for another_process_holding_the_history_lock_skips_capture"]
fn history_lock_holder_process() {
    let Ok(path) = std::env::var(LOCK_HOLDER_ENV) else {
        return;
    };
    let holder = fs::File::options().write(true).open(path).unwrap();
    holder.lock().unwrap();
    println!("{LOCK_HOLDER_READY}");
    std::thread::sleep(Duration::from_secs(60));
}

/// Seam: the OS lock shared with other app processes. Catches a capture racing another process,
/// or a save waiting on it.
#[test]
fn another_process_holding_the_history_lock_skips_capture() {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    let vault = vault();
    let page = vault.page("a.md", b"one");
    let lock = vault.roots.canonical.join(".leadinglight/history.lock");
    fs::create_dir_all(lock.parent().unwrap()).unwrap();
    fs::write(&lock, b"").unwrap();
    let mut holder = Command::new(std::env::current_exe().unwrap())
        .args([
            "leadinglight_history::history_tests::history_lock_holder_process",
            "--exact",
            "--ignored",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(LOCK_HOLDER_ENV, &lock)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut output = BufReader::new(holder.stdout.take().unwrap()).lines();
    let ready = output
        .by_ref()
        .map_while(Result::ok)
        .any(|line| line.contains(LOCK_HOLDER_READY));
    let outcome = ready.then(|| vault.save(&page, b"two"));
    holder.kill().unwrap();
    holder.wait().unwrap();
    assert!(ready, "the lock holder process did not start");
    assert_eq!(outcome, Some(noted(true, NotKeptReason::Busy)));
    assert!(vault.rows(&page).is_empty());
    assert_eq!(not_keeping(&vault.health()), Some(NotKeptReason::Busy));
}

/// Seam: authoritative accounting before any bytes. Catches a capture past the budget, and a
/// scan that keeps going past its ceiling instead of stopping.
#[test]
fn the_budget_and_the_scan_ceiling_are_checked_before_writing() {
    TEST_CAPS.set(Some(Caps {
        budget_bytes: 1_500,
        ..CAPS
    }));
    let vault = vault();
    let first = vault.page("a.md", &[b'a'; 700]);
    let second = vault.page("b.md", &[b'b'; 700]);
    assert_eq!(vault.save(&first, b"x"), committed(true));
    assert_eq!(vault.rows(&first).len(), 1);
    assert_eq!(vault.save(&second, b"y"), noted(true, NotKeptReason::Full));
    assert!(vault.rows(&second).is_empty());
    let health = vault.health();
    assert_eq!(not_keeping(&health), Some(NotKeptReason::Full));
    assert!(health.used_bytes.unwrap() <= 1_500);

    TEST_CAPS.set(Some(Caps {
        locations: 1,
        versions: 1,
        tmp: 0,
        ..CAPS
    }));
    let crowded = self::vault();
    let versions = crowded.history().join("versions");
    for index in 0..80 {
        fs::create_dir_all(versions.join(format!("{index:032x}"))).unwrap();
    }
    let page = crowded.page("a.md", b"one");
    assert_eq!(
        crowded.save(&page, b"two"),
        noted(true, NotKeptReason::Full)
    );
    assert_eq!(not_keeping(&crowded.health()), Some(NotKeptReason::Full));
    TEST_CAPS.set(None);
}

/// Seam: store integrity. Catches following or removing a link, an unknown folder or unknown
/// file, listing a malformed version, recursive deletion, and touching S0 recovery files.
#[test]
fn odd_store_entries_stop_capture_and_nothing_unknown_is_removed() {
    let vault = vault();
    let page = vault.page("a.md", b"one");
    vault.save(&page, b"two");
    let versions = vault.history().join("versions");
    let outside = TempDir::new().unwrap();
    let odd = [versions.join("linked"), versions.join("not-a-location")];
    symlink(outside.path(), &odd[0]).unwrap();
    for (index, item) in odd.iter().enumerate() {
        fs::write(&page, format!("elsewhere {index}")).unwrap();
        assert_eq!(
            vault.save(&page, b"mine"),
            noted(true, NotKeptReason::Unavailable)
        );
        let health = vault.health();
        assert_eq!(not_keeping(&health), Some(NotKeptReason::Unavailable));
        assert_eq!(health.attention, [item.to_string_lossy()]);
        if index == 0 {
            fs::remove_file(item).unwrap();
            fs::create_dir(&odd[1]).unwrap();
        }
    }
    assert!(outside.path().exists());
    fs::remove_dir(&odd[1]).unwrap();

    // Recent, so only the explicit maintenance pass below may remove them.
    let location = versions.join(location_key("a.md"));
    let recent = super::versions::now_ms() - 5_000;
    let malformed = location.join(format!("{recent:013}-0123456789abcdef-abcdef"));
    let extra = location.join(format!("{:013}-0123456789abcdef-abcdef", recent + 1));
    for entry in [&malformed, &extra] {
        fs::create_dir(entry).unwrap();
        fs::write(entry.join("payload"), b"x").unwrap();
        fs::write(entry.join("version.json"), b"{bad").unwrap();
    }
    fs::write(extra.join("notes.txt"), b"keep").unwrap();
    let unknown = versions.join("notes.txt");
    let intent = vault.history().join(format!("copy-{}.json", uuid()));
    let staging = vault.path(".leadinglight-kept");
    fs::write(&unknown, b"keep").unwrap();
    fs::write(&intent, b"{}").unwrap();
    fs::create_dir(&staging).unwrap();
    fs::write(staging.join("draft"), b"kept").unwrap();
    fs::write(&page, b"elsewhere again").unwrap();
    assert_eq!(vault.save(&page, b"mine again"), committed(true));
    assert_eq!(vault.health().state, HealthState::On);
    assert_eq!(vault.health().unreadable, 2);
    let listed = vault.rows(&page);
    assert!(listed
        .iter()
        .all(|row| !row.id.contains("0123456789abcdef")));

    let later = super::versions::now_ms() + 400 * DAY;
    assert!(retention::maintain(&vault.roots.canonical, CAPS, later).is_some());
    for kept in [&unknown, &intent, &staging.join("draft")] {
        assert!(kept.exists(), "{}", kept.display());
    }
    let parked: Vec<PathBuf> = fs::read_dir(vault.history().join("tmp"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(parked.len(), 1, "{parked:?}");
    assert_eq!(fs::read(parked[0].join("notes.txt")).unwrap(), b"keep");
    assert_eq!(vault.rows(&page).len(), 1, "the newest version stays");
}

/// Seam: Save as a copy. Catches inexact bytes, writing over the original or an existing file,
/// a silent folder fallback, a duplicate after a lost reply, copying damaged bytes, and pruning
/// racing a copy.
#[test]
fn version_copies_are_exact_and_never_overwrite() {
    let vault = vault();
    let original: &[u8] = b"\xEF\xBB\xBFline one\r\n\xFF not utf8\r\n";
    let page = vault.page("notes/plan.md", original);
    vault.save(&page, b"rewritten");
    let rows = vault.rows(&page);
    let row = &rows[0];
    let operation = uuid();
    let copy = |folder: Option<&str>, operation: &str| {
        copy_version(&row.id, &row.sha256, folder, operation, &vault.roots)
    };
    let created = |name: &str| VersionCopyOutcome::Created {
        path: vault.path(name).to_string_lossy().into_owned(),
        relative_path: name.into(),
        durable: true,
    };
    assert_eq!(copy(None, &operation), created("notes/plan-2.md"));
    assert_eq!(copy(None, &operation), created("notes/plan-2.md"));
    assert_eq!(fs::read(vault.path("notes/plan-2.md")).unwrap(), original);
    assert_eq!(fs::read(&page).unwrap(), b"rewritten");
    let refused = |reason| VersionCopyOutcome::Refused { reason };
    assert_eq!(
        copy(Some(""), &operation),
        refused(VersionCopyRefusal::OperationMismatch)
    );
    fs::write(vault.path("notes/plan-3.md"), original).unwrap();
    assert_eq!(copy(None, &uuid()), created("notes/plan-4.md"));
    assert_eq!(fs::read(vault.path("notes/plan-3.md")).unwrap(), original);

    // Maintenance never runs while a copy holds the store.
    let held = CopyLock::try_acquire(&vault.roots.canonical).unwrap();
    let later = super::versions::now_ms() + 400 * DAY;
    assert_eq!(
        retention::maintain(&vault.roots.canonical, CAPS, later),
        None
    );
    drop(held);

    fs::rename(vault.path("notes"), vault.path("moved")).unwrap();
    assert_eq!(
        copy(None, &uuid()),
        VersionCopyOutcome::FolderUnavailable {
            recorded_folder: vault.path("notes").to_string_lossy().into_owned()
        }
    );
    assert_eq!(copy(Some(""), &uuid()), created("plan-2.md"));
    let mut damaged = original.to_vec();
    damaged[0] ^= 1;
    fs::write(vault.payload(row), &damaged).unwrap();
    assert_eq!(
        copy(Some(""), &uuid()),
        refused(VersionCopyRefusal::Damaged)
    );
}

/// Seam: the passive preview. Catches showing any text before the whole version is verified,
/// a cut inside a character, and a long version reported as damaged.
#[test]
fn preview_shows_only_verified_text_cut_between_characters() {
    let vault = vault();
    let long = format!("a{}", "é".repeat(200_000));
    let page = vault.page("long.md", long.as_bytes());
    vault.save(&page, b"short");
    let row = vault.rows(&page)[0].clone();
    let ReadVersionOutcome::Ok {
        text: Some(text),
        length,
        shown_bytes,
        truncated: true,
        bom: false,
        crlf: false,
    } = read_version(&vault.roots, &row.id, &row.sha256)
    else {
        panic!("not a truncated preview");
    };
    assert_eq!(length, long.len() as u64);
    assert_eq!(shown_bytes, 256 * 1024 - 1);
    assert!(long.starts_with(&text));

    let binary = vault.page("binary.md", b"\xFF\xFE text");
    vault.save(&binary, b"text");
    let binary_rows = vault.rows(&binary);
    let binary_row = &binary_rows[0];
    let preview = read_version(&vault.roots, &binary_row.id, &binary_row.sha256);
    assert!(matches!(preview, ReadVersionOutcome::Ok { text: None, .. }));

    // The exact source text, BOM included; the flags only explain it.
    let source = "\u{feff}line one\r\nline two\r\n";
    let marked = vault.page("bom.md", source.as_bytes());
    vault.save(&marked, b"x");
    let marked_row = vault.rows(&marked)[0].clone();
    assert_eq!(
        read_version(&vault.roots, &marked_row.id, &marked_row.sha256),
        ReadVersionOutcome::Ok {
            text: Some(source.into()),
            length: source.len() as u64,
            shown_bytes: source.len() as u64,
            truncated: false,
            bom: true,
            crlf: true,
        }
    );

    let wrong_hash = "0".repeat(64);
    assert_eq!(
        read_version(&vault.roots, &row.id, &wrong_hash),
        ReadVersionOutcome::Damaged
    );
    assert_eq!(
        read_version(&vault.roots, "../x", &row.sha256),
        ReadVersionOutcome::Missing
    );
    let mut same_length = long.clone().into_bytes();
    same_length[1] = b'b';
    fs::write(vault.payload(&row), &same_length).unwrap();
    assert_eq!(
        read_version(&vault.roots, &row.id, &row.sha256),
        ReadVersionOutcome::Damaged
    );
    fs::remove_file(vault.payload(&row)).unwrap();
    assert_eq!(
        read_version(&vault.roots, &row.id, &row.sha256),
        ReadVersionOutcome::Missing
    );
}

/// Seam: the frozen JSON the UI and bridge parse. Catches a renamed tag or field.
#[test]
fn history_wire_shapes_match_the_frozen_contract() {
    assert_eq!(
        wire(noted(true, NotKeptReason::Busy))["history"],
        json!({"status": "notKept", "reason": "busy"})
    );
    assert_eq!(wire(committed(true))["history"], Value::Null);
    let health = HistoryHealth {
        state: HealthState::Unknown,
        reason: None,
        used_bytes: None,
        budget_bytes: 1,
        unreadable: 0,
        attention: vec![],
    };
    assert_eq!(
        wire(health),
        json!({"state": "unknown", "reason": null, "usedBytes": null, "budgetBytes": 1,
            "unreadable": 0, "attention": []})
    );
    let row = VersionRow {
        id: "i".into(),
        recorded_path: "a.md".into(),
        captured_at: 1,
        reason: VersionReason::BigChange,
        length: 2,
        sha256: "s".into(),
    };
    assert_eq!(
        wire(row),
        json!({"id": "i", "recordedPath": "a.md", "capturedAt": 1, "reason": "bigChange",
            "length": 2, "sha256": "s"})
    );
    assert_eq!(
        wire(ReadVersionOutcome::Damaged),
        json!({"status": "damaged"})
    );
    assert_eq!(
        wire(VersionCopyOutcome::Uncertain {
            candidate_path: None
        }),
        json!({"status": "uncertain", "candidatePath": null})
    );
}

/// About 1 KiB of ordinary prose, different for each `index`.
fn prose(index: usize) -> Vec<u8> {
    let line = "Moved the launch review to Thursday and kept the draft short. ";
    let mut text = format!("# Page {index}\n\n").into_bytes();
    while text.len() < 1_024 {
        text.extend_from_slice(line.as_bytes());
    }
    text.truncate(1_024);
    text
}

/// A valid store of `count` versions, five per page, as the writer leaves them. Its bytes.
fn fill_store(history: &Path, count: usize) -> u64 {
    let start = super::versions::now_ms() - 10 * DAY;
    let mut bytes = 0;
    for index in 0..count {
        let rel = format!("notes/page-{:04}.md", index / 5);
        let location = history.join("versions").join(location_key(&rel));
        if index % 5 == 0 {
            fs::create_dir_all(&location).unwrap();
            let record = json!({"recordedPath": rel}).to_string();
            fs::write(location.join("location.json"), &record).unwrap();
            bytes += record.len() as u64;
        }
        let payload = prose(index);
        let sha = hex(&sha256(&payload));
        let time = start + index as u64 * MINUTE;
        let entry = location.join(format!("{time:013}-{}-{index:06x}", &sha[..16]));
        fs::create_dir(&entry).unwrap();
        let meta = json!({"format": 1, "capturedAt": time, "reason": "checkpoint",
            "recordedPath": rel, "length": payload.len(), "sha256": sha});
        fs::write(entry.join("payload"), &payload).unwrap();
        fs::write(entry.join("version.json"), meta.to_string()).unwrap();
        bytes += (payload.len() + meta.to_string().len()) as u64;
    }
    bytes
}

/// The `percent` nearest-rank value of sorted samples.
fn rank(sorted: &[Duration], percent: usize) -> Duration {
    sorted[(sorted.len() * percent).div_ceil(100) - 1]
}

/// Measurement only: run with `--ignored --nocapture`. Times the authoritative scan of a valid
/// store, then 50 real-sync saves alternating two pages, empty, half full and at the real cap.
/// Asserts outcomes, never timings.
#[test]
#[ignore = "timing measurement"]
fn history_timing_on_a_valid_store() {
    for count in [0, CAPS.versions / 2, CAPS.versions] {
        let vault = vault();
        let history = vault.history();
        let bytes = fill_store(&history, count);
        let mut scans: Vec<Duration> = (0..7)
            .map(|_| {
                let started = Instant::now();
                let scanned = super::inventory::scan(&history, super::inventory::ceiling(CAPS));
                let elapsed = started.elapsed();
                let scanned = scanned.unwrap();
                assert_eq!((scanned.versions, scanned.unreadable), (count, 0));
                assert_eq!(scanned.used_bytes, bytes);
                elapsed
            })
            .collect();
        scans.sort();

        let pages = ["measure/one.md", "measure/two.md"].map(|name| vault.page(name, &prose(0)));
        let mut texts = [prose(0), prose(0)];
        let mut saves = Vec::new();
        // At the cap no version fits, so every save is told so; below it none is.
        let full = count >= CAPS.versions;
        let note = full.then_some(HistoryNote::NotKept {
            reason: NotKeptReason::Full,
        });
        for index in 0..50 {
            let which = index % 2;
            texts[which].extend_from_slice(format!("Added line {index}.\n").as_bytes());
            let started = Instant::now();
            let outcome = vault.save_on(&NativePlatform, &pages[which], &texts[which]);
            saves.push(started.elapsed());
            let expected = SaveOutcome::Committed {
                written: true,
                durable: true,
                history: note,
            };
            assert_eq!(outcome, expected, "save {index} at {count}");
        }
        saves.sort();
        let mut kept = 0;
        for (page, text) in pages.iter().zip(&texts) {
            assert_eq!(&fs::read(page).unwrap(), text);
            let rows = vault.rows(page).len();
            assert_eq!(rows == 0, full);
            kept += rows;
        }
        println!(
            "occupancy {count}: scan p50 {:?} min {:?} max {:?} (7 warm); 50 saves p50 {:?} \
             p95 {:?} max {:?}; all committed durable; note {note:?}; versions kept {kept}",
            rank(&scans, 50),
            scans[0],
            scans[6],
            rank(&saves, 50),
            rank(&saves, 95),
            saves[49],
        );
    }
}

/// The cross-reader contract's payloads (helper report): a BOM, CRLF line ends, multi-byte text.
const BEFORE: &str = "\u{feff}# Plan \u{2713}\r\nzwei Zeilen \u{2014} na\u{ef}ve \u{65e5}\u{672c}\u{8a9e} \u{1f600}\r\n";
const AFTER: &str = "\u{feff}# Plan \u{2713}\r\nshorter\r\n";

/// One request to the bridge's real Node helper. A missing Node fails the test, never passes it.
fn cross_reader(request: &Value) -> Value {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut child = Command::new("node")
        .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap())
        .args([
            "--experimental-strip-types",
            "scripts/leadinglight-history-cross-reader.mjs",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("acceptance gate missing: Node 22.6 or later must be on PATH");
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(request.to_string().as_bytes()).unwrap();
    drop(stdin);
    let out = child.wait_with_output().unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    let answer: Value = serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|_| panic!("the helper gave no JSON answer: {stderr}"));
    assert!(out.status.success(), "{answer} {stderr}");
    println!("{answer}");
    answer
}

/// Seam: the store format shared by the bridge and native. Catches either reader refusing,
/// mislabelling or altering a version the other wrote. Opt-in: `--ignored --nocapture`, Node 22.6+.
#[test]
#[ignore = "runs the bridge's Node helper"]
fn bridge_and_native_read_each_others_versions() {
    let sha = |text: &str| hex(&sha256(text.as_bytes()));
    let before_sha = "25efbca045a3d328ff0ea97e68deb7bfb83b3f2a84ae36738df85dc8d0f06ab2";
    assert_eq!(sha(BEFORE), before_sha);
    assert_eq!(
        sha(AFTER),
        "9622988e63ba61c796424ab952dad1aa120f3b3427cb82c3e0ec4893d63afe7b"
    );
    let vault = vault();
    let marker = "leadinglight synthetic vault\n";
    fs::write(vault.path(".leadinglight-synthetic-vault"), marker).unwrap();
    let root = vault.dir.path().to_str().unwrap();
    let location = |path: &str, row: &VersionRow| json!({"path": path, "newestAt": row.captured_at, "count": 1, "exists": true});

    // Bridge writes, native reads, lists, previews and copies.
    let made = cross_reader(
        &json!({"op": "produce", "vault": root, "page": "notes/plan.md",
        "beforeText": BEFORE, "afterText": AFTER}),
    );
    let page = vault.path("notes/plan.md");
    let rows = vault.rows(&page);
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(wire(row), made["version"]);
    assert!(row
        .id
        .starts_with(&format!("{}/", location_key("notes/plan.md"))));
    assert_eq!(
        (row.recorded_path.as_str(), row.length),
        ("notes/plan.md", 54)
    );
    assert_eq!(row.sha256, before_sha);
    let shown = ReadVersionOutcome::Ok {
        text: Some(BEFORE.into()),
        length: 54,
        shown_bytes: 54,
        truncated: false,
        bom: true,
        crlf: true,
    };
    assert_eq!(read_version(&vault.roots, &row.id, &row.sha256), shown);
    let copied = copy_version(&row.id, &row.sha256, None, &uuid(), &vault.roots);
    let VersionCopyOutcome::Created { relative_path, .. } = copied else {
        panic!("{copied:?}");
    };
    assert_eq!(relative_path, "notes/plan-2.md");
    assert_eq!(
        fs::read(vault.path(&relative_path)).unwrap(),
        BEFORE.as_bytes()
    );
    assert_eq!(fs::read(&page).unwrap(), AFTER.as_bytes());
    let ListLocationsOutcome::Ok { locations, .. } = list_locations(&vault.roots, None) else {
        panic!("no locations");
    };
    assert_eq!(wire(&locations), json!([location("notes/plan.md", row)]));

    // Native writes through its own save, the bridge reads, previews and copies.
    let draft = vault.page("notes/draft.md", BEFORE.as_bytes());
    assert_eq!(vault.save(&draft, AFTER.as_bytes()), committed(true));
    let mine = vault.rows(&draft);
    assert_eq!(mine.len(), 1);
    let read = cross_reader(
        &json!({"op": "verify", "vault": root, "page": "notes/draft.md",
        "expectedText": BEFORE, "currentText": AFTER}),
    );
    assert_eq!(read["version"], wire(&mine[0]));
    assert_eq!(read["copy"]["relativePath"], "notes/draft-2.md");
    assert_eq!(read["location"], location("notes/draft.md", &mine[0]));
    assert_eq!(
        fs::read(vault.path("notes/draft-2.md")).unwrap(),
        BEFORE.as_bytes()
    );
    assert_eq!(fs::read(&draft).unwrap(), AFTER.as_bytes());
    assert_eq!(fs::read(&page).unwrap(), AFTER.as_bytes());
    let health = vault.health();
    assert_eq!((health.state, health.unreadable), (HealthState::On, 0));
}
