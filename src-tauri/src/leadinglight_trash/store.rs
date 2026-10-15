use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};
use tempfile::NamedTempFile;

const STORE_DIR: &str = ".leadinglight";
const TRASH_DIR: &str = "trash";
const LOCK_FILE: &str = "trash.lock";
const GITIGNORE_FILE: &str = ".gitignore";
const GIT_EXCLUSION_RULE: &[u8] = b"# LeadingLight: local Trash stays out of Git.\n*\n";
const LOCK_WAIT: Duration = Duration::from_secs(10);
const LOCK_RETRY: Duration = Duration::from_millis(20);
const UNAVAILABLE_PREFIX: &str = "Local Trash is unavailable: ";
const BUSY_MESSAGE: &str = "Local Trash is busy in another LeadingLight window. Try again.";

static PROCESS_LOCK: Mutex<()> = Mutex::new(());

pub(super) fn unavailable(reason: impl std::fmt::Display) -> String {
    format!("{UNAVAILABLE_PREFIX}{reason}")
}

pub(super) struct VaultRoot {
    pub(super) root: PathBuf,
    canonical: PathBuf,
}

impl VaultRoot {
    pub(super) fn open(root: &Path) -> Result<Self, String> {
        let canonical = root.canonicalize().map_err(unavailable)?;
        if !canonical.is_dir() {
            return Err(unavailable("the vault is not a folder"));
        }
        Ok(Self {
            root: root.to_path_buf(),
            canonical,
        })
    }

    pub(super) fn child(&self, relative: &str) -> PathBuf {
        relative
            .split('/')
            .fold(self.root.clone(), |path, segment| path.join(segment))
    }

    /// The vault-relative part of an already canonical path, if it is inside the vault.
    pub(super) fn relative_inside<'a>(&self, canonical: &'a Path) -> Option<&'a Path> {
        canonical.strip_prefix(&self.canonical).ok()
    }

    /// True for a folder that resolves inside the vault and outside hidden folders.
    pub(super) fn is_visible_folder(&self, path: &Path) -> bool {
        let Ok(canonical) = path.canonicalize() else {
            return false;
        };
        canonical.is_dir()
            && self.relative_inside(&canonical).is_some_and(|relative| {
                relative.components().all(|component| {
                    matches!(component, Component::Normal(name) if !name.to_string_lossy().starts_with('.'))
                })
            })
    }
}

/// An open store. Its OS lock is shared by every process and alias of the vault,
/// and it is released when this value drops or the process dies.
pub(super) struct TrashStore {
    pub(super) dir: PathBuf,
    _lock: File,
    _process: MutexGuard<'static, ()>,
}

impl TrashStore {
    pub(super) fn create(vault: &VaultRoot) -> Result<Self, String> {
        Self::open(vault, true)?.ok_or_else(|| unavailable("the store could not be created"))
    }

    /// `None` when this vault has never used Trash; nothing is created then.
    pub(super) fn existing(vault: &VaultRoot) -> Result<Option<Self>, String> {
        Self::open(vault, false)
    }

    fn open(vault: &VaultRoot, create: bool) -> Result<Option<Self>, String> {
        let process = PROCESS_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
        let base = vault.root.join(STORE_DIR);
        if !ensure_folder(&base, create)? {
            return Ok(None);
        }
        let lock = open_lock_file(&base.join(LOCK_FILE))?;
        acquire(&lock)?;
        let dir = base.join(TRASH_DIR);
        if !ensure_folder(&dir, create)? {
            return Ok(None);
        }
        if create {
            establish_git_exclusion(&base)?;
        }
        Ok(Some(Self {
            dir,
            _lock: lock,
            _process: process,
        }))
    }
}

/// A real folder only: a symlinked store could move pages out of the vault.
fn ensure_folder(path: &Path, create: bool) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => Ok(true),
        Ok(_) => Err(unavailable(format!("{} is not a folder", path.display()))),
        Err(error) if error.kind() == ErrorKind::NotFound && create => match fs::create_dir(path) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => ensure_folder(path, false),
            Err(error) => Err(unavailable(error)),
        },
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(unavailable(error)),
    }
}

fn open_lock_file(path: &Path) -> Result<File, String> {
    if fs::symlink_metadata(path).is_ok_and(|metadata| !metadata.is_file()) {
        return Err(unavailable("the lock file is not a regular file"));
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(unavailable)?;
    if !opened_file_is_entry(&file, path) {
        return Err(unavailable("the lock file changed while opening"));
    }
    Ok(file)
}

/// Rejects a lock file swapped for a symlink between the check and the open.
#[cfg(unix)]
fn opened_file_is_entry(file: &File, path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    match (file.metadata(), fs::symlink_metadata(path)) {
        (Ok(opened), Ok(entry)) => {
            entry.is_file() && opened.dev() == entry.dev() && opened.ino() == entry.ino()
        }
        _ => false,
    }
}

#[cfg(not(unix))]
fn opened_file_is_entry(_file: &File, path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file())
}

fn acquire(lock: &File) -> Result<(), String> {
    let deadline = Instant::now() + LOCK_WAIT;
    loop {
        match lock.try_lock() {
            Ok(()) => return Ok(()),
            Err(TryLockError::WouldBlock) if Instant::now() < deadline => thread::sleep(LOCK_RETRY),
            Err(TryLockError::WouldBlock) => return Err(BUSY_MESSAGE.to_string()),
            Err(TryLockError::Error(error)) => return Err(unavailable(error)),
        }
    }
}

/// Git applies the last matching rule, and a final `*` excludes the whole store,
/// including folders, so nothing below can be re-included.
pub(super) fn ignores_whole_store(content: &[u8]) -> bool {
    content
        .split(|byte| *byte == b'\n')
        .map(trim_trailing_spaces)
        .rfind(|line| !line.is_empty() && !line.starts_with(b"#"))
        == Some(b"*".as_slice())
}

/// Git drops unescaped trailing spaces only; a `\r` stays part of the rule.
fn trim_trailing_spaces(mut line: &[u8]) -> &[u8] {
    while let [rest @ .., b' '] = line {
        line = rest;
    }
    line
}

/// Keeps deleted bodies out of Git before anything moves. Existing lines are kept; when the
/// rule cannot be established and verified the move is refused.
fn establish_git_exclusion(base: &Path) -> Result<(), String> {
    let path = base.join(GITIGNORE_FILE);
    let mut content = match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() => fs::read(&path).map_err(unavailable)?,
        Ok(_) => {
            return Err(unavailable(
                ".leadinglight/.gitignore is not a regular file",
            ))
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(unavailable(error)),
    };
    if ignores_whole_store(&content) {
        return Ok(());
    }
    if !content.is_empty() && !content.ends_with(b"\n") {
        content.push(b'\n');
    }
    content.extend_from_slice(GIT_EXCLUSION_RULE);
    replace_file(base, &path, &content).map_err(unavailable)?;
    match fs::read(&path) {
        Ok(written) if ignores_whole_store(&written) => Ok(()),
        _ => Err(unavailable("the Git exclusion could not be verified")),
    }
}

fn replace_file(folder: &Path, path: &Path, content: &[u8]) -> std::io::Result<()> {
    let mut file = NamedTempFile::new_in(folder)?;
    file.write_all(content)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

/// Best effort against power loss; process interruptions are covered by rename ordering.
#[cfg(unix)]
pub(super) fn sync_folder(path: &Path) {
    if let Ok(folder) = File::open(path) {
        let _ = folder.sync_all();
    }
}

#[cfg(not(unix))]
pub(super) fn sync_folder(_path: &Path) {}
