//! The local package store in a disposable root: candidates, compare-and-set activation and
//! rollback, corruption, retention and the bundled package. No vault is read or written here.
//! Failed and paused store effects come from `FaultyIo`; everything else is the real filesystem.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;

use serde_json::{json, Value};
use tempfile::NamedTempFile;

use super::hex;
use super::manifest::Capability;
use super::manifest::NATIVE_CAPABILITIES;
use super::store::{
    NativeStoreIo, Store, StoreIo, MAX_PREFERENCES_BYTES, MAX_SCANNED_ENTRIES, MAX_SEQ,
    MAX_STORED_VERSIONS, MAX_VAULTS, MAX_VAULT_KEY_BYTES, MAX_VERSIONS_PER_PACKAGE,
};
use super::wire::{
    ActivationRefusal, DeactivationRefusal, ImportRefusal, ImportReply, InstalledExtension,
    ReadReply, RunRefusal, StoredVersion,
};
use crate::vault::staged_file::sha256;

const VAULT: &str = "/vault";
const QUICK: &str = "local.quick-note";
const BUNDLED: &str = "leadinglight.meeting-debrief";
const COMMENTARY: &str = "leadinglight.passage-commentary";

/// A one-time hold: when armed, the next effect says it started, then waits to be released.
type Pause = Mutex<Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>>;

fn arm(pause: &Pause) -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
    let (started_tx, started) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    *pause.lock().unwrap() = Some((started_tx, release_rx));
    (started, release)
}

fn hold(pause: &Pause) {
    let armed = pause.lock().unwrap().take();
    if let Some((started, release)) = armed {
        let _ = started.send(());
        let _ = release.recv();
    }
}

/// Store effects that fail or pause when asked.
#[derive(Default)]
pub(super) struct Faults {
    /// Publishing the preferences fails before the rename, so the file stays as it was.
    pub(super) unpublished: AtomicBool,
    /// Every folder sync fails, after what it follows is already in place.
    pub(super) unsynced: AtomicBool,
    /// Removing a package file fails.
    pub(super) stuck: AtomicBool,
    sync_pause: Pause,
    read_pause: Pause,
}

impl Faults {
    /// Answers `(started, release)` for the next folder sync.
    pub(super) fn pause_next_sync(&self) -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
        arm(&self.sync_pause)
    }

    /// Answers `(started, release)` for the next package read, held after its bytes are read.
    pub(super) fn pause_next_read(&self) -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
        arm(&self.read_pause)
    }
}

pub(super) struct FaultyIo(pub(super) Arc<Faults>);

impl StoreIo for FaultyIo {
    fn publish(&self, file: NamedTempFile, path: &Path) -> std::io::Result<()> {
        let preferences = path
            .file_name()
            .is_some_and(|name| name == "preferences.json");
        if preferences && self.0.unpublished.load(Ordering::SeqCst) {
            return Err(std::io::Error::other("not published"));
        }
        NativeStoreIo.publish(file, path)
    }

    fn sync_dir(&self, dir: &Path) -> std::io::Result<()> {
        hold(&self.0.sync_pause);
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

    fn read_package(&self, path: &Path) -> std::io::Result<Option<Vec<u8>>> {
        let bytes = NativeStoreIo.read_package(path);
        hold(&self.0.read_pause);
        bytes
    }
}

fn faulty(dir: &Path) -> (Store, Arc<Faults>) {
    let faults = Arc::new(Faults::default());
    let store = Store::with_io(root(dir), Box::new(FaultyIo(Arc::clone(&faults))));
    (store, faults)
}

/// Package files on disk, counted directly.
fn package_files(dir: &Path) -> usize {
    fs::read_dir(root(dir).join("packages")).map_or(0, |entries| {
        entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".json"))
            .count()
    })
}

/// Another package from the quick-note fixture, with its own id and version.
fn package(number: usize, version: &str) -> String {
    quick(version).replacen(
        "\"id\": \"local.quick-note\"",
        &format!("\"id\": \"local.quick-note-{number}\""),
        1,
    )
}

fn hash_of(text: &str) -> String {
    hex(&sha256(text.as_bytes()))
}

fn storage_unavailable() -> ImportReply {
    ImportReply::Refused {
        reason: ImportRefusal::StorageUnavailable,
    }
}

fn set_aside(dir: &Path) -> PathBuf {
    root(dir).join("preferences.unreadable.json")
}

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/leadinglight/extensions/fixtures")
        .join(name);
    fs::read_to_string(path).unwrap()
}

fn quick(version: &str) -> String {
    fixture("quick-note.json").replacen(
        "\"version\": \"1.0.0\"",
        &format!("\"version\": \"{version}\""),
        1,
    )
}

fn root(dir: &Path) -> PathBuf {
    dir.join("extensions")
}

