//! The version store's authoritative usage: one bounded, metadata-only scan made under the
//! history lock before anything is admitted. Nothing is followed through a link or deleted here.

use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::history_outcome::VersionReason;
use super::versions::location_key;

pub(super) const VERSIONS_DIR: &str = "versions";
pub(super) const TMP_DIR: &str = "tmp";
pub(super) const PAYLOAD: &str = "payload";
pub(super) const META: &str = "version.json";
pub(super) const LOCATION: &str = "location.json";
const META_MAX_BYTES: u64 = 64 * 1024;

/// Strict per-vault limits; provisional numbers that QA measures.
#[derive(Clone, Copy, Debug)]
pub(super) struct Caps {
    /// Automatic-version payload only; not S0 recovery files or vault disk use.
    pub(super) budget_bytes: u64,
    /// Each save scans the whole store, so this count bounds save time.
    pub(super) versions: usize,
    pub(super) locations: usize,
    pub(super) per_location: usize,
    pub(super) tmp: usize,
    pub(super) version_bytes: u64,
}

pub(super) const CAPS: Caps = Caps {
    budget_bytes: 512 << 20,
    versions: 1_000,
    locations: 2_000,
    per_location: 200,
    tmp: 64,
    version_bytes: 10 << 20,
};

#[cfg(test)]
thread_local! {
    pub(super) static TEST_CAPS: std::cell::Cell<Option<Caps>> = const { std::cell::Cell::new(None) };
}

pub(super) fn caps() -> Caps {
    #[cfg(test)]
    if let Some(caps) = TEST_CAPS.with(std::cell::Cell::get) {
        return caps;
    }
    CAPS
}

