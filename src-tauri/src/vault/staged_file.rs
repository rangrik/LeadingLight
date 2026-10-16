//! Filesystem steps for replacing one page safely: check it is a plain file, stage the new
//! bytes beside it, publish in one step, and say truthfully what is on disk.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::atomic_replace::{self, PublishError};

/// Staging and kept recovery folders sit beside the page under this name prefix.
pub(crate) const STAGING_PREFIX: &str = ".leadinglight-";

/// Why a path is no longer the single plain file that was read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mismatch {
    Missing,
    Linked,
    Changed,
}

/// What a recheck that reads the page found; a failed read proves nothing either way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Recheck {
    Differs(Mismatch),
    Unreadable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileIdentity {
    device: u64,
    inode: u64,
    len: u64,
    modified: Option<SystemTime>,
}

/// Device and inode; `None` where the platform gives no stable file number.
pub(crate) fn device_inode(meta: &fs::Metadata) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some((meta.dev(), meta.ino()))
    }
    #[cfg(not(unix))]
    {
        let _ = meta;
        None
    }
}

fn identity(meta: &fs::Metadata) -> FileIdentity {
    let (device, inode) = device_inode(meta).unwrap_or((0, 0));
    FileIdentity {
        device,
        inode,
        len: meta.len(),
        modified: meta.modified().ok(),
    }
}

/// The identity of whatever is at `path`, without following a final symlink.
pub(crate) fn file_identity(path: &Path) -> Option<FileIdentity> {
    fs::symlink_metadata(path).ok().map(|meta| identity(&meta))
}

pub(crate) fn sha256(bytes: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut digest = [0; 32];
    digest.copy_from_slice(&Sha256::digest(bytes));
    digest
}

fn link_count(meta: &fs::Metadata) -> u64 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        meta.nlink()
    }
    #[cfg(not(unix))]
    {
        let _ = meta;
        1
    }
}

/// A single-link regular file at `path`, or why it is not one.
pub(crate) fn plain_file(path: &Path) -> Result<fs::Metadata, Mismatch> {
    let meta = fs::symlink_metadata(path).map_err(|_| Mismatch::Missing)?;
    if meta.file_type().is_symlink() || link_count(&meta) > 1 {
        return Err(Mismatch::Linked);
    }
    if !meta.is_file() {
        return Err(Mismatch::Missing);
    }
    Ok(meta)
}

fn read_with_identity(path: &Path) -> std::io::Result<(Vec<u8>, FileIdentity)> {
    let mut file = fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok((bytes, identity(&file.metadata()?)))
}

/// A page as first read: its path, which file it was, and its exact bytes.
pub(crate) struct Original {
    pub(crate) path: PathBuf,
    identity: FileIdentity,
    pub(crate) bytes: Vec<u8>,
}

impl Original {
    pub(crate) fn read(path: &Path) -> std::io::Result<Self> {
        let (bytes, identity) = read_with_identity(path)?;
        Ok(Self {
            path: path.to_path_buf(),
            identity,
            bytes,
        })
    }

    /// Same file by identity only, so an edit that keeps the size and modified time passes.
    pub(crate) fn recheck_identity(&self) -> Result<(), Mismatch> {
        let meta = plain_file(&self.path)?;
        if identity(&meta) == self.identity {
            Ok(())
        } else {
            Err(Mismatch::Changed)
        }
    }

    /// Same file and exact same bytes; the path is checked again so a swap during the read shows.
    pub(crate) fn recheck_exact(&self) -> Result<(), Mismatch> {
        self.fingerprint()
            .recheck()
            .map_err(|recheck| match recheck {
                Recheck::Differs(mismatch) => mismatch,
                Recheck::Unreadable => Mismatch::Changed,
            })
    }

    pub(crate) fn fingerprint(&self) -> Fingerprint {
        Fingerprint {
            path: self.path.clone(),
            identity: self.identity.clone(),
            sha256: sha256(&self.bytes),
        }
    }
}

/// What was read, without the text, so it can be proven unchanged later.
#[derive(Debug, Clone)]
pub(crate) struct Fingerprint {
    path: PathBuf,
    identity: FileIdentity,
    sha256: [u8; 32],
}

impl Fingerprint {
    /// Same file, then the same bytes through one handle, then the same file again.
    pub(crate) fn recheck(&self) -> Result<(), Recheck> {
        let same_file = || match plain_file(&self.path) {
            Ok(meta) if identity(&meta) == self.identity => Ok(()),
            Ok(_) => Err(Recheck::Differs(Mismatch::Changed)),
            Err(mismatch) => Err(Recheck::Differs(mismatch)),
        };
        same_file()?;
        let (bytes, seen) = read_with_identity(&self.path).map_err(|_| Recheck::Unreadable)?;
        if seen != self.identity || sha256(&bytes) != self.sha256 {
            return Err(Recheck::Differs(Mismatch::Changed));
        }
        same_file()
    }
}

/// A uniquely named sibling folder keeps the staged copy on the page's volume.
pub(crate) fn stage(path: &Path, bytes: &[u8]) -> std::io::Result<(tempfile::TempDir, PathBuf)> {
    let parent = path.parent().ok_or(std::io::ErrorKind::NotFound)?;
    let name = path.file_name().ok_or(std::io::ErrorKind::NotFound)?;
    let permissions = fs::metadata(path)?.permissions();
    stage_in(parent, name.as_ref(), bytes, Some(permissions))
}

