//! Automatic earlier versions, filed by the path where they were saved. A capture runs inside
//! an ordinary save but can never change it: every failure becomes a truthful "not kept".

use std::collections::HashMap;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use super::history_outcome::{
    HealthState, HistoryHealth, ListLocationsOutcome, ListVersionsOutcome, NotKeptReason,
    ReadVersionOutcome, SavedLocation, VersionReason, VersionRow,
};
use super::inventory::{
    self, caps, ceiling, entry_time, is_location_key, listable, location_record, only_known_files,
    read_meta, safe_relative, Caps, Inventory, Location, LocationMeta, Stop, VersionMeta, LOCATION,
    META, PAYLOAD, TMP_DIR, VERSIONS_DIR,
};
use super::lock::{real_folder, CopyLock, LockError};
use super::outcome::OriginalRequest;
use super::pins::{Retained, Slot, Version};
use super::policy::{self, Kept, Seen};
use super::retention::{self, remove_entry, remove_known};
use super::{hex, PageTarget, VaultRoots};
use crate::vault::staged_file::{sha256, NativePlatform, Platform};

const PAGE_SIZE: usize = 100;
const PREVIEW_BYTES: usize = 256 * 1024;
/// Per capture, so a save never waits on a long prune.
const CAPTURE_PRUNE_LIMIT: usize = 20;
const HISTORY_PATH: &str = ".leadinglight/history";

/// Where one page's versions are filed.
pub(super) struct HistoryContext {
    root: PathBuf,
    rel: String,
    loc: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Captured {
    NotWanted,
    Kept,
    NotKept(NotKeptReason),
}

/// This process's memory per (vault, location), and its latest failed capture per vault.
static SEEN: Mutex<Option<HashMap<(PathBuf, String), Seen>>> = Mutex::new(None);
static LAST: Mutex<Option<HashMap<PathBuf, NotKeptReason>>> = Mutex::new(None);

#[cfg(test)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Fault {
    Panic,
    StorageFull,
    /// Syncing a page's location folder fails, including right after a version was renamed in.
    LocationSync,
    /// Syncing a folder above a location fails, including right after the location was created.
    ParentSync,
}

#[cfg(test)]
thread_local! {
    pub(super) static FAULT: std::cell::Cell<Option<Fault>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn fault(point: Fault) -> std::io::Result<()> {
    match FAULT.with(std::cell::Cell::get) {
        Some(Fault::Panic) if point == Fault::Panic => panic!("injected history panic"),
        Some(Fault::StorageFull) if point == Fault::StorageFull => {
            Err(ErrorKind::StorageFull.into())
        }
        Some(Fault::LocationSync) if point == Fault::LocationSync => {
            Err(std::io::Error::other("injected location sync failure"))
        }
        Some(Fault::ParentSync) if point == Fault::ParentSync => {
            Err(std::io::Error::other("injected parent sync failure"))
        }
        _ => Ok(()),
    }
}

/// Which history folder sync a test makes fail.
#[cfg(test)]
#[derive(Debug, Clone, Copy)]
pub(crate) enum SyncFault {
    /// A page's location folder, including right after a version was renamed into it.
    Location,
    /// A folder above a location, including right after the location was created.
    Parent,
}

/// Test seam for other modules: while set, that sync fails on this thread.
#[cfg(test)]
pub(crate) fn fail_history_syncs(fault: Option<SyncFault>) {
    FAULT.set(fault.map(|fault| match fault {
        SyncFault::Location => Fault::LocationSync,
        SyncFault::Parent => Fault::ParentSync,
    }));
}

pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| time.as_millis() as u64)
}

pub(super) fn location_key(rel: &str) -> String {
    hex(&sha256(rel.as_bytes()))[..32].to_string()
}

fn relative(key: &Path, canonical_root: &Path) -> Option<String> {
    let parts = key
        .strip_prefix(canonical_root)
        .ok()?
        .components()
        .map(|part| part.as_os_str().to_str())
        .collect::<Option<Vec<_>>>()?;
    let rel = parts.join("/");
    safe_relative(&rel).then_some(rel)
}

pub(super) fn context(request: &OriginalRequest, target: &PageTarget) -> Option<HistoryContext> {
    let root = Path::new(&request.vault_path).canonicalize().ok()?;
    let rel = relative(&target.key, &root)?;
    Some(HistoryContext {
        loc: location_key(&rel),
        rel,
        root,
    })
}

fn with_map<K: std::hash::Hash + Eq, V, T>(
    map: &Mutex<Option<HashMap<K, V>>>,
    use_map: impl FnOnce(&mut HashMap<K, V>) -> T,
) -> T {
    let mut guard = map.lock().unwrap_or_else(PoisonError::into_inner);
    use_map(guard.get_or_insert_with(HashMap::new))
}