fn candidate(store: &Store, text: &str) -> String {
    match store.import(text) {
        ImportReply::Candidate { package_sha256, .. } => package_sha256,
        other => panic!("{other:?}"),
    }
}

fn entry(store: &Store, vault: &str, package_id: &str) -> InstalledExtension {
    store
        .list(vault)
        .into_iter()
        .find(|extension| extension.package_id == package_id)
        .unwrap()
}

#[test]
fn an_import_is_a_candidate_only() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(root(dir.path()));
    let sha = candidate(&store, &fixture("quick-note.json"));
    let ids: Vec<String> = store
        .list(VAULT)
        .into_iter()
        .map(|extension| extension.package_id)
        .collect();
    assert_eq!(
        ids,
        [BUNDLED, COMMENTARY, "leadinglight.website-capture", QUICK]
    );
    let quick = entry(&store, VAULT, QUICK);
    assert_eq!(quick.active_sha256, None);
    assert_eq!(
        quick.versions,
        [StoredVersion {
            package_sha256: sha.clone(),
            version: "1.0.0".to_string(),
            readable: true
        }]
    );
    assert_eq!(
        store.read(&sha),
        ReadReply::Ok {
            package_text: fixture("quick-note.json")
        }
    );
    assert_eq!(store.read(&"0".repeat(64)), ReadReply::Unknown);
    assert_eq!(
        store.admit(VAULT, &sha, "quick"),
        Err(RunRefusal::NotActive)
    );
    // The same bytes again are the same candidate.
    assert_eq!(candidate(&store, &fixture("quick-note.json")), sha);
    assert_eq!(entry(&store, VAULT, QUICK).versions.len(), 1);
}

#[test]
fn imports_cannot_claim_a_built_in_identity_or_skip_validation() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(root(dir.path()));
    let bundled_text = include_str!("bundled/meeting-debrief.json");
    assert_eq!(
        store.import(bundled_text),
        ImportReply::Refused {
            reason: ImportRefusal::ReservedId
        }
    );
    match store.import(&fixture("invalid/escaped-duplicate-key.json")) {
        ImportReply::Invalid { diagnostics } => assert_eq!(diagnostics.len(), 1),
        other => panic!("{other:?}"),
    }
    // This build performs every capability: commentary imports with nothing missing.
    match store.import(&fixture("passage-commentary.json")) {
        ImportReply::Candidate {
            missing_capabilities,
            ..
        } => assert!(missing_capabilities.is_empty(), "{missing_capabilities:?}"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn activation_is_compare_and_set_per_vault_and_rollback_restores_behaviour() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(root(dir.path()));
    let v1 = candidate(&store, &quick("1.0.0"));
    let v2 = candidate(&store, &quick("1.0.1"));
    assert!(matches!(
        store.activate(VAULT, QUICK, &v1, Some(&v2)),
        Err((ActivationRefusal::Changed, _))
    ));
    let on = store.activate(VAULT, QUICK, &v1, None).unwrap();
    assert_eq!((on.previous, on.replaced), (None, None));
    let update = store.activate(VAULT, QUICK, &v2, Some(&v1)).unwrap();
    assert_eq!(
        (update.previous.as_deref(), update.replaced.as_deref()),
        (Some(v1.as_str()), Some(v1.as_str()))
    );
    assert!(matches!(
        store.activate(VAULT, QUICK, &v1, Some(&v1)),
        Err((ActivationRefusal::Changed, _))
    ));
    let back = store.activate(VAULT, QUICK, &v1, Some(&v2)).unwrap();
    assert_eq!(back.previous.as_deref(), Some(v2.as_str()));
    assert_eq!(store.admit(VAULT, &v1, "quick"), Ok(QUICK.to_string()));
    assert_eq!(store.admit(VAULT, &v2, "quick"), Err(RunRefusal::NotActive));
    assert_eq!(
        store.admit("/other", &v1, "quick"),
        Err(RunRefusal::NotActive)
    );
    assert_eq!(entry(&store, "/other", QUICK).active_sha256, None);

    assert_eq!(
        store.deactivate(VAULT, QUICK, &v2),
        Err(DeactivationRefusal::Changed)
    );
    store.deactivate(VAULT, QUICK, &v1).unwrap();
    let off = entry(&store, VAULT, QUICK);
    assert_eq!(
        (off.active_sha256, off.previous_sha256.as_deref()),
        (None, Some(v1.as_str()))
    );

    // Activation survives a restart; nothing else is turned on by it.
    store.activate(VAULT, QUICK, &v2, None).unwrap();
    let reopened = Store::new(root(dir.path()));
    assert_eq!(
        entry(&reopened, VAULT, QUICK).active_sha256.as_deref(),
        Some(v2.as_str())
    );
    assert_eq!(entry(&reopened, VAULT, BUNDLED).active_sha256, None);
}

/// On a host without the desktop passage services commentary cannot be turned on; on this build,
/// which performs every capability, it can. Unknown versions never can.
#[test]
fn unsupported_or_unknown_versions_cannot_be_turned_on() {
    let dir = tempfile::tempdir().unwrap();
    let native_only = Store::with_host(
        root(dir.path()),
        Box::new(NativeStoreIo),
        NATIVE_CAPABILITIES.to_vec(),
    );
    let commentary = candidate(&native_only, &fixture("passage-commentary.json"));
    match native_only.activate(VAULT, "local.passage-commentary", &commentary, None) {
        Err((ActivationRefusal::MissingCapabilities, missing)) => assert_eq!(
            missing,
            [Capability::SelectionRead, Capability::AssociationResolve]
        ),
        _ => panic!("commentary must stay off without the desktop host services"),
    }
    drop(native_only);
    let store = Store::new(root(dir.path()));
    assert!(store
        .activate(VAULT, "local.passage-commentary", &commentary, None)
        .is_ok());
    assert!(matches!(
        store.activate(VAULT, QUICK, &commentary, None),
        Err((ActivationRefusal::UnknownVersion, _))
    ));
    assert!(matches!(
        store.activate(VAULT, QUICK, &"0".repeat(64), None),
        Err((ActivationRefusal::UnknownVersion, _))
    ));
}

#[test]
fn a_changed_package_file_is_refused_and_an_import_repairs_it() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(root(dir.path()));
    let sha = candidate(&store, &fixture("quick-note.json"));
    store.activate(VAULT, QUICK, &sha, None).unwrap();
    fs::write(store.blob_file(&sha), "{}").unwrap();
    assert!(!entry(&store, VAULT, QUICK).versions[0].readable);
    assert_eq!(store.read(&sha), ReadReply::Unreadable);
    assert_eq!(
        store.admit(VAULT, &sha, "quick"),
        Err(RunRefusal::Unreadable)
    );
    fs::remove_file(store.blob_file(&sha)).unwrap();
    assert_eq!(
        store.admit(VAULT, &sha, "quick"),
        Err(RunRefusal::Unreadable)
    );
    assert_eq!(candidate(&store, &fixture("quick-note.json")), sha);
    assert!(entry(&store, VAULT, QUICK).versions[0].readable);
    assert_eq!(store.admit(VAULT, &sha, "quick"), Ok(QUICK.to_string()));
}

