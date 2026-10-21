//! The local package store. Package bytes are immutable files named by their SHA-256 under the
//! app's local configuration folder; which version is active in which vault is one preferences
//! file beside them, keyed by the vault's resolved path. Nothing here reads or writes a vault.
//!
//! Every use re-reads the stored bytes, checks their hash and validates them again. A missing,
//! changed or invalid package is reported unreadable and is never activated or admitted.
//!
//! A preferences change is published by one rename. A failed rename leaves the file and the
//! cached state as they were, and the change is refused. Once the rename succeeds the cache
//! follows it, and the folder entry is synced afterwards, outside the lock. A failed sync is only
//! a local warning: the replies report the current state and promise nothing about power loss.
//!
//! The preferences file is read within a byte bound and must keep every bound and identity rule
//! this store writes by; anything else is set aside and every extension starts off. Package files
//! are bounded too. Before a new one is written, files no stored version names are removed; one
//! that cannot be removed still counts, so failed cleanups stop new files instead of piling up.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

use super::json::MAX_PACKAGE_BYTES;
use super::manifest::{self, missing_from, Capability, Manifest, RESERVED_PREFIX};
use super::wire::{
    ActivationRefusal, DeactivationRefusal, ImportRefusal, ImportReply, InstalledExtension,
    ReadReply, RunRefusal, StoredVersion,
};
use super::{hex, is_sha256_hex};
use crate::vault::staged_file::{sha256, NativePlatform, Platform};

/// Older unreferenced versions beyond these are dropped at import; active and previous
/// versions in any vault are never dropped, so an import that would need to is refused.
pub(crate) const MAX_VERSIONS_PER_PACKAGE: usize = 8;
pub(crate) const MAX_STORED_VERSIONS: usize = 64;
/// Vaults with remembered activation; one with nothing active is forgotten first.
pub(crate) const MAX_VAULTS: usize = 64;
/// A vault's resolved path as a preferences key; a longer one cannot be turned on.
pub(crate) const MAX_VAULT_KEY_BYTES: usize = 4096;
/// Room for every bound above at its longest, escaped. Larger files are never read, and a change
/// that would write one is refused.
pub(crate) const MAX_PREFERENCES_BYTES: usize = 4 * 1024 * 1024;
/// Entries of the package folder one pass looks at. A fuller folder takes no new package file,
/// and a rebuild lists only what this many entries hold.
pub(crate) const MAX_SCANNED_ENTRIES: usize = 4 * MAX_STORED_VERSIONS;
/// Sequence numbers stay exact for any JSON reader; a change that needs a later one is refused.
pub(crate) const MAX_SEQ: u64 = 1 << 53;

const PREFERENCES: &str = "preferences.json";
const SET_ASIDE: &str = "preferences.unreadable.json";
const PACKAGES: &str = "packages";
const FORMAT: u32 = 1;