/// Keeps the text this save replaces when policy wants it. Never fails or panics outward.
pub(super) fn capture(
    context: &HistoryContext,
    p: &[u8],
    n: &[u8],
    platform: &dyn Platform,
) -> Captured {
    if p.is_empty() || p == n {
        return Captured::NotWanted;
    }
    let caps = caps();
    let result = if p.len() as u64 > caps.version_bytes {
        Captured::NotKept(NotKeptReason::TooLarge)
    } else {
        panic::catch_unwind(AssertUnwindSafe(|| locked(context, p, n, platform, caps)))
            .unwrap_or(Captured::NotKept(NotKeptReason::Unavailable))
    };
    // A skip proves nothing about the store; only a kept version clears a failure.
    match result {
        Captured::NotWanted => {}
        Captured::Kept => {
            with_map(&LAST, |last| last.remove(&context.root));
        }
        Captured::NotKept(reason) => {
            with_map(&LAST, |last| last.insert(context.root.clone(), reason));
        }
    }
    schedule_maintenance(
        &context.root,
        result == Captured::NotKept(NotKeptReason::Full),
    );
    result
}

/// After the page holds `n`, so a later different text counts as changed elsewhere.
pub(super) fn remember_written(context: &HistoryContext, n: &[u8]) {
    let key = (context.root.clone(), context.loc.clone());
    with_map(&SEEN, |seen| {
        seen.entry(key).or_default().last_written = Some(hex(&sha256(n)));
    });
}

struct Usage {
    bytes: u64,
    versions: usize,
    locations: usize,
    here: usize,
    tmp: usize,
}

impl Usage {
    fn of(inventory: &Inventory, location: Option<&Location>) -> Self {
        Self {
            bytes: inventory.used_bytes,
            versions: inventory.versions,
            locations: inventory.locations.len() + usize::from(location.is_none()),
            here: location.map_or(0, |location| location.entries.len()),
            tmp: inventory.tmp.len(),
        }
    }

    fn fits(&self, cost: u64, caps: Caps) -> bool {
        self.bytes.saturating_add(cost) <= caps.budget_bytes
            && self.versions < caps.versions
            && self.locations <= caps.locations
            && self.here < caps.per_location
            && self.tmp <= caps.tmp
    }
}

fn locked(
    context: &HistoryContext,
    p: &[u8],
    n: &[u8],
    platform: &dyn Platform,
    caps: Caps,
) -> Captured {
    use NotKeptReason::{Busy, Full, LowSpace, Unavailable};
    #[cfg(test)]
    let _ = fault(Fault::Panic);
    let lock = match CopyLock::try_acquire(&context.root) {
        Ok(lock) => lock,
        Err(LockError::Busy) => return Captured::NotKept(Busy),
        Err(LockError::Unavailable(_)) => return Captured::NotKept(Unavailable),
    };
    let history = lock.dir.as_path();
    let dirs = [VERSIONS_DIR, TMP_DIR].map(|name| real_folder(&history.join(name)));
    if dirs.iter().any(Result::is_err) {
        return Captured::NotKept(Unavailable);
    }
    let inventory = match inventory::scan(history, ceiling(caps)) {
        Ok(inventory) => inventory,
        Err(Stop::Full) => return Captured::NotKept(Full),
        Err(Stop::Unavailable(_)) => return Captured::NotKept(Unavailable),
    };
    let location = inventory.locations.get(&context.loc);
    // Strictly after this location's newest, so its versions always list in save order.
    let newest = location.and_then(|location| location.entries.last());
    let now = now_ms().max(newest.map_or(0, |entry| entry.captured_at + 1));
    let p_sha = hex(&sha256(p));
    let reason = with_map(&SEEN, |seen| {
        let seen = seen
            .entry((context.root.clone(), context.loc.clone()))
            .or_default();
        let reason = policy::decide(p, &p_sha, n, now, &kept(location), seen);
        seen.this_run = true;
        reason
    });
    let Some(reason) = reason else {
        return Captured::NotWanted;
    };
    // Under a record naming another page, a new version could never be listed.
    if location.is_some_and(|location| location.record == Some(false)) {
        return Captured::NotKept(Unavailable);
    }
    let meta = VersionMeta {
        format: 1,
        captured_at: now,
        reason,
        recorded_path: context.rel.clone(),
        length: p.len() as u64,
        sha256: p_sha,
    };
    let record = LocationMeta {
        recorded_path: context.rel.clone(),
    };
    let (Ok(meta_bytes), Ok(record)) = (serde_json::to_vec(&meta), serde_json::to_vec(&record))
    else {
        return Captured::NotKept(Unavailable);
    };
    // Exactly the bytes publish writes, the location's record included when it is new.
    let new_record = location.is_none_or(|location| location.record.is_none());
    let cost = (p.len() + meta_bytes.len() + if new_record { record.len() } else { 0 }) as u64;
    let mut usage = Usage::of(&inventory, location);
    if !usage.fits(cost, caps) {
        // Room comes from this page's own older versions first, never its newest.
        if let Some(location) = location {
            prune(history, &context.loc, location, now, caps, &mut usage);
        }
        if !usage.fits(cost, caps) {
            return Captured::NotKept(Full);
        }
    }
    let staged = Staged {
        meta: &meta,
        meta_bytes: &meta_bytes,
        record: &record,
        p,
    };
    let name = match publish(history, context, &staged, platform) {
        Ok(name) => name,
        Err(error) if error.kind() == ErrorKind::StorageFull => return Captured::NotKept(LowSpace),
        Err(_) => return Captured::NotKept(Unavailable),
    };
    // This location's tiers now include the new version; already removed names are skipped.
    if let Some(location) = location {
        let (mut items, pinned) =
            retention::unpinned(history, &context.loc, retention::items(location));
        items.push(retention::Item {
            name: &name,
            captured_at: now,
            big: reason == VersionReason::BigChange,
            listable: true,
        });
        let plan = retention::plan(&items, now, caps.per_location.saturating_sub(pinned));
        for name in plan.into_iter().take(CAPTURE_PRUNE_LIMIT) {
            let _ = remove_entry(history, &context.loc, name);
        }
    }
    Captured::Kept
}

