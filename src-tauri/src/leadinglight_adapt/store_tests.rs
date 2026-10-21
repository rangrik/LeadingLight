//! Local conversation records in a disposable app-data folder. Failed writes come from `FaultyIo`;
//! everything else is the real filesystem.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tempfile::NamedTempFile;

use super::now;
use super::store::{NativeStoreIo, Published, Record, Store, StoreIo};
use super::wire::{Entry, Failure, ProviderId, Reply, RevisionBase, StopReason};

/// Store effects that fail when asked.
#[derive(Default)]
pub(super) struct Faults {
    /// The rename fails, so the stored file stays as it was.
    pub(super) unpublished: AtomicBool,
    /// The folder sync fails, after the rename or unlink it follows is in place.
    pub(super) unsynced: AtomicBool,
    /// The unlink fails, so the file stays.
    pub(super) stuck: AtomicBool,
}

pub(super) fn set(fault: &AtomicBool, on: bool) {
    fault.store(on, Ordering::SeqCst);
}

pub(super) struct FaultyIo(pub(super) Arc<Faults>);

impl StoreIo for FaultyIo {
    fn publish(&self, file: NamedTempFile, path: &Path) -> std::io::Result<()> {
        if self.0.unpublished.load(Ordering::SeqCst) {
            return Err(std::io::Error::other("not published"));
        }
        NativeStoreIo.publish(file, path)
    }

    fn sync_dir(&self, dir: &Path) -> std::io::Result<()> {
        if self.0.unsynced.load(Ordering::SeqCst) {
            return Err(std::io::Error::other("not synced"));
        }
        NativeStoreIo.sync_dir(dir)
    }

    fn remove_file(&self, path: &Path) -> std::io::Result<()> {
        if self.0.stuck.load(Ordering::SeqCst) {
            return Err(std::io::Error::other("not removed"));
        }
        NativeStoreIo.remove_file(path)
    }
}

pub(super) fn faulty_store(root: &Path) -> (Store, Arc<Faults>) {
    let faults = Arc::new(Faults::default());
    let store = Store::with_io(root.to_path_buf(), Arc::new(FaultyIo(Arc::clone(&faults))));
    (store, faults)
}

const VAULT: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TURN_1: &str = "11111111-1111-4111-8111-111111111111";
const TURN_2: &str = "22222222-2222-4222-8222-222222222222";

fn request(turn_id: &str, included: &[&str]) -> Entry {
    Entry::Request {
        turn_id: turn_id.to_string(),
        at: now(),
        provider: ProviderId::Codex,
        text: "A weekly review with three questions".to_string(),
        attachments: Vec::new(),
        included_turn_ids: included.iter().map(|id| id.to_string()).collect(),
        revision: None,
        guide: "extensions-guide-1".to_string(),
    }
}

fn reply(turn_id: &str) -> Entry {
    Entry::Reply {
        turn_id: turn_id.to_string(),
        at: now(),
        reply: Reply::Unsupported {
            message: "Extensions cannot set reminders.".to_string(),
            alternative: None,
        },
    }
}

fn record(id: &str, entries: Vec<Entry>) -> Record {
    let mut record = Record::new(id.to_string(), now());
    record.entries = entries;
    record
}

#[test]
fn records_round_trip_privately_and_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().join("conversations"));
    store.prepare(VAULT).unwrap();
    let saved = record(
        "conversation-1",
        vec![
            request(TURN_1, &[]),
            reply(TURN_1),
            request(TURN_2, &[TURN_1]),
        ],
    );
    store.save(VAULT, &saved).unwrap();
    assert_eq!(store.load(VAULT, "conversation-1"), Some(saved.clone()));

    let folder = dir.path().join("conversations").join(VAULT);
    let names: Vec<String> = fs::read_dir(&folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["conversation-1.json"]);
    let mode = |path: &std::path::Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&folder), 0o700);
    assert_eq!(mode(&folder.join("conversation-1.json")), 0o600);

    store.delete(VAULT, "conversation-1").unwrap();
    assert_eq!(store.load(VAULT, "conversation-1"), None);
    store.delete(VAULT, "conversation-1").unwrap();
}

/// A failed rename or unlink changes nothing; a failed folder sync after one is reported as a
/// change in place that is not confirmed durable, never as no change.
#[test]
fn a_write_says_whether_it_changed_anything() {
    let dir = tempfile::tempdir().unwrap();
    let (store, faults) = faulty_store(&dir.path().join("conversations"));
    store.prepare(VAULT).unwrap();
    let first = record("conversation-1", vec![request(TURN_1, &[])]);
    assert_eq!(store.save(VAULT, &first).unwrap(), Published::Durable);

    let second = record("conversation-1", vec![request(TURN_1, &[]), reply(TURN_1)]);
    set(&faults.unpublished, true);
    assert!(store.save(VAULT, &second).is_err());
    assert_eq!(store.load(VAULT, "conversation-1"), Some(first.clone()));
    set(&faults.unpublished, false);

    set(&faults.unsynced, true);
    assert_eq!(store.save(VAULT, &second).unwrap(), Published::Unsynced);
    assert_eq!(store.load(VAULT, "conversation-1"), Some(second));

    set(&faults.stuck, true);
    assert!(store.delete(VAULT, "conversation-1").is_err());
    assert!(store.load(VAULT, "conversation-1").is_some());
    set(&faults.stuck, false);
    assert_eq!(
        store.delete(VAULT, "conversation-1").unwrap(),
        Published::Unsynced
    );
    assert_eq!(store.load(VAULT, "conversation-1"), None);
    set(&faults.unsynced, false);
    assert_eq!(
        store.delete(VAULT, "conversation-1").unwrap(),
        Published::Durable
    );
}

