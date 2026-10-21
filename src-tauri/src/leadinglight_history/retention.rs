//! Which versions to let go, and the only way one is removed: moved out of sight first, then
//! its two known files, then its now-empty folder. Nothing is ever removed recursively.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use super::history_outcome::VersionReason;
use super::inventory::{self, Caps, Inventory, META, PAYLOAD, TMP_DIR, VERSIONS_DIR};
use super::lock::CopyLock;
use super::pins;

const HOUR_MS: u64 = 60 * 60 * 1000;
const DAY_MS: u64 = 24 * HOUR_MS;
const RECENT_MS: u64 = 2 * HOUR_MS;
const RECENT_KEPT: usize = 30;
pub(super) const MAINTENANCE_LIMIT: usize = 500;

pub(super) struct Item<'a> {
    pub(super) name: &'a str,
    pub(super) captured_at: u64,
    pub(super) big: bool,
    pub(super) listable: bool,
}

/// Names to remove at one location, oldest first. Its newest listable version always stays,
/// and so do the newest version and the newest big change in each age bucket.
pub(super) fn plan<'a>(items: &[Item<'a>], now: u64, cap: usize) -> Vec<&'a str> {
    let newest = items
        .iter()
        .filter(|item| item.listable)
        .max_by_key(|item| (item.captured_at, item.name))
        .map(|item| item.name);
    let mut ordered: Vec<&Item<'a>> = items.iter().collect();
    ordered.sort_by_key(|item| std::cmp::Reverse((item.captured_at, item.name)));
    let mut keep = Vec::new();
    let (mut recent, mut buckets) = (0, BTreeMap::new());
    for item in &ordered {
        let age = now.saturating_sub(item.captured_at);
        let is_newest = Some(item.name) == newest;
        let wanted = if age <= RECENT_MS {
            // The protected newest takes one of the recent places too.
            recent += 1;
            is_newest || recent <= RECENT_KEPT
        } else if is_newest {
            true
        } else if let Some(width) = bucket_width(age) {
            // Newest first, so the first of each kind in a bucket is its newest.
            let (newest_here, big_here) = buckets
                .entry((width, item.captured_at / width))
                .or_insert((false, false));
            let first = !*newest_here || (item.big && !*big_here);
            *newest_here = true;
            *big_here |= item.big;
            first
        } else {
            false
        };
        keep.push((item.name, wanted));
    }
    let mut kept = keep.iter().filter(|(_, wanted)| *wanted).count();
    let mut remove: Vec<&'a str> = Vec::new();
    // Oldest first, dropping the oldest kept ones too while over the cap.
    for (name, wanted) in keep.into_iter().rev() {
        if !wanted {
            remove.push(name);
        } else if kept > cap && Some(name) != newest {
            remove.push(name);
            kept -= 1;
        }
    }
    remove
}

fn bucket_width(age: u64) -> Option<u64> {
    match age {
        _ if age <= 2 * DAY_MS => Some(HOUR_MS),
        _ if age <= 30 * DAY_MS => Some(DAY_MS),
        _ if age <= 180 * DAY_MS => Some(7 * DAY_MS),
        _ => None,
    }
}

pub(super) fn items(location: &inventory::Location) -> Vec<Item<'_>> {
    location
        .entries
        .iter()
        .map(|entry| Item {
            name: &entry.name,
            captured_at: entry.captured_at,
            big: entry
                .meta
                .as_ref()
                .is_some_and(|meta| meta.reason == VersionReason::BigChange),
            listable: entry.meta.is_some(),
        })
        .collect()
}

/// The items a plan may choose from, and how many pinned ones stay beside them whatever it says,
/// so a pin is never counted as room a removal could free.
pub(super) fn unpinned<'a>(
    history: &Path,
    loc: &str,
    items: Vec<Item<'a>>,
) -> (Vec<Item<'a>>, usize) {
    let (pinned, free): (Vec<Item<'a>>, Vec<Item<'a>>) = items
        .into_iter()
        .partition(|item| pins::is_pinned(history, loc, item.name));
    (free, pinned.len())
}

/// Removes a recognized folder's two known files, then the folder if that left it empty.
pub(super) fn remove_known(dir: &Path) -> bool {
    for name in [PAYLOAD, META] {
        match fs::remove_file(dir.join(name)) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return false,
            _ => {}
        }
    }
    fs::remove_dir(dir).is_ok()
}