fn kept(location: Option<&Location>) -> Vec<Kept<'_>> {
    location
        .into_iter()
        .flat_map(|location| &location.entries)
        .filter_map(|entry| {
            entry.meta.as_ref().map(|meta| Kept {
                captured_at: meta.captured_at,
                length: meta.length,
                sha256: &meta.sha256,
            })
        })
        .collect()
}

fn prune(history: &Path, loc: &str, location: &Location, now: u64, caps: Caps, usage: &mut Usage) {
    let (items, pinned) = retention::unpinned(history, loc, retention::items(location));
    // Leave room for one more under the per-location cap, beside the versions pins keep.
    let plan = retention::plan(&items, now, caps.per_location.saturating_sub(1 + pinned));
    for name in plan.into_iter().take(CAPTURE_PRUNE_LIMIT) {
        match remove_entry(history, loc, name) {
            Some(true) => {
                let bytes = location
                    .entries
                    .iter()
                    .find(|entry| entry.name == name)
                    .map_or(0, |entry| entry.bytes);
                usage.bytes = usage.bytes.saturating_sub(bytes);
                usage.versions -= 1;
                usage.here -= 1;
            }
            // Out of the list but still counted where it now lies.
            Some(false) => {
                usage.versions -= 1;
                usage.here -= 1;
                usage.tmp += 1;
            }
            None => {}
        }
    }
}

fn write_new(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// One version's bytes, serialized once so admission and the writer agree.
struct Staged<'a> {
    meta: &'a VersionMeta,
    meta_bytes: &'a [u8],
    record: &'a [u8],
    p: &'a [u8],
}

/// Written whole and synced in `tmp/`, then renamed in: a listed version is never partial.
fn publish(
    history: &Path,
    context: &HistoryContext,
    version: &Staged<'_>,
    platform: &dyn Platform,
) -> std::io::Result<String> {
    let meta = version.meta;
    let tag = &uuid::Uuid::new_v4().simple().to_string()[..6];
    let name = format!("{:013}-{}-{tag}", meta.captured_at, &meta.sha256[..16]);
    let staged = history
        .join(TMP_DIR)
        .join(format!("{}.tmpv", uuid::Uuid::new_v4().simple()));
    fs::create_dir(&staged)?;
    let written = (|| {
        #[cfg(test)]
        fault(Fault::StorageFull)?;
        write_new(&staged.join(PAYLOAD), version.p)?;
        write_new(&staged.join(META), version.meta_bytes)?;
        platform.sync_dir(&staged)?;
        let versions = history.join(VERSIONS_DIR);
        let location = versions.join(&context.loc);
        let created = match fs::create_dir(&location) {
            Ok(()) => true,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => false,
            Err(error) => return Err(error),
        };
        if !fs::symlink_metadata(&location).is_ok_and(|meta| meta.is_dir()) {
            return Err(ErrorKind::InvalidData.into());
        }
        if fs::symlink_metadata(location.join(LOCATION)).is_err() {
            write_new(&location.join(LOCATION), version.record)?;
            platform.sync_dir(&location)?;
        }
        if created {
            #[cfg(test)]
            fault(Fault::ParentSync)?;
            platform.sync_dir(&versions)?;
        }
        fs::rename(&staged, location.join(&name))?;
        #[cfg(test)]
        fault(Fault::LocationSync)?;
        platform.sync_dir(&location)
    })();
    if written.is_err() && staged.exists() {
        remove_known(&staged);
    }
    written.map(|()| name)
}