/// Packages shipped with the app, and whether each is on in a vault that never chose. One that
/// is on by default is on only while this host supports everything it needs.
const BUNDLED: &[(&str, bool)] = &[
    (include_str!("bundled/meeting-debrief.json"), false),
    (include_str!("bundled/passage-commentary.json"), true),
    (include_str!("bundled/website-capture.json"), true),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Preferences {
    format: u32,
    next_seq: u64,
    imports: Vec<Imported>,
    vaults: BTreeMap<String, VaultPreferences>,
}

/// One stored version; names and versions only, never note text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Imported {
    package_sha256: String,
    package_id: String,
    version: String,
    name: String,
    seq: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultPreferences {
    touched: u64,
    /// Package id to the active version's hash.
    active: BTreeMap<String, String>,
    /// Package id to the version active before: the target of a behaviour rollback.
    previous: BTreeMap<String, String>,
}

struct Bundled {
    sha256: String,
    text: &'static str,
    manifest: Manifest,
    default_on: bool,
}

enum Unusable {
    Unreadable,
    Invalid,
}

/// The change an activation made, for its reply and for revoking runs.
pub(crate) struct Activated {
    pub(crate) previous: Option<String>,
    /// The version that was active before, when another one was.
    pub(crate) replaced: Option<String>,
}

/// The filesystem effects tests replace; reading preferences and listing folders are ordinary
/// filesystem work.
pub(crate) trait StoreIo: Send + Sync {
    /// Puts a fully written file at `path` in one rename. An error means `path` is unchanged.
    fn publish(&self, file: NamedTempFile, path: &Path) -> std::io::Result<()>;
    fn sync_dir(&self, dir: &Path) -> std::io::Result<()>;
    fn remove_file(&self, path: &Path) -> std::io::Result<()>;
    /// A package file's bytes within `MAX_PACKAGE_BYTES`; `None` when there is no file.
    fn read_package(&self, path: &Path) -> std::io::Result<Option<Vec<u8>>>;
}

pub(crate) struct NativeStoreIo;

impl StoreIo for NativeStoreIo {
    fn read_package(&self, path: &Path) -> std::io::Result<Option<Vec<u8>>> {
        read_bounded(path, MAX_PACKAGE_BYTES)
    }

    fn publish(&self, file: NamedTempFile, path: &Path) -> std::io::Result<()> {
        file.persist(path).map(drop).map_err(|error| error.error)
    }

    fn sync_dir(&self, dir: &Path) -> std::io::Result<()> {
        NativePlatform.sync_dir(dir)
    }

    fn remove_file(&self, path: &Path) -> std::io::Result<()> {
        fs::remove_file(path)
    }
}

pub(crate) struct Store {
    root: PathBuf,
    io: Box<dyn StoreIo>,
    preferences: Mutex<Option<Preferences>>,
    bundled: Vec<Bundled>,
    /// What this host performs; a package needing anything else cannot be turned on.
    host: Vec<Capability>,
}

impl Store {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self::with_io(root, Box::new(NativeStoreIo))
    }

    pub(crate) fn with_io(root: PathBuf, io: Box<dyn StoreIo>) -> Self {
        Self::with_host(root, io, manifest::host_capabilities())
    }

    pub(crate) fn with_host(root: PathBuf, io: Box<dyn StoreIo>, host: Vec<Capability>) -> Self {
        let bundled = BUNDLED
            .iter()
            .copied()
            .filter_map(|(text, default_on)| match manifest::validate(text) {
                Ok(manifest) => Some(Bundled {
                    sha256: hex(&sha256(text.as_bytes())),
                    text,
                    manifest,
                    default_on,
                }),
                Err(diagnostics) => {
                    log::error!("A bundled extension package is invalid: {diagnostics:?}");
                    None
                }
            })
            .collect();
        Self {
            root,
            io,
            preferences: Mutex::new(None),
            bundled,
            host,
        }
    }

    fn missing(&self, needed: &[Capability]) -> Vec<Capability> {
        missing_from(needed, &self.host)
    }

    /// The built-ins on in a vault that never chose, with their hashes.
    fn default_on(&self) -> impl Iterator<Item = (&str, &str)> {
        self.bundled
            .iter()
            .filter(move |bundled| {
                bundled.default_on && self.missing(&bundled.manifest.capabilities).is_empty()
            })
            .map(|bundled| (bundled.manifest.id.as_str(), bundled.sha256.as_str()))
    }

    /// The version active for a package in a vault: the one turned on there, or a built-in that
    /// is on by default and was never turned off there. Turning a package off records it as
    /// `previous`, which is what keeps a default-on built-in off.
    fn active_in(&self, entry: Option<&VaultPreferences>, package_id: &str) -> Option<String> {
        if let Some(active) = entry.and_then(|entry| entry.active.get(package_id)) {
            return Some(active.clone());
        }
        let chose_off = entry.is_some_and(|entry| entry.previous.contains_key(package_id));
        self.default_on()
            .find(|(id, _)| *id == package_id && !chose_off)
            .map(|(_, sha)| sha.to_string())
    }

    /// A vault whose only record is an Off for a default-on built-in is not idle: forgetting it
    /// would turn that built-in back on there.
    fn holds_choice(&self, entry: &VaultPreferences) -> bool {
        !entry.active.is_empty()
            || self.bundled.iter().any(|bundled| {
                bundled.default_on && entry.previous.contains_key(&bundled.manifest.id)
            })
    }

    fn with_preferences<T>(&self, work: impl FnOnce(&mut Preferences) -> T) -> T {
        let mut guard = self
            .preferences
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let preferences = guard.get_or_insert_with(|| self.load());
        work(preferences)
    }

    fn blob_path(&self, sha: &str) -> PathBuf {
        self.root.join(PACKAGES).join(format!("{sha}.json"))
    }

    fn bundled(&self, sha: &str) -> Option<&Bundled> {
        self.bundled.iter().find(|bundled| bundled.sha256 == sha)
    }

    fn is_bundled(&self, package_id: &str, sha: &str) -> bool {
        self.bundled(sha)
            .is_some_and(|bundled| bundled.manifest.id == package_id)
    }

    // --- Preferences ------------------------------------------------------------------------------

    /// Missing: every extension off, the stored versions found again from their files. Unreadable,
    /// too large, another format or outside any bound: the same, with the file set aside. Nothing
    /// is ever activated by this.
    fn load(&self) -> Preferences {
        let path = self.root.join(PREFERENCES);
        match read_bounded(&path, MAX_PREFERENCES_BYTES) {
            Ok(None) => return self.rebuilt(),
            Ok(Some(bytes)) => {
                let loaded = serde_json::from_slice::<Preferences>(&bytes)
                    .ok()
                    .and_then(|preferences| self.checked(preferences));
                if let Some(preferences) = loaded {
                    return preferences;
                }
            }
            Err(error) => log::warn!("Extension preferences are unavailable: {error}"),
        }
        log::warn!(
            "Extension preferences could not be used; every extension is off until turned on again."
        );
        let _ = fs::rename(&path, self.root.join(SET_ASIDE));
        self.rebuilt()
    }

    /// The loaded preferences, if they keep every rule this store writes by. An activation of a
    /// bundled version this app no longer ships is dropped, so that package is off in that vault.
    fn checked(&self, mut preferences: Preferences) -> Option<Preferences> {
        let next_seq = preferences.next_seq;
        if preferences.format != FORMAT
            || !(1..=MAX_SEQ).contains(&next_seq)
            || preferences.imports.len() > MAX_STORED_VERSIONS
            || preferences.vaults.len() > MAX_VAULTS
        {
            return None;
        }
        let mut hashes = HashSet::new();
        let mut seqs = HashSet::new();
        let mut per_package: HashMap<&str, usize> = HashMap::new();
        for import in &preferences.imports {
            let versions = per_package.entry(import.package_id.as_str()).or_default();
            *versions += 1;
            let fits = is_sha256_hex(&import.package_sha256)
                && manifest::valid_identity(&import.package_id, &import.version, &import.name)
                && !import.package_id.starts_with(RESERVED_PREFIX)
                && *versions <= MAX_VERSIONS_PER_PACKAGE
                && import.seq < next_seq
                && hashes.insert(import.package_sha256.as_str())
                && seqs.insert(import.seq);
            if !fits {
                return None;
            }
        }
        let stored: HashSet<(&str, &str)> = preferences
            .imports
            .iter()
            .map(|import| (import.package_id.as_str(), import.package_sha256.as_str()))
            .collect();
        for (vault, entry) in &mut preferences.vaults {
            if vault.is_empty()
                || vault.len() > MAX_VAULT_KEY_BYTES
                || vault.contains('\0')
                || entry.touched >= next_seq
            {
                return None;
            }
            // A default-on built-in keeps an explicit Off across app updates: its Off moves forward
            // to the version this app ships instead of being dropped with the old version.
            for bundled in self.bundled.iter().filter(|bundled| bundled.default_on) {
                let id = &bundled.manifest.id;
                let stale_off = entry
                    .previous
                    .get(id)
                    .is_some_and(|sha| is_sha256_hex(sha) && *sha != bundled.sha256);
                if stale_off && !entry.active.contains_key(id) {
                    entry.previous.insert(id.clone(), bundled.sha256.clone());
                }
            }
            for versions in [&mut entry.active, &mut entry.previous] {
                let shaped = versions.iter().all(|(package_id, sha)| {
                    manifest::valid_package_id(package_id) && is_sha256_hex(sha)
                });
                if !shaped {
                    return None;
                }
                versions.retain(|package_id, sha| {
                    let gone = package_id.starts_with(RESERVED_PREFIX)
                        && !self.is_bundled(package_id, sha);
                    if gone {
                        log::warn!("A built-in extension changed with this app; it is off until turned on again.");
                    }
                    !gone
                });
                let known = versions.iter().all(|(package_id, sha)| {
                    self.is_bundled(package_id, sha)
                        || stored.contains(&(package_id.as_str(), sha.as_str()))
                });
                if !known {
                    return None;
                }
            }
            let repeated = entry
                .active
                .iter()
                .any(|(package_id, sha)| entry.previous.get(package_id) == Some(sha));
            if repeated {
                return None;
            }
        }
        Some(preferences)
    }

    /// Every extension off, with the stored versions found again from their files: the first
    /// `MAX_SCANNED_ENTRIES` folder entries are read, in name order up to the version bounds.
    /// Files beyond that stay unlisted, and the next reconciliation removes them.
    fn rebuilt(&self) -> Preferences {
        let mut preferences = Preferences {
            format: FORMAT,
            next_seq: 1,
            imports: Vec::new(),
            vaults: BTreeMap::new(),
        };
        let Ok(entries) = fs::read_dir(self.root.join(PACKAGES)) else {
            return preferences;
        };
        let mut hashes: Vec<String> = Vec::new();
        for (examined, entry) in entries.enumerate() {
            if examined == MAX_SCANNED_ENTRIES {
                log::warn!("The extension package folder holds more entries than are read back; the rest stay unlisted.");
                break;
            }
            if let Some(sha) = entry
                .ok()
                .and_then(|entry| package_name(&entry.file_name()))
            {
                hashes.push(sha);
            }
        }
        hashes.sort();
        let mut per_package: HashMap<String, usize> = HashMap::new();
        for sha in hashes {
            if preferences.imports.len() == MAX_STORED_VERSIONS {
                log::warn!(
                    "More extension packages were found than are kept; the rest stay unlisted."
                );
                break;
            }
            let Ok((_, manifest)) = self.verified(&sha) else {
                continue;
            };
            let versions = per_package.entry(manifest.id.clone()).or_default();
            if manifest.id.starts_with(RESERVED_PREFIX) || *versions == MAX_VERSIONS_PER_PACKAGE {
                continue;
            }
            *versions += 1;
            let Some(seq) = take_seq(&mut preferences) else {
                break;
            };
            preferences.imports.push(Imported {
                package_sha256: sha,
                package_id: manifest.id,
                version: manifest.version,
                name: manifest.name,
                seq,
            });
        }
        preferences
    }

    /// Publishes `preferences` in one rename. An error means the file on disk is unchanged. The
    /// folder entry is synced by `sync`, after the preference lock is released.
    fn save(&self, preferences: &Preferences) -> std::io::Result<()> {
        let bytes = serde_json::to_vec_pretty(preferences).map_err(std::io::Error::other)?;
        if bytes.len() > MAX_PREFERENCES_BYTES {
            return Err(std::io::Error::other(
                "the preferences would be larger than their bound",
            ));
        }
        fs::create_dir_all(&self.root)?;
        self.write_new(&self.root, &self.root.join(PREFERENCES), &bytes)
    }

    /// A fully synced temporary file beside `path`, then one rename onto it.
    fn write_new(&self, dir: &Path, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        let mut file = NamedTempFile::new_in(dir)?;
        file.write_all(bytes)?;
        file.as_file().sync_all()?;
        self.io.publish(file, path)
    }

    /// After a publication. The change is in place whatever this answers, so a failure is only
    /// a warning and never turns the change into a refusal.
    fn sync(&self, dir: &Path) {
        if let Err(error) = self.io.sync_dir(dir) {
            log::warn!("An extension store change is in place, but its folder could not be synced: {error}");
        }
    }

    // --- Package files ------------------------------------------------------------------------------

    /// The exact stored bytes, only if they still hash to their name.
    fn read_blob(&self, sha: &str) -> Option<String> {
        if !is_sha256_hex(sha) {
            return None;
        }
        let bytes = self.io.read_package(&self.blob_path(sha)).ok()??;
        if hex(&sha256(&bytes)) != sha {
            return None;
        }
        String::from_utf8(bytes).ok()
    }

    /// Stores the bytes under their hash and answers whether this call created the file. A new
    /// file is written only once reconciliation has found room for it.
    fn write_blob(
        &self,
        preferences: &Preferences,
        sha: &str,
        bytes: &[u8],
    ) -> std::io::Result<bool> {
        let dir = self.root.join(PACKAGES);
        fs::create_dir_all(&dir)?;
        if !fs::symlink_metadata(&dir)?.is_dir() {
            return Err(std::io::Error::other("the package folder is not a folder"));
        }
        if self.read_blob(sha).is_some() {
            return Ok(false);
        }
        if !self.reconciled(preferences, &dir) {
            return Err(std::io::Error::other("the package folder has no room"));
        }
        self.write_new(&dir, &self.blob_path(sha), bytes)?;
        self.sync(&dir);
        Ok(true)
    }

    /// Removes the package files no stored version names, then answers whether one more file
    /// fits: at most `MAX_STORED_VERSIONS` may be present before it, the stored versions plus any
    /// file that could not be removed. Removing only ever lowers the count, so the folder never
    /// holds more than `MAX_STORED_VERSIONS + 1` package files. A folder with more entries than
    /// one pass looks at takes no new file.
    fn reconciled(&self, preferences: &Preferences, dir: &Path) -> bool {
        let Ok(entries) = fs::read_dir(dir) else {
            return false;
        };
        let stored: HashSet<&str> = preferences
            .imports
            .iter()
            .map(|import| import.package_sha256.as_str())
            .collect();
        let mut present = 0;
        for (examined, entry) in entries.enumerate() {
            if examined == MAX_SCANNED_ENTRIES {
                log::warn!("The extension package folder holds more entries than one pass reads; no new package is stored.");
                return false;
            }
            let Ok(entry) = entry else {
                return false;
            };
            let Some(sha) = package_name(&entry.file_name()) else {
                continue;
            };
            if stored.contains(sha.as_str()) || !self.remove_blob(&sha) {
                present += 1;
            }
        }
        present <= MAX_STORED_VERSIONS
    }

    /// Answers whether the file is gone. One that stays is counted by the next reconciliation.
    fn remove_blob(&self, sha: &str) -> bool {
        if !is_sha256_hex(sha) {
            return false;
        }
        match self.io.remove_file(&self.blob_path(sha)) {
            Ok(()) => true,
            Err(error) if error.kind() == ErrorKind::NotFound => true,
            Err(error) => {
                log::warn!("An unused extension package file could not be removed: {error}");
                false
            }
        }
    }

    /// Bytes read now, hash checked, package validated now.
    fn verified(&self, sha: &str) -> Result<(String, Manifest), Unusable> {
        if let Some(bundled) = self.bundled(sha) {
            return Ok((bundled.text.to_string(), bundled.manifest.clone()));
        }
        let text = self.read_blob(sha).ok_or(Unusable::Unreadable)?;
        let manifest = manifest::validate(&text).map_err(|_| Unusable::Invalid)?;
        Ok((text, manifest))
    }

    // --- Candidates ---------------------------------------------------------------------------------

    /// Validates and stores a candidate. Never activates and never changes what is active.
    pub(crate) fn import(&self, text: &str) -> ImportReply {
        let manifest = match manifest::validate(text) {
            Ok(manifest) => manifest,
            Err(diagnostics) => return ImportReply::Invalid { diagnostics },
        };
        if manifest.id.starts_with(RESERVED_PREFIX) {
            return ImportReply::Refused {
                reason: ImportRefusal::ReservedId,
            };
        }
        let sha = hex(&sha256(text.as_bytes()));
        let stored = self
            .with_preferences(|preferences| self.store_version(preferences, &sha, text, &manifest));
        match stored {
            Ok(true) => self.sync(&self.root),
            Ok(false) => {}
            Err(_) => {
                return ImportReply::Refused {
                    reason: ImportRefusal::StorageUnavailable,
                }
            }
        }
        ImportReply::Candidate {
            package_sha256: sha,
            missing_capabilities: self.missing(&manifest.capabilities),
            package_id: manifest.id,
            version: manifest.version,
        }
    }

    /// Answers whether new preferences were published. When they were not, a package file this
    /// attempt created is removed again, since nothing names it; when they were, the versions they
    /// dropped are removed.
    fn store_version(
        &self,
        preferences: &mut Preferences,
        sha: &str,
        text: &str,
        manifest: &Manifest,
    ) -> std::io::Result<bool> {
        if preferences
            .imports
            .iter()
            .any(|import| import.package_sha256 == sha)
        {
            self.write_blob(preferences, sha, text.as_bytes())?;
            return Ok(false);
        }
        let evicted = room_for(preferences, &manifest.id)
            .ok_or_else(|| std::io::Error::other("every stored version is in use"))?;
        let mut next = preferences.clone();
        let seq = take_seq(&mut next)
            .ok_or_else(|| std::io::Error::other("no sequence number is left"))?;
        next.imports
            .retain(|import| !evicted.contains(&import.package_sha256));
        next.imports.push(Imported {
            package_sha256: sha.to_string(),
            package_id: manifest.id.clone(),
            version: manifest.version.clone(),
            name: manifest.name.clone(),
            seq,
        });
        let created = self.write_blob(preferences, sha, text.as_bytes())?;
        if let Err(error) = self.save(&next) {
            if created {
                self.remove_blob(sha);
            }
            return Err(error);
        }
        *preferences = next;
        for sha in &evicted {
            self.remove_blob(sha);
        }
        Ok(true)
    }

    pub(crate) fn list(&self, vault: &str) -> Vec<InstalledExtension> {
        let (mut imports, vault_preferences) = self.with_preferences(|preferences| {
            (
                preferences.imports.clone(),
                preferences.vaults.get(vault).cloned().unwrap_or_default(),
            )
        });
        let mut extensions: Vec<InstalledExtension> = Vec::new();
        for bundled in &self.bundled {
            let version = StoredVersion {
                package_sha256: bundled.sha256.clone(),
                version: bundled.manifest.version.clone(),
                readable: true,
            };
            group(
                &mut extensions,
                &bundled.manifest.id,
                &bundled.manifest.name,
            )
            .push(version);
        }
        imports.sort_by_key(|import| std::cmp::Reverse(import.seq));
        for import in imports {
            let readable = self
                .verified(&import.package_sha256)
                .is_ok_and(|(_, manifest)| manifest.id == import.package_id);
            let version = StoredVersion {
                package_sha256: import.package_sha256,
                version: import.version,
                readable,
            };
            group(&mut extensions, &import.package_id, &import.name).push(version);
        }
        for extension in &mut extensions {
            extension.active_sha256 =
                self.active_in(Some(&vault_preferences), &extension.package_id);
            extension.previous_sha256 = vault_preferences
                .previous
                .get(&extension.package_id)
                .cloned();
        }
        extensions
    }

    pub(crate) fn read(&self, sha: &str) -> ReadReply {
        let known = self.bundled(sha).is_some()
            || self.with_preferences(|preferences| {
                preferences
                    .imports
                    .iter()
                    .any(|import| import.package_sha256 == sha)
            });
        if !known {
            return ReadReply::Unknown;
        }
        match self.verified(sha) {
            Ok((package_text, _)) => ReadReply::Ok { package_text },
            Err(_) => ReadReply::Unreadable,
        }
    }

    // --- Activation ---------------------------------------------------------------------------------

    /// Compare-and-set on the version active in this vault. Rolling back is activating an
    /// older stored version.
    pub(crate) fn activate(
        &self,
        vault: &str,
        package_id: &str,
        sha: &str,
        expected: Option<&str>,
    ) -> Result<Activated, (ActivationRefusal, Vec<Capability>)> {
        let refuse = |reason| Err((reason, Vec::new()));
        let bundled = self.is_bundled(package_id, sha);
        let stored = self.with_preferences(|preferences| {
            preferences
                .imports
                .iter()
                .any(|import| import.package_sha256 == sha && import.package_id == package_id)
        });
        if !bundled && !stored {
            return refuse(ActivationRefusal::UnknownVersion);
        }
        if package_id.starts_with(RESERVED_PREFIX) && !bundled {
            return refuse(ActivationRefusal::ReservedId);
        }
        let manifest = match self.verified(sha) {
            Ok((_, manifest)) => manifest,
            Err(Unusable::Unreadable) => return refuse(ActivationRefusal::Unreadable),
            Err(Unusable::Invalid) => return refuse(ActivationRefusal::Invalid),
        };
        if manifest.id != package_id {
            return refuse(ActivationRefusal::UnknownVersion);
        }
        let missing = self.missing(&manifest.capabilities);
        if !missing.is_empty() {
            return Err((ActivationRefusal::MissingCapabilities, missing));
        }
        let (activated, published) = self
            .with_preferences(|preferences| {
                self.set_active(preferences, vault, package_id, sha, expected)
            })
            .map_err(|reason| (reason, Vec::new()))?;
        if published {
            self.sync(&self.root);
        }
        Ok(activated)
    }

    /// Answers the change and whether new preferences were published for it. The version is
    /// checked again here, under the lock that publishes: an import may have dropped it since
    /// `activate` read its bytes, and an activation never names a version that is not stored.
    fn set_active(
        &self,
        preferences: &mut Preferences,
        vault: &str,
        package_id: &str,
        sha: &str,
        expected: Option<&str>,
    ) -> Result<(Activated, bool), ActivationRefusal> {
        let stored = self.is_bundled(package_id, sha)
            || preferences
                .imports
                .iter()
                .any(|import| import.package_sha256 == sha && import.package_id == package_id);
        if !stored {
            return Err(ActivationRefusal::UnknownVersion);
        }
        let entry = preferences.vaults.get(vault);
        let current = self.active_in(entry, package_id);
        if current.as_deref() != expected {
            return Err(ActivationRefusal::Changed);
        }
        if current.as_deref() == Some(sha) {
            let previous = entry
                .and_then(|entry| entry.previous.get(package_id))
                .cloned();
            let unchanged = Activated {
                previous,
                replaced: None,
            };
            return Ok((unchanged, false));
        }
        if vault.is_empty() || vault.len() > MAX_VAULT_KEY_BYTES || vault.contains('\0') {
            return Err(ActivationRefusal::VaultUnavailable);
        }
        let mut next = preferences.clone();
        if !make_room_for_vault(&mut next, vault, |entry| self.holds_choice(entry)) {
            return Err(ActivationRefusal::VaultUnavailable);
        }
        let seq = take_seq(&mut next).ok_or(ActivationRefusal::VaultUnavailable)?;
        let entry = next.vaults.entry(vault.to_string()).or_default();
        entry.touched = seq;
        if let Some(current) = &current {
            entry
                .previous
                .insert(package_id.to_string(), current.clone());
        }
        entry.active.insert(package_id.to_string(), sha.to_string());
        if entry
            .previous
            .get(package_id)
            .is_some_and(|previous| previous == sha)
        {
            entry.previous.remove(package_id);
        }
        let previous = entry.previous.get(package_id).cloned();
        self.save(&next)
            .map_err(|_| ActivationRefusal::VaultUnavailable)?;
        *preferences = next;
        let activated = Activated {
            previous,
            replaced: current,
        };
        Ok((activated, true))
    }

    /// Compare-and-set; the turned-off version becomes the previous one, so it can come back. For
    /// a default-on built-in that record is the explicit Off, so the vault gets an entry if it has
    /// none.
    pub(crate) fn deactivate(
        &self,
        vault: &str,
        package_id: &str,
        expected: &str,
    ) -> Result<(), DeactivationRefusal> {
        self.with_preferences(|preferences| {
            let current = self.active_in(preferences.vaults.get(vault), package_id);
            if current.as_deref() != Some(expected) {
                return Err(DeactivationRefusal::Changed);
            }
            if vault.is_empty() || vault.len() > MAX_VAULT_KEY_BYTES || vault.contains('\0') {
                return Err(DeactivationRefusal::VaultUnavailable);
            }
            let mut next = preferences.clone();
            if !make_room_for_vault(&mut next, vault, |entry| self.holds_choice(entry)) {
                return Err(DeactivationRefusal::VaultUnavailable);
            }
            let seq = take_seq(&mut next).ok_or(DeactivationRefusal::VaultUnavailable)?;
            let entry = next.vaults.entry(vault.to_string()).or_default();
            entry.active.remove(package_id);
            entry
                .previous
                .insert(package_id.to_string(), expected.to_string());
            entry.touched = seq;
            self.save(&next)
                .map_err(|_| DeactivationRefusal::VaultUnavailable)?;
            *preferences = next;
            Ok(())
        })?;
        self.sync(&self.root);
        Ok(())
    }

    /// Run admission: this exact version active in this vault, its bytes verified now, and a
    /// command this host can perform. Answers the package id.
    pub(crate) fn admit(
        &self,
        vault: &str,
        sha: &str,
        command_id: &str,
    ) -> Result<String, RunRefusal> {
        let package_id = match self.bundled(sha) {
            Some(bundled) => Some(bundled.manifest.id.clone()),
            None => self.with_preferences(|preferences| {
                preferences
                    .imports
                    .iter()
                    .find(|import| import.package_sha256 == sha)
                    .map(|import| import.package_id.clone())
            }),
        }
        .ok_or(RunRefusal::NotActive)?;
        let active = self.with_preferences(|preferences| {
            self.active_in(preferences.vaults.get(vault), &package_id)
                .is_some_and(|active| active == sha)
        });
        if !active {
            return Err(RunRefusal::NotActive);
        }
        let (_, manifest) = self.verified(sha).map_err(|_| RunRefusal::Unreadable)?;
        if manifest.id != package_id {
            return Err(RunRefusal::Unreadable);
        }
        let command = manifest
            .commands
            .iter()
            .find(|command| command.id == command_id)
            .ok_or(RunRefusal::UnknownCommand)?;
        if !self.missing(&command.capabilities).is_empty() {
            return Err(RunRefusal::MissingCapabilities);
        }
        Ok(package_id)
    }

    #[cfg(test)]
    pub(crate) fn bundled_hash(&self, package_id: &str) -> Option<String> {
        self.bundled
            .iter()
            .find(|bundled| bundled.manifest.id == package_id)
            .map(|bundled| bundled.sha256.clone())
    }

    #[cfg(test)]
    pub(crate) fn blob_file(&self, sha: &str) -> PathBuf {
        self.blob_path(sha)
    }

    #[cfg(test)]
    pub(crate) fn preferences_file(&self) -> PathBuf {
        self.root.join(PREFERENCES)
    }
}