#[test]
fn unreadable_preferences_are_set_aside_with_everything_off() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(root(dir.path()));
    let sha = candidate(&store, &fixture("quick-note.json"));
    store.activate(VAULT, QUICK, &sha, None).unwrap();
    let preferences = store.preferences_file();
    drop(store);
    fs::write(&preferences, "not json").unwrap();
    let reopened = Store::new(root(dir.path()));
    let quick = entry(&reopened, VAULT, QUICK);
    assert_eq!(quick.active_sha256, None);
    assert!(quick.versions[0].readable);
    assert!(root(dir.path())
        .join("preferences.unreadable.json")
        .exists());
    assert_eq!(
        reopened.admit(VAULT, &sha, "quick"),
        Err(RunRefusal::NotActive)
    );
}

#[test]
fn older_unused_versions_are_dropped_but_never_one_in_use() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(root(dir.path()));
    let first = candidate(&store, &quick("1.0.0"));
    store.activate(VAULT, QUICK, &first, None).unwrap();
    let second = candidate(&store, &quick("1.0.1"));
    for patch in 2..=MAX_VERSIONS_PER_PACKAGE {
        candidate(&store, &quick(&format!("1.0.{patch}")));
    }
    let versions: Vec<String> = entry(&store, VAULT, QUICK)
        .versions
        .into_iter()
        .map(|version| version.package_sha256)
        .collect();
    assert_eq!(versions.len(), MAX_VERSIONS_PER_PACKAGE);
    assert!(versions.contains(&first));
    assert!(!versions.contains(&second));
    assert!(!store.blob_file(&second).exists());
}

#[test]
fn the_bundled_debrief_is_off_until_turned_on() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(root(dir.path()));
    let sha = store.bundled_hash(BUNDLED).unwrap();
    let bundled = entry(&store, VAULT, BUNDLED);
    assert_eq!(bundled.active_sha256, None);
    assert_eq!(
        bundled.versions,
        [StoredVersion {
            package_sha256: sha.clone(),
            version: "1.0.0".to_string(),
            readable: true
        }]
    );
    assert_eq!(
        store.admit(VAULT, &sha, "new-debrief"),
        Err(RunRefusal::NotActive)
    );
    store.activate(VAULT, BUNDLED, &sha, None).unwrap();
    assert_eq!(
        store.admit(VAULT, &sha, "new-debrief"),
        Ok(BUNDLED.to_string())
    );
    assert_eq!(
        store.admit(VAULT, &sha, "other"),
        Err(RunRefusal::UnknownCommand)
    );
    assert_eq!(
        store.read(&sha),
        ReadReply::Ok {
            package_text: include_str!("bundled/meeting-debrief.json").to_string()
        }
    );
}