/// Amendment 3: a stored request keeps the version that was active when its package was attached,
/// exactly. A record without that field, or with a malformed one, is unreadable; nothing fills it in.
#[test]
fn a_stored_revision_keeps_its_original_expected_version() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().join("conversations"));
    store.prepare(VAULT).unwrap();
    let expected = "c".repeat(64);
    let mut asked = request(TURN_1, &[]);
    if let Entry::Request { revision, .. } = &mut asked {
        *revision = Some(RevisionBase {
            package_id: "local.weekly-review".to_string(),
            base_sha256: "a".repeat(64),
            expected_active_sha256: Some(expected.clone()),
        });
    }
    let saved = record("conversation-revised", vec![asked, reply(TURN_1)]);
    store.save(VAULT, &saved).unwrap();
    let loaded = store.load(VAULT, "conversation-revised").unwrap();
    assert_eq!(loaded, saved);
    let Entry::Request {
        revision: Some(kept),
        ..
    } = &loaded.entries[0]
    else {
        panic!("{:?}", loaded.entries[0]);
    };
    assert_eq!(
        kept.expected_active_sha256.as_deref(),
        Some(expected.as_str())
    );

    let folder = dir.path().join("conversations").join(VAULT);
    let text = fs::read_to_string(folder.join("conversation-revised.json")).unwrap();
    let field = format!(",\"expectedActiveSha256\":\"{expected}\"");
    assert!(text.contains(&field));
    for (id, changed) in [
        ("conversation-before", text.replace(&field, "")),
        (
            "conversation-malformed",
            text.replace(&field, ",\"expectedActiveSha256\":\"ABC\""),
        ),
    ] {
        let renamed = changed.replace("conversation-revised", id);
        fs::write(folder.join(format!("{id}.json")), renamed).unwrap();
        assert_eq!(store.load(VAULT, id), None, "{id}");
    }
}

#[test]
fn a_record_that_breaks_a_rule_is_left_alone_and_not_shown() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().join("conversations"));
    store.prepare(VAULT).unwrap();
    store
        .save(
            VAULT,
            &record(
                "conversation-good",
                vec![request(TURN_1, &[]), reply(TURN_1)],
            ),
        )
        .unwrap();
    let folder = dir.path().join("conversations").join(VAULT);
    let broken: Vec<(&str, Vec<Entry>)> = vec![
        ("conversation-orphan", vec![reply(TURN_1)]),
        (
            "conversation-two-waiting",
            vec![request(TURN_1, &[]), request(TURN_2, &[])],
        ),
        (
            "conversation-later-context",
            vec![request(TURN_1, &[TURN_2]), reply(TURN_1)],
        ),
        (
            "conversation-reset-without-limit",
            vec![
                request(TURN_1, &[]),
                Entry::Failed {
                    turn_id: TURN_1.to_string(),
                    at: now(),
                    reason: Failure::TimedOut,
                    resets_at: Some(now()),
                },
            ],
        ),
    ];
    for (id, entries) in &broken {
        let bytes = serde_json::to_vec(&record(id, entries.clone())).unwrap();
        fs::write(folder.join(format!("{id}.json")), bytes).unwrap();
    }
    fs::write(folder.join("conversation-junk.json"), "not json").unwrap();
    let renamed = serde_json::to_vec(&record("conversation-other", Vec::new())).unwrap();
    fs::write(folder.join("conversation-renamed.json"), renamed).unwrap();

    let listed: Vec<String> = store
        .list(VAULT)
        .into_iter()
        .map(|record| record.conversation_id)
        .collect();
    assert_eq!(listed, ["conversation-good"]);
    for (id, _) in &broken {
        assert_eq!(store.load(VAULT, id), None, "{id}");
        assert!(folder.join(format!("{id}.json")).exists(), "{id}");
    }
    assert!(folder.join("conversation-junk.json").exists());

    // A stop after a waiting request is a valid ending, proven or not.
    let stopped = record(
        "conversation-stopped",
        vec![
            request(TURN_1, &[]),
            Entry::Stopped {
                turn_id: TURN_1.to_string(),
                at: now(),
                reason: StopReason::AppClosed,
                confirmed: false,
            },
        ],
    );
    store.save(VAULT, &stopped).unwrap();
    assert_eq!(store.load(VAULT, "conversation-stopped"), Some(stopped));
}
