//! Pins on kept versions that an offered Undo still needs. A pinned version is never removed:
//! every removal goes through `retention::remove_entry`, which asks here first, and pins are
//! only added under the same copy lock, so a pin and a removal never cross. Pins live in this
//! process's memory, exactly as long as the Undo they back; the app runs a single instance, so
//! no other process prunes the store meanwhile. Once unpinned, a version is ordinary history.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Versions this process pins at once. Each is one extension page of at most 1 MiB, so pins
/// hold at most a quarter of the history budget.
pub(crate) const MAX_PINS: usize = 128;

/// The history folder, the location key and the version folder name.
type Key = (PathBuf, String, String);

struct Pins {
    held: BTreeMap<Key, usize>,
    /// Pins plus slots taken for versions still being kept.
    slots: usize,
}

static PINS: Mutex<Pins> = Mutex::new(Pins {
    held: BTreeMap::new(),
    slots: 0,
});

fn pins() -> MutexGuard<'static, Pins> {
    PINS.lock().unwrap_or_else(PoisonError::into_inner)
}

fn key(history: &Path, loc: &str, name: &str) -> Key {
    (history.to_path_buf(), loc.to_string(), name.to_string())
}

pub(super) fn is_pinned(history: &Path, loc: &str, name: &str) -> bool {
    pins().held.contains_key(&key(history, loc, name))
}

/// Room for one pin, taken before anything is written, so a full table refuses first.
pub(super) struct Slot {
    armed: bool,
}

impl Slot {
    pub(super) fn take() -> Option<Self> {
        let mut pins = pins();
        if pins.slots >= MAX_PINS {
            return None;
        }
        pins.slots += 1;
        Some(Self { armed: true })
    }

    /// Call only under the store's copy lock, after the version was verified on disk.
    pub(super) fn pin(mut self, root: &Path, history: &Path, version: Version) -> Retained {
        self.armed = false;
        let key = key(history, &version.loc, &version.name);
        *pins().held.entry(key.clone()).or_default() += 1;
        Retained {
            root: root.to_path_buf(),
            key,
            sha256: version.sha256,
            length: version.length,
        }
    }
}

impl Drop for Slot {
    fn drop(&mut self) {
        if self.armed {
            pins().slots -= 1;
        }
    }
}

/// A version just verified on disk.
pub(super) struct Version {
    pub(super) loc: String,
    pub(super) name: String,
    pub(super) sha256: String,
    pub(super) length: u64,
}

/// Exact earlier text kept as a page-history version and pinned until this value drops.
pub(crate) struct Retained {
    /// The vault's resolved root, whose copy lock guards the version.
    root: PathBuf,
    key: Key,
    sha256: String,
    length: u64,
}

impl Retained {
    /// The version's id, as page history lists it.
    pub(crate) fn id(&self) -> String {
        format!("{}/{}", self.key.1, self.key.2)
    }

    pub(crate) fn sha256(&self) -> &str {
        &self.sha256
    }

    pub(crate) fn length(&self) -> u64 {
        self.length
    }

    pub(super) fn root(&self) -> &Path {
        &self.root
    }
}

impl Drop for Retained {
    fn drop(&mut self) {
        let mut pins = pins();
        if let Some(count) = pins.held.get_mut(&self.key) {
            *count -= 1;
            if *count == 0 {
                pins.held.remove(&self.key);
            }
        }
        pins.slots -= 1;
    }
}

#[cfg(test)]
pub(crate) fn pinned_in(root: &Path) -> usize {
    pins()
        .held
        .iter()
        .filter(|((history, _, _), _)| history.starts_with(root))
        .map(|(_, count)| count)
        .sum()
}