#[test]
fn a_store_that_cannot_be_written_refuses_honestly() {
    let dir = tempfile::tempdir().unwrap();
    let blocked = dir.path().join("blocked");
    fs::write(&blocked, "").unwrap();
    let store = Store::new(blocked.join("extensions"));
    assert_eq!(
        store.import(&fixture("quick-note.json")),
        ImportReply::Refused {
            reason: ImportRefusal::StorageUnavailable
        }
    );
    let sha = store.bundled_hash(BUNDLED).unwrap();
    assert!(matches!(
        store.activate(VAULT, BUNDLED, &sha, None),
        Err((ActivationRefusal::VaultUnavailable, _))
    ));
    assert_eq!(entry(&store, VAULT, BUNDLED).active_sha256, None);
}

// --- Publication, preference bounds and package-file bounds --------------------------------------

/// Review finding 1: a change whose rename succeeded stays in place when its folder sync fails.
/// The store answers it, admission follows it, a restart finds it, and its package file stays.
#[test]
fn a_change_in_place_is_kept_when_its_folder_cannot_be_synced() {
    let dir = tempfile::tempdir().unwrap();
    let (store, faults) = faulty(dir.path());
    faults.unsynced.store(true, Ordering::SeqCst);
    let sha = candidate(&store, &fixture("quick-note.json"));
    let on = store.activate(VAULT, QUICK, &sha, None).unwrap();
    assert_eq!((on.previous, on.replaced), (None, None));
    assert_eq!(store.admit(VAULT, &sha, "quick"), Ok(QUICK.to_string()));
    let restarted = Store::new(root(dir.path()));
    assert_eq!(
        entry(&restarted, VAULT, QUICK).active_sha256.as_deref(),
        Some(sha.as_str())
    );

    store.deactivate(VAULT, QUICK, &sha).unwrap();
    assert_eq!(
        store.admit(VAULT, &sha, "quick"),
        Err(RunRefusal::NotActive)
    );
    let restarted = Store::new(root(dir.path()));
    let off = entry(&restarted, VAULT, QUICK);
    assert_eq!(
        (off.active_sha256, off.previous_sha256.as_deref()),
        (None, Some(sha.as_str()))
    );
    assert!(off.versions[0].readable);
    assert!(!set_aside(dir.path()).exists());
}

/// A change whose rename failed is refused, and nothing it would have changed has changed: not
/// the file, not the cached state, and no package file is left behind.
#[test]
fn a_change_that_was_not_published_is_refused_and_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (store, faults) = faulty(dir.path());
    let v1 = candidate(&store, &quick("1.0.0"));
    let v2 = candidate(&store, &quick("1.0.1"));
    store.activate(VAULT, QUICK, &v1, None).unwrap();
    let before = fs::read(store.preferences_file()).unwrap();
    faults.unpublished.store(true, Ordering::SeqCst);
    assert!(matches!(
        store.activate(VAULT, QUICK, &v2, Some(&v1)),
        Err((ActivationRefusal::VaultUnavailable, _))
    ));
    assert_eq!(
        store.deactivate(VAULT, QUICK, &v1),
        Err(DeactivationRefusal::VaultUnavailable)
    );
    let v3 = quick("1.0.2");
    assert_eq!(store.import(&v3), storage_unavailable());
    assert!(!store.blob_file(&hash_of(&v3)).exists());
    assert_eq!(fs::read(store.preferences_file()).unwrap(), before);
    let listed = entry(&store, VAULT, QUICK);
    assert_eq!(listed.active_sha256.as_deref(), Some(v1.as_str()));
    assert_eq!(listed.versions.len(), 2);
    assert_eq!(store.admit(VAULT, &v1, "quick"), Ok(QUICK.to_string()));
    assert_eq!(store.admit(VAULT, &v2, "quick"), Err(RunRefusal::NotActive));
}