/// Why exact earlier text could not be kept. Each is known before the caller changes anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RetainError {
    /// The store's lock, or the pin table, is taken; nothing was kept.
    Busy,
    /// Over a cap with nothing unpinned left to let go, or the disk is full.
    Full,
    /// The store cannot be used safely, or what was written did not read back exactly.
    Unavailable,
}

/// Keeps exactly `p`, the text a guarded extension write is about to replace, as a version of
/// the page at `key`, whatever the capture policy would say, an empty page included. A version
/// already kept there with the same length and hash is used instead of a second copy. The
/// version is written and synced, read back and verified, then pinned, all under the copy lock,
/// so it is on disk before the caller replaces anything and no pruning removes it while the
/// returned pin lives. Listed like any other version, with the `checkpoint` reason.
pub(crate) fn retain_version(
    roots: &VaultRoots,
    key: &Path,
    p: &[u8],
) -> Result<Retained, RetainError> {
    let caps = caps();
    if p.len() as u64 > caps.version_bytes {
        return Err(RetainError::Full);
    }
    let rel = relative(key, &roots.canonical).ok_or(RetainError::Unavailable)?;
    let context = HistoryContext {
        loc: location_key(&rel),
        rel,
        root: roots.canonical.clone(),
    };
    let slot = Slot::take().ok_or(RetainError::Busy)?;
    panic::catch_unwind(AssertUnwindSafe(|| retain_locked(&context, p, slot, caps)))
        .unwrap_or(Err(RetainError::Unavailable))
}

fn retain_locked(
    context: &HistoryContext,
    p: &[u8],
    slot: Slot,
    caps: Caps,
) -> Result<Retained, RetainError> {
    let lock = match CopyLock::acquire(&context.root) {
        Ok(lock) => lock,
        Err(LockError::Busy) => return Err(RetainError::Busy),
        Err(LockError::Unavailable(_)) => return Err(RetainError::Unavailable),
    };
    let history = lock.dir.as_path();
    let dirs = [VERSIONS_DIR, TMP_DIR].map(|name| real_folder(&history.join(name)));
    if dirs.iter().any(Result::is_err) {
        return Err(RetainError::Unavailable);
    }
    let inventory = match inventory::scan(history, ceiling(caps)) {
        Ok(inventory) => inventory,
        Err(Stop::Full) => return Err(RetainError::Full),
        Err(Stop::Unavailable(_)) => return Err(RetainError::Unavailable),
    };
    let location = inventory.locations.get(&context.loc);
    if location.is_some_and(|location| location.record == Some(false)) {
        return Err(RetainError::Unavailable);
    }
    let p_sha = hex(&sha256(p));
    let length = p.len() as u64;
    let version = |name: &str| Version {
        loc: context.loc.clone(),
        name: name.to_string(),
        sha256: p_sha.clone(),
        length,
    };
    let exact = |name: &str| {
        read_verified(history, &format!("{}/{name}", context.loc), &p_sha)
            .is_ok_and(|(bytes, _)| bytes == p)
    };
    let same = location
        .into_iter()
        .flat_map(|location| location.entries.iter().rev())
        .find(|entry| {
            entry
                .meta
                .as_ref()
                .is_some_and(|meta| meta.length == length && meta.sha256 == p_sha)
        });
    if let Some(entry) = same.filter(|entry| exact(&entry.name)) {
        // Found, not written now: an earlier sync may have failed after it became visible.
        synced(&context.root, history, &context.loc, &entry.name)?;
        return Ok(slot.pin(&context.root, history, version(&entry.name)));
    }
    let newest = location.and_then(|location| location.entries.last());
    let now = now_ms().max(newest.map_or(0, |entry| entry.captured_at + 1));
    let meta = VersionMeta {
        format: 1,
        captured_at: now,
        reason: VersionReason::Checkpoint,
        recorded_path: context.rel.clone(),
        length,
        sha256: p_sha.clone(),
    };
    let record = LocationMeta {
        recorded_path: context.rel.clone(),
    };
    let (Ok(meta_bytes), Ok(record)) = (serde_json::to_vec(&meta), serde_json::to_vec(&record))
    else {
        return Err(RetainError::Unavailable);
    };
    let new_record = location.is_none_or(|location| location.record.is_none());
    let cost = (p.len() + meta_bytes.len() + if new_record { record.len() } else { 0 }) as u64;
    let mut usage = Usage::of(&inventory, location);
    if !usage.fits(cost, caps) {
        // Only this page's own unpinned older versions make room; its newest always stays.
        if let Some(location) = location {
            prune(history, &context.loc, location, now, caps, &mut usage);
        }
        if !usage.fits(cost, caps) {
            return Err(RetainError::Full);
        }
    }
    let staged = Staged {
        meta: &meta,
        meta_bytes: &meta_bytes,
        record: &record,
        p,
    };
    let name = match publish(history, context, &staged, &NativePlatform) {
        Ok(name) => name,
        Err(error) if error.kind() == ErrorKind::StorageFull => return Err(RetainError::Full),
        Err(_) => return Err(RetainError::Unavailable),
    };
    // Verified through the same rule a list and a restore use, before the pin is given out.
    if !exact(&name) {
        return Err(RetainError::Unavailable);
    }
    synced(&context.root, history, &context.loc, &name)?;
    Ok(slot.pin(&context.root, history, version(&name)))
}

