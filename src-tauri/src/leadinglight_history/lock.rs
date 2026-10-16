//! The per-vault copy lock: this process's claim, then an OS lock on `.leadinglight/history.lock`.
//! Order is always copy lock, then the registry mutex; the registry never waits for this one.

use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use crate::vault::staged_file::{device_inode, NativePlatform, Platform};

const STORE_DIR: &str = ".leadinglight";
const HISTORY_DIR: &str = "history";
const LOCK_FILE: &str = "history.lock";
const EXCLUDE_ALL: &[u8] = b"*\n";
#[cfg(not(test))]
const LOCK_WAIT: Duration = Duration::from_secs(2);
#[cfg(test)]
const LOCK_WAIT: Duration = Duration::from_secs(1);
const LOCK_RETRY: Duration = Duration::from_millis(10);

/// Vaults whose copy lock this process holds; one entry per canonical root.
static CLAIMED: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());

struct Claim(PathBuf);

impl Drop for Claim {
    fn drop(&mut self) {
        claimed().remove(&self.0);
    }
}

fn claimed() -> std::sync::MutexGuard<'static, BTreeSet<PathBuf>> {
    CLAIMED.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Debug)]
pub(super) enum LockError {
    Busy,
    Unavailable(String),
}

fn unavailable(reason: impl std::fmt::Display) -> LockError {
    LockError::Unavailable(format!("Page history is unavailable: {reason}"))
}

/// Held for one copy or keep-copy step; released on drop or when the process dies.
pub(super) struct CopyLock {
    /// `.leadinglight/history`, a real folder that Git already skips.
    pub(super) dir: PathBuf,
    _file: File,
    _claim: Claim,
}

impl CopyLock {
    pub(super) fn acquire(root: &Path) -> Result<Self, LockError> {
        let deadline = Instant::now() + LOCK_WAIT;
        while !claimed().insert(root.to_path_buf()) {
            wait_or_busy(deadline)?;
        }
        let claim = Claim(root.to_path_buf());
        let base = real_folder(&root.join(STORE_DIR))?;
        let file = open_lock_file(&base.join(LOCK_FILE))?;
        loop {
            match file.try_lock() {
                Ok(()) => break,
                Err(fs::TryLockError::WouldBlock) => wait_or_busy(deadline)?,
                Err(fs::TryLockError::Error(error)) => return Err(unavailable(error)),
            }
        }
        let dir = real_folder(&base.join(HISTORY_DIR))?;
        exclude_from_git(&dir)?;
        Ok(Self {
            dir,
            _file: file,
            _claim: claim,
        })
    }
}

fn wait_or_busy(deadline: Instant) -> Result<(), LockError> {
    if Instant::now() >= deadline {
        return Err(LockError::Busy);
    }
    thread::sleep(LOCK_RETRY);
    Ok(())
}

/// A real folder only, created when missing: a linked store could write outside the vault.
/// Its entry is synced, so an intent written inside it cannot be lost with the folder.
fn real_folder(path: &Path) -> Result<PathBuf, LockError> {
    match fs::create_dir(path) {
        Err(error) if error.kind() != ErrorKind::AlreadyExists => return Err(unavailable(error)),
        _ => {}
    }
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => {}
        _ => return Err(unavailable(format!("{} is not a folder", path.display()))),
    }
    let parent = path.parent().unwrap_or(path);
    NativePlatform.sync_dir(parent).map_err(unavailable)?;
    Ok(path.to_path_buf())
}

fn open_lock_file(path: &Path) -> Result<File, LockError> {
    let not_plain = || unavailable("the lock file is not a regular file");
    if fs::symlink_metadata(path).is_ok_and(|meta| !meta.is_file()) {
        return Err(not_plain());
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(unavailable)?;
    // Rejects a lock file swapped for a link between the check and the open.
    let same = match (file.metadata(), fs::symlink_metadata(path)) {
        (Ok(opened), Ok(entry)) => entry.is_file() && device_inode(&opened) == device_inode(&entry),
        _ => false,
    };
    same.then_some(file).ok_or_else(not_plain)
}

/// Written before any intent, so Git skips the folder even under a parent `!` rule.
fn exclude_from_git(dir: &Path) -> Result<(), LockError> {
    let path = dir.join(".gitignore");
    // Git ignores a linked `.gitignore`, so only a regular file counts.
    let excluded = || {
        fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_file())
            && fs::read(&path).is_ok_and(|content| content == EXCLUDE_ALL)
    };
    if excluded() {
        return Ok(());
    }
    write_file(&NativePlatform, dir, &path, EXCLUDE_ALL).map_err(unavailable)?;
    excluded()
        .then_some(())
        .ok_or_else(|| unavailable("the Git exclusion could not be verified"))
}

/// Replaces `path` in one step with fully synced `content`, its folder entry synced too.
pub(super) fn write_file(
    platform: &dyn Platform,
    dir: &Path,
    path: &Path,
    content: &[u8],
) -> std::io::Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(dir)?;
    file.write_all(content)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    platform.sync_dir(dir)
}