/// Review finding 2: well-formed JSON that breaks a bound or an identity rule is set aside like
/// unreadable text, with every extension off. Nothing it says is acted on, and the store that
/// replaces it works.
#[test]
fn preferences_outside_their_bounds_are_set_aside_with_everything_off() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(root(dir.path()));
    let sha = candidate(&store, &fixture("quick-note.json"));
    store.activate(VAULT, QUICK, &sha, None).unwrap();
    let path = store.preferences_file();
    drop(store);
    let valid: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let long_vault = format!("/{}", "v".repeat(MAX_VAULT_KEY_BYTES));
    let mut files: Vec<(&str, Vec<u8>)> = Vec::new();
    let mut case = |name: &'static str, change: &dyn Fn(&mut Value)| {
        let mut value = valid.clone();
        change(&mut value);
        files.push((name, serde_json::to_vec(&value).unwrap()));
    };
    case(
        "a sequence number at the end of u64",
        &|value: &mut Value| value["nextSeq"] = json!(u64::MAX),
    );
    case(
        "a sequence number not past an import",
        &|value: &mut Value| value["nextSeq"] = json!(1),
    );
    case("a vault touched in the future", &|value: &mut Value| {
        value["vaults"][VAULT]["touched"] = json!(1_u64 << 40)
    });
    case("an import listed twice", &|value: &mut Value| {
        let import = value["imports"][0].clone();
        value["imports"].as_array_mut().unwrap().push(import);
    });
    case("a path where a hash belongs", &|value: &mut Value| {
        value["imports"][0]["packageSha256"] = json!("../../../escape")
    });
    case("an import with a reserved id", &|value: &mut Value| {
        value["imports"][0]["packageId"] = json!(BUNDLED)
    });
    case("an overlong name", &|value: &mut Value| {
        value["imports"][0]["name"] = json!("n".repeat(201))
    });
    case("too many imports", &|value: &mut Value| {
        value["nextSeq"] = json!(1000);
        let imports = value["imports"].as_array_mut().unwrap();
        for number in 0..MAX_STORED_VERSIONS {
            imports.push(json!({
                "packageSha256": format!("{number:064x}"),
                "packageId": format!("local.filler-{number}"),
                "version": "1.0.0",
                "name": "Filler",
                "seq": 100 + number,
            }));
        }
    });
    case("an active version never stored", &|value: &mut Value| {
        value["vaults"][VAULT]["active"][QUICK] = json!("0".repeat(64))
    });
    case("an overlong vault path", &|value: &mut Value| {
        let entry = value["vaults"][VAULT].clone();
        value["vaults"][long_vault.as_str()] = entry;
    });
    case("an unknown field", &|value: &mut Value| {
        value["unexpected"] = json!(true)
    });
    let mut padded = serde_json::to_vec(&valid).unwrap();
    padded.resize(MAX_PREFERENCES_BYTES + 1, b' ');
    files.push(("more bytes than the bound", padded));

    for (name, bytes) in files {
        fs::write(&path, bytes).unwrap();
        let _ = fs::remove_file(set_aside(dir.path()));
        let reopened = Store::new(root(dir.path()));
        let listed = entry(&reopened, VAULT, QUICK);
        assert_eq!(listed.active_sha256, None, "{name}");
        assert!(listed.versions[0].readable, "{name}");
        assert_eq!(
            reopened.admit(VAULT, &sha, "quick"),
            Err(RunRefusal::NotActive),
            "{name}"
        );
        assert!(set_aside(dir.path()).exists(), "{name}");
        reopened.activate(VAULT, QUICK, &sha, None).unwrap();
    }
    // The file every case started from loads, with its activation.
    fs::write(&path, serde_json::to_vec(&valid).unwrap()).unwrap();
    let reopened = Store::new(root(dir.path()));
    assert_eq!(
        entry(&reopened, VAULT, QUICK).active_sha256.as_deref(),
        Some(sha.as_str())
    );
}

/// Sequence numbers are checked: at the last one every change is refused, and nothing wraps.
#[test]
fn a_store_out_of_sequence_numbers_refuses_changes_and_keeps_its_state() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(root(dir.path()));
    let sha = candidate(&store, &fixture("quick-note.json"));
    store.activate(VAULT, QUICK, &sha, None).unwrap();
    let path = store.preferences_file();
    drop(store);
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["nextSeq"] = json!(MAX_SEQ);
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();

    let store = Store::new(root(dir.path()));
    assert_eq!(
        entry(&store, VAULT, QUICK).active_sha256.as_deref(),
        Some(sha.as_str())
    );
    let newer = quick("1.0.1");
    assert_eq!(store.import(&newer), storage_unavailable());
    assert!(!store.blob_file(&hash_of(&newer)).exists());
    let bundled = store.bundled_hash(BUNDLED).unwrap();
    assert!(matches!(
        store.activate(VAULT, BUNDLED, &bundled, None),
        Err((ActivationRefusal::VaultUnavailable, _))
    ));
    assert_eq!(
        store.deactivate(VAULT, QUICK, &sha),
        Err(DeactivationRefusal::VaultUnavailable)
    );
    assert_eq!(store.admit(VAULT, &sha, "quick"), Ok(QUICK.to_string()));
    assert!(!set_aside(dir.path()).exists());
}