/// Proves a kept version durable now, before a pin is given out: its two files and its location's
/// record, its folder, and every folder above it up to the vault are synced, whether this call
/// wrote the version or found it. A sync that failed earlier is never taken as done since: the
/// location's sync right after a version was renamed in, or a parent's sync right after a folder
/// was created, which later calls skip because the folder already exists. So nothing is replaced
/// on the strength of a recovery copy whose entries were never confirmed.
fn synced(root: &Path, history: &Path, loc: &str, name: &str) -> Result<(), RetainError> {
    let versions = history.join(VERSIONS_DIR);
    let location = versions.join(loc);
    let entry = location.join(name);
    let proven = (|| {
        for file in [
            entry.join(PAYLOAD),
            entry.join(META),
            location.join(LOCATION),
        ] {
            fs::File::open(file)?.sync_all()?;
        }
        NativePlatform.sync_dir(&entry)?;
        #[cfg(test)]
        fault(Fault::LocationSync)?;
        NativePlatform.sync_dir(&location)?;
        #[cfg(test)]
        fault(Fault::ParentSync)?;
        let store = history.parent().unwrap_or(root);
        for dir in [versions.as_path(), history, store, root] {
            NativePlatform.sync_dir(dir)?;
        }
        Ok::<(), std::io::Error>(())
    })();
    proven.map_err(|_| RetainError::Unavailable)
}

/// A pinned version's exact bytes, read and verified under the copy lock.
pub(crate) fn read_retained(retained: &Retained) -> Result<Vec<u8>, RetainError> {
    let lock = match CopyLock::acquire_existing(retained.root()) {
        Ok(lock) => lock,
        Err(LockError::Busy) => return Err(RetainError::Busy),
        Err(LockError::Unavailable(_)) => return Err(RetainError::Unavailable),
    };
    match read_verified(&lock.dir, &retained.id(), retained.sha256()) {
        Ok((bytes, _)) if bytes.len() as u64 == retained.length() => Ok(bytes),
        _ => Err(RetainError::Unavailable),
    }
}

#[cfg(not(test))]
fn schedule_maintenance(root: &Path, urgent: bool) {
    use std::time::{Duration, Instant};
    static RUNS: Mutex<Option<HashMap<PathBuf, Instant>>> = Mutex::new(None);
    let due = with_map(&RUNS, |runs| {
        let wait = if urgent {
            Duration::from_secs(60)
        } else {
            Duration::from_secs(24 * 60 * 60)
        };
        let due = runs.get(root).is_none_or(|last| last.elapsed() >= wait);
        if due {
            runs.insert(root.to_path_buf(), Instant::now());
        }
        due
    });
    if due {
        let root = root.to_path_buf();
        let _ = std::thread::Builder::new()
            .name("page-history-maintenance".into())
            .spawn(move || retention::maintain(&root, caps(), now_ms()));
    }
}

/// Tests run maintenance directly, so nothing happens behind their back.
#[cfg(test)]
fn schedule_maintenance(_: &Path, _: bool) {}

fn last_failure(root: &Path) -> Option<NotKeptReason> {
    with_map(&LAST, |last| last.get(root).copied())
}