/// Stages `bytes` as `name` in a new `.leadinglight-*` folder inside `dir`.
pub(crate) fn stage_in(
    dir: &Path,
    name: &Path,
    bytes: &[u8],
    permissions: Option<fs::Permissions>,
) -> std::io::Result<(tempfile::TempDir, PathBuf)> {
    let staging = tempfile::Builder::new()
        .prefix(STAGING_PREFIX)
        .tempdir_in(dir)?;
    // Written before any page text, so Git skips the copy even under a parent `!` rule.
    fs::write(staging.path().join(".gitignore"), "*\n")?;
    let staged = staging.path().join(name);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged)?;
    file.write_all(bytes)?;
    if let Some(permissions) = permissions {
        file.set_permissions(permissions)?;
    }
    file.sync_all()?;
    Ok((staging, staged))
}

pub(crate) trait Platform {
    fn publish(&self, original: &Path, staged: &Path) -> Result<PathBuf, PublishError>;
    fn sync_dir(&self, dir: &Path) -> std::io::Result<()>;
}

pub(crate) struct NativePlatform;

impl Platform for NativePlatform {
    fn publish(&self, original: &Path, staged: &Path) -> Result<PathBuf, PublishError> {
        atomic_replace::replace_item(original, staged)
    }

    fn sync_dir(&self, dir: &Path) -> std::io::Result<()> {
        atomic_replace::sync_dir(dir)
    }
}

/// What is on disk after a publish attempt.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Published {
    /// The page holds the staged bytes; `durable` is false when the folder sync failed.
    Committed { durable: bool },
    /// Nothing was published and the original is proven unchanged.
    Failed,
    /// Not proven either way, so every file is kept for recovery.
    Uncertain {
        original_at: Option<PathBuf>,
        staged_at: Option<PathBuf>,
    },
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

/// Not a compare-and-swap: an outside writer can still act after the caller's last recheck,
/// and the macOS publish does not refuse a page removed in that gap.
pub(crate) fn publish(
    original: &Original,
    staging: tempfile::TempDir,
    staged: &Path,
    platform: &impl Platform,
) -> Published {
    let path = &original.path;
    let published = platform.publish(path, staged);
    if let Err(error) = &published {
        log::warn!("Publish failed for {}: {}", path.display(), error.message);
    }
    match published {
        Ok(resulting) if same_path(&resulting, path) => {
            let durable = path
                .parent()
                .is_some_and(|dir| platform.sync_dir(dir).is_ok());
            drop(staging);
            Published::Committed { durable }
        }
        Ok(resulting) => {
            let _ = staging.keep();
            Published::Uncertain {
                original_at: None,
                staged_at: Some(resulting),
            }
        }
        // Foundation can name the original's own path as where it now is.
        Err(error)
            if error
                .original_at
                .as_deref()
                .is_none_or(|at| same_path(at, path))
                && original.recheck_exact().is_ok() =>
        {
            Published::Failed
        }
        Err(error) => {
            let staged_at = fs::symlink_metadata(staged)
                .is_ok()
                .then(|| staged.to_path_buf());
            let _ = staging.keep();
            Published::Uncertain {
                original_at: error.original_at,
                staged_at,
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    const BODY: &str = "# Plan\n\nKeep this body.\n";

    type Change<'a> = &'a dyn Fn(&Path);
    type Check = Result<(), Mismatch>;

    #[test]
    fn exact_recheck_needs_the_same_file_and_the_same_bytes() {
        let untouched = |_: &Path| {};
        let same_size_and_time = |path: &Path| {
            let modified = fs::metadata(path).unwrap().modified().unwrap();
            fs::write(path, BODY.replace("Keep", "Lose")).unwrap();
            let file = fs::File::options().write(true).open(path).unwrap();
            file.set_modified(modified).unwrap();
        };
        let same_bytes_new_file = |path: &Path| {
            use std::os::unix::fs::MetadataExt;
            let before = fs::metadata(path).unwrap();
            let copy = path.with_extension("copy");
            fs::copy(path, &copy).unwrap();
            let file = fs::File::options().write(true).open(&copy).unwrap();
            file.set_modified(before.modified().unwrap()).unwrap();
            // Only the inode may differ, so this row proves the inode is checked.
            let after = fs::metadata(&copy).unwrap();
            assert_eq!(fs::read(&copy).unwrap(), fs::read(path).unwrap());
            assert_eq!(
                (after.dev(), after.len(), after.modified().unwrap()),
                (before.dev(), before.len(), before.modified().unwrap())
            );
            assert_ne!(after.ino(), before.ino());
            fs::rename(&copy, path).unwrap();
        };
        let removed = |path: &Path| fs::remove_file(path).unwrap();
        let hard_linked = |path: &Path| fs::hard_link(path, path.with_extension("link")).unwrap();
        let symlinked = |path: &Path| {
            let moved = path.with_extension("moved");
            fs::rename(path, &moved).unwrap();
            std::os::unix::fs::symlink(&moved, path).unwrap();
        };
        // Each change, then what the identity-only and the exact rechecks must say.
        let cases: [(Change<'_>, Check, Check); 6] = [
            (&untouched, Ok(()), Ok(())),
            (&same_size_and_time, Ok(()), Err(Mismatch::Changed)),
            (
                &same_bytes_new_file,
                Err(Mismatch::Changed),
                Err(Mismatch::Changed),
            ),
            (&removed, Err(Mismatch::Missing), Err(Mismatch::Missing)),
            (&hard_linked, Err(Mismatch::Linked), Err(Mismatch::Linked)),
            (&symlinked, Err(Mismatch::Linked), Err(Mismatch::Linked)),
        ];
        for (case, (change, by_identity, exact)) in cases.into_iter().enumerate() {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("page.md");
            fs::write(&path, BODY).unwrap();
            let original = Original::read(&path).unwrap();

            change(&path);

            assert_eq!(original.recheck_identity(), by_identity, "case {case}");
            assert_eq!(original.recheck_exact(), exact, "case {case}");
        }
    }
}