/// A stored version whose file is missing stays listed as unreadable after a restart. Its
/// activation is kept as recorded, admits nothing, and is never made up from files found.
#[test]
fn a_missing_package_stays_listed_and_unreadable_after_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(root(dir.path()));
    let sha = candidate(&store, &fixture("quick-note.json"));
    store.activate(VAULT, QUICK, &sha, None).unwrap();
    fs::remove_file(store.blob_file(&sha)).unwrap();
    drop(store);
    let reopened = Store::new(root(dir.path()));
    let listed = entry(&reopened, VAULT, QUICK);
    assert_eq!(listed.active_sha256.as_deref(), Some(sha.as_str()));
    assert_eq!(
        listed.versions,
        [StoredVersion {
            package_sha256: sha.clone(),
            version: "1.0.0".to_string(),
            readable: false
        }]
    );
    assert_eq!(
        reopened.admit(VAULT, &sha, "quick"),
        Err(RunRefusal::Unreadable)
    );
    assert_eq!(reopened.read(&sha), ReadReply::Unreadable);
    assert!(!set_aside(dir.path()).exists());
}

/// A rebuild from files keeps the version bounds. Versions beyond them stay unlisted and are
/// removed before the next new package file; a folder with more entries than one pass reads
/// takes no new file.
#[test]
fn a_rebuild_stays_within_the_bounds_and_excess_files_are_reconciled() {
    let dir = tempfile::tempdir().unwrap();
    let packages = root(dir.path()).join("packages");
    fs::create_dir_all(&packages).unwrap();
    let ids = MAX_STORED_VERSIONS / MAX_VERSIONS_PER_PACKAGE;
    for number in 0..ids {
        for patch in 0..=MAX_VERSIONS_PER_PACKAGE {
            let text = package(number, &format!("1.0.{patch}"));
            fs::write(packages.join(format!("{}.json", hash_of(&text))), text).unwrap();
        }
    }
    let store = Store::new(root(dir.path()));
    let listed = store.list(VAULT);
    let imported: Vec<&InstalledExtension> = listed
        .iter()
        .filter(|extension| !extension.package_id.starts_with("leadinglight."))
        .collect();
    assert_eq!(imported.len(), ids);
    assert!(imported.iter().all(|extension| {
        extension.versions.len() == MAX_VERSIONS_PER_PACKAGE && extension.active_sha256.is_none()
    }));
    assert_eq!(
        package_files(dir.path()),
        ids * (MAX_VERSIONS_PER_PACKAGE + 1)
    );

    candidate(&store, &package(ids, "1.0.0"));
    assert_eq!(package_files(dir.path()), MAX_STORED_VERSIONS);

    for junk in 0..MAX_SCANNED_ENTRIES {
        fs::write(packages.join(format!("junk-{junk}")), "").unwrap();
    }
    let next = package(ids + 1, "1.0.0");
    assert_eq!(store.import(&next), storage_unavailable());
    assert!(!store.blob_file(&hash_of(&next)).exists());
    assert_eq!(package_files(dir.path()), MAX_STORED_VERSIONS);
    for junk in 0..MAX_SCANNED_ENTRIES {
        fs::remove_file(packages.join(format!("junk-{junk}"))).unwrap();
    }
    candidate(&store, &next);
    assert_eq!(package_files(dir.path()), MAX_STORED_VERSIONS);
}

/// Review finding 3: an import whose preferences were not published removes the package file it
/// added. When that removal fails too, the files left behind count, so new files stop at the
/// bound however many imports fail. Versions in use are never removed.
#[test]
fn failed_imports_cannot_grow_the_package_folder() {
    let dir = tempfile::tempdir().unwrap();
    let (store, faults) = faulty(dir.path());
    let v1 = candidate(&store, &quick("1.0.0"));
    store.activate(VAULT, QUICK, &v1, None).unwrap();
    let v2 = candidate(&store, &quick("1.0.1"));
    store.activate(VAULT, QUICK, &v2, Some(&v1)).unwrap();
    assert_eq!(package_files(dir.path()), 2);

    faults.unpublished.store(true, Ordering::SeqCst);
    for number in 0..20 {
        assert_eq!(
            store.import(&package(number, "1.0.0")),
            storage_unavailable()
        );
    }
    assert_eq!(package_files(dir.path()), 2);

    faults.stuck.store(true, Ordering::SeqCst);
    for number in 20..40 + MAX_STORED_VERSIONS {
        assert_eq!(
            store.import(&package(number, "1.0.0")),
            storage_unavailable()
        );
        assert!(package_files(dir.path()) <= MAX_STORED_VERSIONS + 1);
    }
    assert_eq!(package_files(dir.path()), MAX_STORED_VERSIONS + 1);
    assert_eq!(store.admit(VAULT, &v2, "quick"), Ok(QUICK.to_string()));
    assert!(matches!(store.read(&v1), ReadReply::Ok { .. }));

    faults.stuck.store(false, Ordering::SeqCst);
    faults.unpublished.store(false, Ordering::SeqCst);
    let v3 = candidate(&store, &quick("1.0.2"));
    assert_eq!(package_files(dir.path()), 3);
    for sha in [&v1, &v2, &v3] {
        assert!(store.blob_file(sha).exists());
    }
}