/// A live check now: the current inventory plus this process's latest capture result.
pub(crate) fn health(roots: &VaultRoots) -> HistoryHealth {
    let caps = caps();
    let mut health = HistoryHealth {
        state: HealthState::On,
        reason: None,
        used_bytes: None,
        budget_bytes: caps.budget_bytes,
        unreadable: 0,
        attention: Vec::new(),
    };
    fn not_keeping(health: &mut HistoryHealth, reason: NotKeptReason) {
        health.state = HealthState::NotKeeping;
        health.reason = Some(reason);
    }
    let history = roots.canonical.join(HISTORY_PATH);
    let scanned = if fs::symlink_metadata(&history).is_err() {
        Ok(Inventory::default())
    } else {
        match CopyLock::try_acquire(&roots.canonical) {
            Ok(lock) => inventory::scan(&lock.dir, ceiling(caps)),
            Err(LockError::Busy) => {
                health.state = HealthState::Unknown;
                return health;
            }
            Err(LockError::Unavailable(message)) => Err(Stop::Unavailable(PathBuf::from(message))),
        }
    };
    match scanned {
        Ok(inventory) => {
            health.used_bytes = Some(inventory.used_bytes);
            health.unreadable = inventory.unreadable;
            if !Usage::of(&inventory, Some(&Location::default())).fits(1, caps) {
                not_keeping(&mut health, NotKeptReason::Full);
            } else if let Some(reason) = last_failure(&roots.canonical) {
                not_keeping(&mut health, reason);
            }
        }
        Err(Stop::Full) => not_keeping(&mut health, NotKeptReason::Full),
        Err(Stop::Unavailable(path)) => {
            health.attention.push(path.to_string_lossy().into_owned());
            not_keeping(&mut health, NotKeptReason::Unavailable);
        }
    }
    health
}

/// A real folder at each step from the vault to `path`, never through a link.
fn real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir())
}

fn store_dir(roots: &VaultRoots) -> Option<PathBuf> {
    let store = roots.canonical.join(".leadinglight");
    let history = store.join("history");
    let versions = history.join(VERSIONS_DIR);
    [&store, &history, &versions]
        .iter()
        .all(|dir| real_dir(dir))
        .then_some(history)
}

fn row(loc: &str, name: &str, meta: VersionMeta) -> VersionRow {
    VersionRow {
        id: format!("{loc}/{name}"),
        recorded_path: meta.recorded_path,
        captured_at: meta.captured_at,
        reason: meta.reason,
        length: meta.length,
        sha256: meta.sha256,
    }
}

/// The same rule as the scan: exactly its two files, a record naming this folder and location,
/// and a payload of the recorded length. The caller checks the location's own record.
fn listed(location: &Path, loc: &str, name: &str) -> Option<VersionMeta> {
    let entry = location.join(name);
    if entry_time(name).is_none() || !real_dir(&entry) || !only_known_files(&entry) {
        return None;
    }
    let payload = fs::symlink_metadata(entry.join(PAYLOAD)).ok();
    read_meta(&entry)
        .ok()
        .flatten()
        .filter(|meta| listable(meta, loc, name, payload.as_ref()))
}

/// Each listable version in a real location folder whose own record is valid.
fn listable_in(dir: &Path, loc: &str) -> Vec<(String, VersionMeta)> {
    if !real_dir(dir) || !location_record(dir, loc).is_ok_and(|record| record.is_some()) {
        return Vec::new();
    }
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .take(caps().per_location * 2 + 8)
        .filter_map(|child| {
            let name = child.file_name().to_string_lossy().into_owned();
            listed(dir, loc, &name).map(|meta| (name, meta))
        })
        .collect()
}

/// Newest first; a listed row is a whole, published version whose metadata matches its payload.
pub(crate) fn list_versions(
    roots: &VaultRoots,
    target: &PageTarget,
    cursor: Option<&str>,
) -> ListVersionsOutcome {
    let health = health(roots);
    let mut versions = Vec::new();
    let location = relative(&target.key, &roots.canonical).map(|rel| location_key(&rel));
    if let (Some(history), Some(loc)) = (store_dir(roots), location) {
        let dir = history.join(VERSIONS_DIR).join(&loc);
        for (name, meta) in listable_in(&dir, &loc) {
            versions.push(row(&loc, &name, meta));
        }
    }
    versions.sort_by(|a, b| (b.captured_at, &b.id).cmp(&(a.captured_at, &a.id)));
    let (versions, next_cursor) = page(versions, cursor, |row| row.id.clone());
    ListVersionsOutcome::Ok {
        versions,
        next_cursor,
        health,
    }
}

/// The rows after the one named by `cursor`, at most one page, and the cursor for the next.
fn page<T>(
    rows: Vec<T>,
    cursor: Option<&str>,
    key: impl Fn(&T) -> String,
) -> (Vec<T>, Option<String>) {
    let start = cursor
        .and_then(|cursor| rows.iter().position(|row| key(row) == cursor))
        .map_or(0, |at| at + 1);
    let more = rows.len() > start + PAGE_SIZE;
    let rows: Vec<T> = rows.into_iter().skip(start).take(PAGE_SIZE).collect();
    let next = more.then(|| rows.last().map(&key)).flatten();
    (rows, next)
}