/// `Some(true)` when gone, `Some(false)` when moved out of the list but left in `tmp/`, `None`
/// when it stays. Every removal of a version comes here, under the copy lock, so a version an
/// offered Undo has pinned always stays.
pub(super) fn remove_entry(history: &Path, location: &str, name: &str) -> Option<bool> {
    if pins::is_pinned(history, location, name) {
        return None;
    }
    let from = history.join(VERSIONS_DIR).join(location).join(name);
    let to = history.join(TMP_DIR).join(format!("del-{location}-{name}"));
    fs::rename(from, &to).ok()?;
    Some(remove_known(&to))
}

/// Its age from the folder's modified time; an age that cannot be read counts as fresh.
fn older_than(dir: &Path, now: u64, age: u64) -> bool {
    fs::symlink_metadata(dir)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .is_some_and(|since| now.saturating_sub(since.as_millis() as u64) >= age)
}

/// A bounded pass: leftovers in `tmp/`, each location's tiers, then the oldest unprotected
/// versions while over the budget. `None` when the store is busy or cannot be counted.
pub(super) fn maintain(root: &Path, caps: Caps, now: u64) -> Option<usize> {
    let lock = CopyLock::try_acquire(root).ok()?;
    let history = lock.dir.as_path();
    let ceiling = inventory::ceiling(caps) * 2;
    let mut inventory = inventory::scan(history, ceiling).ok()?;
    let mut budget = MAINTENANCE_LIMIT;
    let mut removed = 0;
    let mut attempted = false;
    for name in &inventory.tmp {
        let dir = history.join(TMP_DIR).join(name);
        // A capture's staging is a leftover only once it is an hour old.
        if inventory::is_write_staging(name) && !older_than(&dir, now, HOUR_MS) {
            continue;
        }
        if budget == 0 {
            return Some(removed);
        }
        budget -= 1;
        attempted = true;
        removed += usize::from(remove_known(&dir));
    }
    // Each pass is judged on what the last one really left, partial removals included.
    if attempted && !recount(history, ceiling, &mut inventory) {
        return Some(removed);
    }
    let mut attempted = false;
    for (key, location) in &inventory.locations {
        let (free, pinned) = unpinned(history, key, items(location));
        for name in plan(&free, now, caps.per_location.saturating_sub(pinned)) {
            if budget == 0 {
                return Some(removed);
            }
            budget -= 1;
            attempted = true;
            removed += usize::from(remove_entry(history, key, name) == Some(true));
        }
    }
    if attempted && !recount(history, ceiling, &mut inventory) {
        return Some(removed);
    }
    let target = caps.budget_bytes / 10 * 9;
    let mut used = inventory.used_bytes;
    for (key, name, bytes) in oldest_unprotected(&inventory) {
        if used <= target || budget == 0 {
            break;
        }
        budget -= 1;
        match remove_entry(history, key, name) {
            Some(true) => {
                removed += 1;
                used = used.saturating_sub(bytes);
            }
            // It freed an unknown part; a later pass counts what is left.
            Some(false) => break,
            None => {}
        }
    }
    Some(removed)
}

/// Counts again under the same lock; `false` when the store can no longer be counted.
fn recount(history: &Path, ceiling: usize, inventory: &mut Inventory) -> bool {
    match inventory::scan(history, ceiling) {
        Ok(fresh) => {
            *inventory = fresh;
            true
        }
        Err(_) => false,
    }
}

/// Every version except each location's newest listable one, oldest first.
fn oldest_unprotected(inventory: &Inventory) -> Vec<(&str, &str, u64)> {
    let mut all = Vec::new();
    for (key, location) in &inventory.locations {
        let newest = location
            .entries
            .iter()
            .rev()
            .find(|entry| entry.meta.is_some())
            .map(|entry| entry.name.as_str());
        for entry in &location.entries {
            let name = entry.name.as_str();
            if Some(name) != newest {
                all.push((entry.captured_at, key.as_str(), name, entry.bytes));
            }
        }
    }
    all.sort();
    all.into_iter()
        .map(|(_, key, name, bytes)| (key, name, bytes))
        .collect()
}