/// The file's bytes; `None` when there is no file. Anything but a plain file of at most `limit`
/// bytes is an error, and no more than `limit + 1` bytes are ever read.
fn read_bounded(path: &Path, limit: usize) -> std::io::Result<Option<Vec<u8>>> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if !meta.is_file() || meta.len() > limit as u64 {
        return Err(std::io::Error::other("not a plain file within its bound"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(std::io::Error::other("larger than its bound"));
    }
    Ok(Some(bytes))
}

/// The hash a package file is named by, when it is named like one.
fn package_name(name: &OsStr) -> Option<String> {
    name.to_str()?
        .strip_suffix(".json")
        .filter(|sha| is_sha256_hex(sha))
        .map(str::to_string)
}

/// The next sequence number; `None` once none is left, and the change needing it is refused.
fn take_seq(preferences: &mut Preferences) -> Option<u64> {
    let seq = preferences.next_seq;
    preferences.next_seq = seq.checked_add(1).filter(|next| *next <= MAX_SEQ)?;
    Some(seq)
}

fn group<'e>(
    extensions: &'e mut Vec<InstalledExtension>,
    package_id: &str,
    name: &str,
) -> &'e mut Vec<StoredVersion> {
    let position = match extensions
        .iter()
        .position(|extension| extension.package_id == package_id)
    {
        Some(position) => position,
        None => {
            extensions.push(InstalledExtension {
                package_id: package_id.to_string(),
                name: name.to_string(),
                versions: Vec::new(),
                active_sha256: None,
                previous_sha256: None,
            });
            extensions.len() - 1
        }
    };
    &mut extensions[position].versions
}