/// Every recorded location, newest first, with whether a file is there now.
pub(crate) fn list_locations(roots: &VaultRoots, cursor: Option<&str>) -> ListLocationsOutcome {
    let mut locations = Vec::new();
    if let Some(history) = store_dir(roots) {
        let versions = history.join(VERSIONS_DIR);
        let caps = caps();
        for child in fs::read_dir(&versions)
            .into_iter()
            .flatten()
            .flatten()
            .take(caps.locations * 2)
        {
            let loc = child.file_name().to_string_lossy().into_owned();
            let path = child.path();
            if !is_location_key(&loc) {
                continue;
            }
            // Counted exactly as the page's own list would show it.
            let versions = listable_in(&path, &loc);
            let (Some(newest), Ok(Some(recorded))) = (
                versions.iter().map(|(_, meta)| meta.captured_at).max(),
                location_record(&path, &loc),
            ) else {
                continue;
            };
            let page_path = roots.requested.join(&recorded);
            locations.push((
                loc,
                SavedLocation {
                    exists: fs::symlink_metadata(&page_path).is_ok_and(|meta| meta.is_file()),
                    path: recorded,
                    newest_at: newest,
                    count: versions.len() as u64,
                },
            ));
        }
    }
    locations.sort_by(|(a_key, a), (b_key, b)| (b.newest_at, b_key).cmp(&(a.newest_at, a_key)));
    let (locations, next_cursor) = page(locations, cursor, |(key, location)| {
        format!("{}:{key}", location.newest_at)
    });
    ListLocationsOutcome::Ok {
        locations: locations
            .into_iter()
            .map(|(_, location)| location)
            .collect(),
        next_cursor,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Unverified {
    Missing,
    Damaged,
}

fn parse_id(id: &str) -> Option<(&str, &str)> {
    let (loc, name) = id.split_once('/')?;
    (is_location_key(loc) && entry_time(name).is_some()).then_some((loc, name))
}

/// The whole payload, after its length and hash match both the record and the request.
pub(super) fn read_verified(
    history: &Path,
    id: &str,
    sha256_hex: &str,
) -> Result<(Vec<u8>, VersionMeta), Unverified> {
    let (loc, name) = parse_id(id).ok_or(Unverified::Missing)?;
    let versions = history.join(VERSIONS_DIR);
    let location = versions.join(loc);
    let entry = location.join(name);
    if ![
        history,
        versions.as_path(),
        location.as_path(),
        entry.as_path(),
    ]
    .into_iter()
    .all(real_dir)
    {
        return Err(Unverified::Missing);
    }
    let payload = entry.join(PAYLOAD);
    if let Err(error) = fs::symlink_metadata(&payload) {
        return Err(match error.kind() {
            ErrorKind::NotFound => Unverified::Missing,
            _ => Unverified::Damaged,
        });
    }
    // The record never raises the bound: a payload past it is refused before it is read.
    let bound = caps().version_bytes;
    let meta = location_record(&location, loc)
        .is_ok_and(|record| record.is_some())
        .then(|| listed(&location, loc, name))
        .flatten()
        .filter(|meta| meta.length <= bound)
        .ok_or(Unverified::Damaged)?;
    let mut bytes = Vec::new();
    fs::File::open(&payload)
        .and_then(|file| file.take(bound + 1).read_to_end(&mut bytes))
        .map_err(|error| match error.kind() {
            ErrorKind::NotFound => Unverified::Missing,
            _ => Unverified::Damaged,
        })?;
    let digest = hex(&sha256(&bytes));
    if bytes.len() as u64 != meta.length || digest != meta.sha256 || digest != sha256_hex {
        return Err(Unverified::Damaged);
    }
    Ok((bytes, meta))
}

/// One saved version a backup may take: its location key, folder name, length and hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExportCandidate {
    pub(crate) loc: String,
    pub(crate) name: String,
    pub(crate) length: u64,
    pub(crate) sha256: String,
}

/// A saved version's three files, exactly as stored, verified under the history lock.
pub(crate) struct ExportedVersion {
    pub(crate) location_record: Vec<u8>,
    pub(crate) record: Vec<u8>,
    pub(crate) payload: Vec<u8>,
}

/// What a backup may take from history: listable versions, how many version-shaped entries
/// history does not list, and which store folders could not be read at all.
#[derive(Debug, Default)]
pub(crate) struct ExportPlan {
    pub(crate) candidates: Vec<ExportCandidate>,
    /// Each one is an omitted version a backup must disclose.
    pub(crate) unlisted: u64,
    /// Vault-relative store paths whose contents were not considered; never "no versions".
    pub(crate) unreadable: Vec<String>,
}

/// The inventory reached the caller's entry budget; it stopped there and holds no partial plan.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct OverBudget;

const VERSIONS_REL: &str = ".leadinglight/history/versions";

fn spend(left: &mut usize) -> Result<(), OverBudget> {
    *left = left.checked_sub(1).ok_or(OverBudget)?;
    Ok(())
}

/// Every listable version, by the same rule lists use, visiting at most `budget` entries in
/// total. Read-only, and like lists it takes no lock.
pub(crate) fn export_candidates(
    roots: &VaultRoots,
    budget: usize,
) -> Result<ExportPlan, OverBudget> {
    let mut plan = ExportPlan::default();
    let mut left = budget;
    let store = roots.canonical.join(".leadinglight");
    let history = store.join("history");
    let versions = history.join(VERSIONS_DIR);
    for (dir, rel) in [
        (&store, ".leadinglight"),
        (&history, ".leadinglight/history"),
        (&versions, VERSIONS_REL),
    ] {
        match fs::symlink_metadata(dir) {
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(plan),
            Ok(meta) if meta.is_dir() => {}
            _ => {
                plan.unreadable.push(rel.to_string());
                return Ok(plan);
            }
        }
    }
    let Ok(locations) = fs::read_dir(&versions) else {
        plan.unreadable.push(VERSIONS_REL.to_string());
        return Ok(plan);
    };
    for child in locations {
        spend(&mut left)?;
        let Ok(child) = child else {
            plan.unreadable.push(VERSIONS_REL.to_string());
            break;
        };
        let loc = child.file_name().to_string_lossy().into_owned();
        let dir = child.path();
        if !is_location_key(&loc) || !real_dir(&dir) {
            continue;
        }
        let rel = format!("{VERSIONS_REL}/{loc}");
        let Ok(entries) = fs::read_dir(&dir) else {
            plan.unreadable.push(rel);
            continue;
        };
        let mut shaped = Vec::new();
        for entry in entries {
            spend(&mut left)?;
            let Ok(entry) = entry else {
                plan.unreadable.push(rel.clone());
                break;
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry_time(&name).is_some() {
                shaped.push(name);
            }
        }
        let record = match location_record(&dir, &loc) {
            Ok(record) => record,
            Err(_) => {
                plan.unreadable.push(format!("{rel}/{LOCATION}"));
                continue;
            }
        };
        for name in shaped {
            match record.as_ref().and_then(|_| listed(&dir, &loc, &name)) {
                Some(meta) => plan.candidates.push(ExportCandidate {
                    loc: loc.clone(),
                    name,
                    length: meta.length,
                    sha256: meta.sha256,
                }),
                None => plan.unlisted += 1,
            }
        }
    }
    plan.candidates
        .sort_by(|a, b| (&a.loc, &a.name).cmp(&(&b.loc, &b.name)));
    Ok(plan)
}

pub(crate) fn export_version(
    roots: &VaultRoots,
    candidate: &ExportCandidate,
) -> Option<ExportedVersion> {
    store_dir(roots)?;
    // The existing lock domain, read-only: nothing in the store is created or repaired.
    let lock = CopyLock::acquire_existing(&roots.canonical).ok()?;
    let id = format!("{}/{}", candidate.loc, candidate.name);
    let (payload, meta) = read_verified(&lock.dir, &id, &candidate.sha256).ok()?;
    let location = lock.dir.join(VERSIONS_DIR).join(&candidate.loc);
    let record = inventory::read_small(&location.join(&candidate.name).join(META)).ok()??;
    let location_record = inventory::read_small(&location.join(LOCATION)).ok()??;
    // The stored record must still be the one just verified.
    let stored: VersionMeta = serde_json::from_slice(&record).ok()?;
    (stored == meta).then_some(ExportedVersion {
        location_record,
        record,
        payload,
    })
}

pub(crate) fn read_version(roots: &VaultRoots, id: &str, sha256_hex: &str) -> ReadVersionOutcome {
    let Some(history) = store_dir(roots) else {
        return ReadVersionOutcome::Missing;
    };
    match read_verified(&history, id, sha256_hex) {
        Ok((bytes, _)) => preview(&bytes),
        Err(Unverified::Missing) => ReadVersionOutcome::Missing,
        Err(Unverified::Damaged) => ReadVersionOutcome::Damaged,
    }
}

/// Verified bytes as exact text, BOM included, shown up to 256 KiB and cut between characters.
fn preview(bytes: &[u8]) -> ReadVersionOutcome {
    let length = bytes.len() as u64;
    let bom = bytes.starts_with(b"\xEF\xBB\xBF");
    let crlf = bytes.windows(2).any(|pair| pair == b"\r\n");
    let Ok(text) = std::str::from_utf8(bytes) else {
        return ReadVersionOutcome::Ok {
            text: None,
            length,
            shown_bytes: 0,
            truncated: false,
            bom,
            crlf,
        };
    };
    let mut end = text.len().min(PREVIEW_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    ReadVersionOutcome::Ok {
        text: Some(text[..end].to_string()),
        length,
        shown_bytes: end as u64,
        truncated: end < text.len(),
        bom,
        crlf,
    }
}