/// A version dropped at import whose file cannot be removed still counts: no new file is written
/// until it is gone, and the version in use is never the one dropped.
#[test]
fn a_failed_prune_is_counted_until_its_file_is_removed() {
    let dir = tempfile::tempdir().unwrap();
    let (store, faults) = faulty(dir.path());
    let ids = MAX_STORED_VERSIONS / MAX_VERSIONS_PER_PACKAGE;
    for number in 0..ids {
        for patch in 0..MAX_VERSIONS_PER_PACKAGE {
            candidate(&store, &package(number, &format!("1.0.{patch}")));
        }
    }
    let oldest = hash_of(&package(0, "1.0.0"));
    store
        .activate(VAULT, "local.quick-note-0", &oldest, None)
        .unwrap();
    assert_eq!(package_files(dir.path()), MAX_STORED_VERSIONS);

    faults.stuck.store(true, Ordering::SeqCst);
    candidate(&store, &package(ids, "1.0.0"));
    assert_eq!(package_files(dir.path()), MAX_STORED_VERSIONS + 1);
    for number in ids + 1..ids + 10 {
        assert_eq!(
            store.import(&package(number, "1.0.0")),
            storage_unavailable()
        );
    }
    assert_eq!(package_files(dir.path()), MAX_STORED_VERSIONS + 1);
    assert_eq!(
        store.admit(VAULT, &oldest, "quick"),
        Ok("local.quick-note-0".to_string())
    );

    faults.stuck.store(false, Ordering::SeqCst);
    candidate(&store, &package(ids + 1, "1.0.0"));
    assert_eq!(package_files(dir.path()), MAX_STORED_VERSIONS);
    assert!(store.blob_file(&oldest).exists());
}

/// Acceptance review: an activation checks that its version is stored and reads its bytes outside
/// the preference lock. An import that drops that version meanwhile makes it `unknownVersion`, so
/// nothing names a version that is not stored and the preferences still load after a restart.
#[test]
fn a_version_dropped_while_its_activation_is_checked_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (store, faults) = faulty(dir.path());
    let store = Arc::new(store);
    let oldest = candidate(&store, &quick("1.0.0"));
    for patch in 1..MAX_VERSIONS_PER_PACKAGE {
        candidate(&store, &quick(&format!("1.0.{patch}")));
    }

    // Held after its membership check and with the bytes read, before it takes the lock again.
    let (started, release) = faults.pause_next_read();
    let activation = {
        let store = Arc::clone(&store);
        let oldest = oldest.clone();
        thread::spawn(move || store.activate(VAULT, QUICK, &oldest, None))
    };
    started.recv().unwrap();
    // One more version drops the oldest, which no vault uses.
    let newest = candidate(&store, &quick(&format!("1.0.{MAX_VERSIONS_PER_PACKAGE}")));
    assert!(!store.blob_file(&oldest).exists());
    release.send(()).unwrap();

    assert!(matches!(
        activation.join().unwrap(),
        Err((ActivationRefusal::UnknownVersion, _))
    ));
    let listed = entry(&store, VAULT, QUICK);
    assert_eq!(listed.active_sha256, None);
    assert!(listed
        .versions
        .iter()
        .all(|version| version.package_sha256 != oldest));
    assert_eq!(
        store.admit(VAULT, &oldest, "quick"),
        Err(RunRefusal::NotActive)
    );
    // Compare-and-set is unchanged for a version still stored.
    store.activate(VAULT, QUICK, &newest, None).unwrap();

    let restarted = Store::new(root(dir.path()));
    let listed = entry(&restarted, VAULT, QUICK);
    assert_eq!(listed.active_sha256.as_deref(), Some(newest.as_str()));
    assert_eq!(listed.versions.len(), MAX_VERSIONS_PER_PACKAGE);
    assert!(!set_aside(dir.path()).exists());
}

// --- The bundled commentary: on by default where it can run, an explicit Off kept ---------------

/// A host whose desktop services are qualified, so every capability is supported.
fn full_host(dir: &Path) -> Store {
    Store::with_host(root(dir), Box::new(NativeStoreIo), Capability::ALL.to_vec())
}

#[test]
fn the_bundled_commentary_stays_off_while_its_host_services_are_not_qualified() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::with_host(
        root(dir.path()),
        Box::new(NativeStoreIo),
        NATIVE_CAPABILITIES.to_vec(),
    );
    let sha = store.bundled_hash(COMMENTARY).unwrap();
    assert_eq!(entry(&store, VAULT, COMMENTARY).active_sha256, None);
    assert_eq!(
        store.admit(VAULT, &sha, "comment"),
        Err(RunRefusal::NotActive)
    );
    match store.activate(VAULT, COMMENTARY, &sha, None) {
        Err((ActivationRefusal::MissingCapabilities, missing)) => assert_eq!(
            missing,
            [Capability::SelectionRead, Capability::AssociationResolve]
        ),
        other => panic!("{:?}", other.err()),
    }
}