/// The most store items one scan visits; reaching it stops the scan.
pub(super) fn ceiling(caps: Caps) -> usize {
    caps.locations * 2 + caps.versions * 3 + caps.tmp * 3 + 64
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct VersionMeta {
    pub(super) format: u32,
    pub(super) captured_at: u64,
    pub(super) reason: VersionReason,
    pub(super) recorded_path: String,
    pub(super) length: u64,
    pub(super) sha256: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct LocationMeta {
    pub(super) recorded_path: String,
}

pub(super) struct Entry {
    pub(super) name: String,
    pub(super) captured_at: u64,
    /// Every regular file inside, as stored.
    pub(super) bytes: u64,
    /// `None` when it cannot be listed; it is still counted.
    pub(super) meta: Option<VersionMeta>,
}

#[derive(Default)]
pub(super) struct Location {
    /// `None` without `location.json`; `Some(false)` when it does not name this location.
    pub(super) record: Option<bool>,
    /// Oldest first.
    pub(super) entries: Vec<Entry>,
}

#[derive(Default)]
pub(super) struct Inventory {
    pub(super) locations: BTreeMap<String, Location>,
    pub(super) used_bytes: u64,
    pub(super) versions: usize,
    pub(super) tmp: Vec<String>,
    pub(super) unreadable: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Stop {
    /// The scan ceiling was reached; usage beyond it is unknown.
    Full,
    /// Something here cannot be counted safely: a link, an unknown folder or an unreadable item.
    Unavailable(PathBuf),
}

/// The largest time the UI can hold exactly.
const MAX_SAFE_MS: u64 = (1 << 53) - 1;

fn lower_hex(text: &str, len: usize) -> bool {
    text.len() == len && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `<ms>-<16 hex>-<6 hex>`, the time it was captured.
pub(super) fn entry_time(name: &str) -> Option<u64> {
    let mut parts = name.split('-');
    let (time, sha, tag) = (parts.next()?, parts.next()?, parts.next()?);
    let shaped = parts.next().is_none()
        && (1..=16).contains(&time.len())
        && time.bytes().all(|b| b.is_ascii_digit())
        && lower_hex(sha, 16)
        && lower_hex(tag, 6);
    shaped
        .then(|| time.parse().ok())
        .flatten()
        .filter(|&time| time <= MAX_SAFE_MS)
}

pub(super) fn is_location_key(name: &str) -> bool {
    lower_hex(name, 32)
}

/// `tmp/<32 hex>.tmpv`, a capture still being written or left by one that stopped.
pub(super) fn is_write_staging(name: &str) -> bool {
    name.strip_suffix(".tmpv").is_some_and(is_location_key)
}

/// `tmp/del-<location>-<version>`, a version moved out of its list to be removed.
fn is_delete_staging(name: &str) -> bool {
    name.strip_prefix("del-")
        .and_then(|rest| rest.split_once('-'))
        .is_some_and(|(loc, version)| is_location_key(loc) && entry_time(version).is_some())
}

/// A whole version: its record names this folder and location, and its payload has the
/// recorded length. Checked before any part of the hash is sliced.
pub(super) fn listable(
    meta: &VersionMeta,
    loc: &str,
    name: &str,
    payload: Option<&fs::Metadata>,
) -> bool {
    meta.format == 1
        && lower_hex(&meta.sha256, 64)
        && entry_time(name) == Some(meta.captured_at)
        && name.split('-').nth(1) == Some(&meta.sha256[..16])
        && safe_relative(&meta.recorded_path)
        && location_key(&meta.recorded_path) == loc
        && payload.is_some_and(|payload| payload.is_file() && payload.len() == meta.length)
}

/// The page path a location's own record names, when it hashes to that location.
pub(super) fn location_record(dir: &Path, loc: &str) -> std::io::Result<Option<String>> {
    Ok(read_small(&dir.join(LOCATION))?
        .and_then(|bytes| serde_json::from_slice::<LocationMeta>(&bytes).ok())
        .map(|record| record.recorded_path)
        .filter(|path| safe_relative(path) && location_key(path) == loc))
}

/// Nothing in a version folder but its two known names; checks at most three entries.
pub(super) fn only_known_files(entry: &Path) -> bool {
    fs::read_dir(entry).is_ok_and(|children| {
        let names: Option<Vec<_>> = children
            .take(3)
            .map(|child| child.ok().map(|child| child.file_name()))
            .collect();
        names.is_some_and(|names| {
            names.len() <= 2 && names.iter().all(|n| n == PAYLOAD || n == META)
        })
    })
}

/// A vault-relative `/` path that cannot leave the vault.
pub(super) fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

enum Kind {
    File(u64),
    Dir,
}

fn kind(path: &Path) -> Result<Kind, Stop> {
    let unavailable = || Stop::Unavailable(path.to_path_buf());
    let meta = fs::symlink_metadata(path).map_err(|_| unavailable())?;
    if meta.file_type().is_symlink() {
        Err(unavailable())
    } else if meta.is_file() {
        Ok(Kind::File(meta.len()))
    } else if meta.is_dir() {
        Ok(Kind::Dir)
    } else {
        Err(unavailable())
    }
}

/// A real folder, `None` when it does not exist yet.
fn optional_dir(path: &Path) -> Result<Option<()>, Stop> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => match kind(path)? {
            Kind::Dir => Ok(Some(())),
            Kind::File(_) => Err(Stop::Unavailable(path.to_path_buf())),
        },
    }
}

/// A small regular file read through one handle, never a link. `Ok(None)` when it is missing,
/// not a file or too large; `Err` when it is there but cannot be read now.
pub(super) fn read_small(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    let meta = match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        other => other?,
    };
    if !meta.is_file() || meta.len() > META_MAX_BYTES {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(META_MAX_BYTES)
        .read_to_end(&mut bytes)?;
    Ok(Some(bytes))
}

/// `Ok(None)` for a missing or malformed record; `Err` only when it cannot be read.
pub(super) fn read_meta(entry: &Path) -> std::io::Result<Option<VersionMeta>> {
    let bytes = read_small(&entry.join(META))?;
    Ok(bytes.and_then(|bytes| serde_json::from_slice(&bytes).ok()))
}

struct Scan {
    left: usize,
    inventory: Inventory,
}

impl Scan {
    fn children(&mut self, dir: &Path) -> Result<Vec<(String, PathBuf)>, Stop> {
        let unavailable = || Stop::Unavailable(dir.to_path_buf());
        let mut children = Vec::new();
        for child in fs::read_dir(dir).map_err(|_| unavailable())? {
            if self.left == 0 {
                return Err(Stop::Full);
            }
            self.left -= 1;
            let child = child.map_err(|_| unavailable())?;
            let name = child.file_name().to_string_lossy().into_owned();
            children.push((name, child.path()));
        }
        Ok(children)
    }

    /// Recognized folders hold regular files only; an extra file is counted but not listable.
    fn files(&mut self, dir: &Path) -> Result<(u64, bool), Stop> {
        let (mut bytes, mut only_known) = (0, true);
        for (name, path) in self.children(dir)? {
            match kind(&path)? {
                Kind::File(size) => bytes += size,
                Kind::Dir => return Err(Stop::Unavailable(path)),
            }
            only_known &= name == PAYLOAD || name == META;
        }
        Ok((bytes, only_known))
    }

    fn entry(
        &mut self,
        path: &Path,
        loc: &str,
        name: String,
        captured_at: u64,
        record_ok: bool,
    ) -> Result<Entry, Stop> {
        let (bytes, only_known) = self.files(path)?;
        let payload = fs::symlink_metadata(path.join(PAYLOAD)).ok();
        // Unreadable is not malformed: nothing is known, so nothing may be removed.
        let meta = read_meta(path)
            .map_err(|_| Stop::Unavailable(path.join(META)))?
            .filter(|meta| record_ok && only_known && listable(meta, loc, &name, payload.as_ref()));
        if meta.is_none() {
            self.inventory.unreadable += 1;
        }
        Ok(Entry {
            name,
            captured_at,
            bytes,
            meta,
        })
    }

    fn location(&mut self, dir: &Path, loc: &str) -> Result<Location, Stop> {
        // A wrong or missing record leaves every version here unlisted; an unreadable one stops.
        let record_ok = location_record(dir, loc)
            .map_err(|_| Stop::Unavailable(dir.join(LOCATION)))?
            .is_some();
        let mut location = Location::default();
        for (name, path) in self.children(dir)? {
            match (kind(&path)?, entry_time(&name)) {
                (Kind::File(size), _) => {
                    self.inventory.used_bytes += size;
                    if name == LOCATION {
                        location.record = Some(record_ok);
                    }
                }
                (Kind::Dir, Some(captured_at)) => {
                    self.inventory.versions += 1;
                    let entry = self.entry(&path, loc, name, captured_at, record_ok)?;
                    self.inventory.used_bytes += entry.bytes;
                    location.entries.push(entry);
                }
                (Kind::Dir, None) => return Err(Stop::Unavailable(path)),
            }
        }
        location
            .entries
            .sort_by(|a, b| (a.captured_at, &a.name).cmp(&(b.captured_at, &b.name)));
        Ok(location)
    }
}

/// Counts the versions and leftovers under `history`; stops rather than guess.
pub(super) fn scan(history: &Path, ceiling: usize) -> Result<Inventory, Stop> {
    let mut scan = Scan {
        left: ceiling,
        inventory: Inventory::default(),
    };
    let versions = history.join(VERSIONS_DIR);
    if optional_dir(&versions)?.is_some() {
        for (name, path) in scan.children(&versions)? {
            match kind(&path)? {
                Kind::File(size) => scan.inventory.used_bytes += size,
                Kind::Dir if is_location_key(&name) => {
                    let location = scan.location(&path, &name)?;
                    scan.inventory.locations.insert(name, location);
                }
                Kind::Dir => return Err(Stop::Unavailable(path)),
            }
        }
    }
    let tmp = history.join(TMP_DIR);
    if optional_dir(&tmp)?.is_some() {
        for (name, path) in scan.children(&tmp)? {
            match kind(&path)? {
                Kind::File(size) => scan.inventory.used_bytes += size,
                // Only names the writer makes; a lookalike is never counted as removable.
                Kind::Dir if is_write_staging(&name) || is_delete_staging(&name) => {
                    let (bytes, _) = scan.files(&path)?;
                    scan.inventory.used_bytes += bytes;
                    scan.inventory.tmp.push(name);
                }
                Kind::Dir => return Err(Stop::Unavailable(path)),
            }
        }
    }
    Ok(scan.inventory)
}