fn referenced(preferences: &Preferences) -> HashSet<&str> {
    preferences
        .vaults
        .values()
        .flat_map(|entry| entry.active.values().chain(entry.previous.values()))
        .map(String::as_str)
        .collect()
}

/// The versions to drop so one more fits; `None` when only referenced versions could go.
fn room_for(preferences: &Preferences, package_id: &str) -> Option<Vec<String>> {
    let referenced = referenced(preferences);
    let mut imports: Vec<&Imported> = preferences.imports.iter().collect();
    imports.sort_by_key(|import| import.seq);
    let mut evicted: Vec<String> = Vec::new();
    let same = imports
        .iter()
        .filter(|import| import.package_id == package_id)
        .count();
    if same >= MAX_VERSIONS_PER_PACKAGE {
        let victim = imports.iter().find(|import| {
            import.package_id == package_id && !referenced.contains(import.package_sha256.as_str())
        })?;
        evicted.push(victim.package_sha256.clone());
    }
    if imports.len() - evicted.len() >= MAX_STORED_VERSIONS {
        let victim = imports.iter().find(|import| {
            !referenced.contains(import.package_sha256.as_str())
                && !evicted.contains(&import.package_sha256)
        })?;
        evicted.push(victim.package_sha256.clone());
    }
    Some(evicted)
}

/// Forgets the least recently touched vault that holds no choice, when one more is needed.
fn make_room_for_vault(
    preferences: &mut Preferences,
    vault: &str,
    holds_choice: impl Fn(&VaultPreferences) -> bool,
) -> bool {
    if preferences.vaults.contains_key(vault) || preferences.vaults.len() < MAX_VAULTS {
        return true;
    }
    let idle = preferences
        .vaults
        .iter()
        .filter(|(_, entry)| !holds_choice(entry))
        .min_by_key(|(_, entry)| entry.touched)
        .map(|(key, _)| key.clone());
    match idle {
        Some(key) => {
            preferences.vaults.remove(&key);
            true
        }
        None => false,
    }
}