#[test]
fn the_bundled_commentary_is_on_by_default_where_its_host_can_run_it() {
    let dir = tempfile::tempdir().unwrap();
    let store = full_host(dir.path());
    let sha = store.bundled_hash(COMMENTARY).unwrap();
    let listed = entry(&store, VAULT, COMMENTARY);
    assert_eq!(listed.active_sha256.as_deref(), Some(sha.as_str()));
    assert_eq!(listed.previous_sha256, None);
    assert_eq!(
        store.admit(VAULT, &sha, "comment"),
        Ok(COMMENTARY.to_string())
    );
    // Nothing was written to make it so, and the debrief stays off.
    assert!(!store.preferences_file().exists());
    assert_eq!(entry(&store, VAULT, BUNDLED).active_sha256, None);
    // It is on already: activation must name it, and then changes nothing.
    assert!(matches!(
        store.activate(VAULT, COMMENTARY, &sha, None),
        Err((ActivationRefusal::Changed, _))
    ));
    let same = store.activate(VAULT, COMMENTARY, &sha, Some(&sha)).unwrap();
    assert_eq!(same.replaced, None);
    assert_eq!(
        store.read(&sha),
        ReadReply::Ok {
            package_text: include_str!("bundled/passage-commentary.json").to_string()
        }
    );
}

#[test]
fn an_explicit_off_survives_restarts_and_app_updates_and_can_be_undone() {
    let dir = tempfile::tempdir().unwrap();
    let store = full_host(dir.path());
    let sha = store.bundled_hash(COMMENTARY).unwrap();
    store.deactivate(VAULT, COMMENTARY, &sha).unwrap();
    let off = entry(&store, VAULT, COMMENTARY);
    assert_eq!(
        (off.active_sha256, off.previous_sha256.as_deref()),
        (None, Some(sha.as_str()))
    );
    assert_eq!(
        store.admit(VAULT, &sha, "comment"),
        Err(RunRefusal::NotActive)
    );
    assert_eq!(
        store.deactivate(VAULT, COMMENTARY, &sha),
        Err(DeactivationRefusal::Changed)
    );
    // Other vaults keep the default.
    assert_eq!(
        entry(&store, "/other", COMMENTARY).active_sha256.as_deref(),
        Some(sha.as_str())
    );
    drop(store);
    assert_eq!(
        entry(&full_host(dir.path()), VAULT, COMMENTARY).active_sha256,
        None
    );

    // An update that ships changed commentary bytes keeps the Off, moved to the shipped version.
    let path = root(dir.path()).join("preferences.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["vaults"][VAULT]["previous"][COMMENTARY] = json!("0".repeat(64));
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    let updated = full_host(dir.path());
    let off = entry(&updated, VAULT, COMMENTARY);
    assert_eq!(
        (off.active_sha256, off.previous_sha256.as_deref()),
        (None, Some(sha.as_str()))
    );
    assert!(!set_aside(dir.path()).exists());

    // Turning it on again is an ordinary activation from off.
    let on = updated.activate(VAULT, COMMENTARY, &sha, None).unwrap();
    assert_eq!(on.replaced, None);
    let listed = entry(&updated, VAULT, COMMENTARY);
    assert_eq!(
        (listed.active_sha256.as_deref(), listed.previous_sha256),
        (Some(sha.as_str()), None)
    );
}

/// A vault whose only record is the Off is not idle: forgetting it would turn commentary on there.
#[test]
fn a_vault_holding_an_explicit_off_is_never_forgotten_to_make_room() {
    let dir = tempfile::tempdir().unwrap();
    let store = full_host(dir.path());
    let commentary = store.bundled_hash(COMMENTARY).unwrap();
    store.deactivate(VAULT, COMMENTARY, &commentary).unwrap();
    let quick = candidate(&store, &fixture("quick-note.json"));
    for number in 1..MAX_VAULTS {
        let vault = format!("/vault-{number}");
        store.activate(&vault, QUICK, &quick, None).unwrap();
        store.deactivate(&vault, QUICK, &quick).unwrap();
    }
    store.activate("/new", QUICK, &quick, None).unwrap();
    let off = entry(&store, VAULT, COMMENTARY);
    assert_eq!(
        (off.active_sha256, off.previous_sha256.as_deref()),
        (None, Some(commentary.as_str()))
    );
    // The least recently touched idle vault went instead.
    assert_eq!(entry(&store, "/vault-1", QUICK).previous_sha256, None);
}
