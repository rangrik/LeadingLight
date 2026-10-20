//! The one write an E1 run may make: a new Markdown page in a folder the person chose, never over
//! an existing file. Steps: check the name, size and digest; check the folder is still the bound
//! one; take one path lease; stage beside the target; check the folder again; publish with
//! no-clobber; sync the folder; read the result back. Every refusal before publication proves
//! nothing was written; a publication that cannot be proven either way is `uncertain`, and its
//! files are kept for recovery.

use std::fs;
use std::io::{ErrorKind, Read};
use std::path::{Component, Path, PathBuf};

use tempfile::{PathPersistError, TempDir, TempPath};

use super::wire::{CommitKind, ConflictReason, HandleRefusal, ProposalReceipt, ProposalRefusal};
use super::{hex, is_sha256_hex};
use crate::leadinglight_history::lease;
use crate::vault::filename_rules::validate_filename_stem;
use crate::vault::staged_file::{
    device_inode, plain_file, sha256, stage_in, NativePlatform, Platform,
};

/// UTF-8 bytes of encoded content (`PROPOSAL_LIMITS.contentBytes`).
pub(crate) const MAX_CONTENT_BYTES: usize = 1024 * 1024;
/// UTF-8 bytes of the file name (`PROPOSAL_LIMITS.fileNameBytes`).
pub(crate) const MAX_FILE_NAME_BYTES: usize = 255;

/// A folder bound to a run: where it resolved, which folder it was, and how to show it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BoundFolder {
    pub(crate) path: PathBuf,
    pub(crate) identity: Option<(u64, u64)>,
    /// Vault-relative with `/`; empty for the vault root.
    pub(crate) relative: String,
}

/// The vault a run belongs to, as requested and as resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Vault {
    pub(crate) requested: PathBuf,
    pub(crate) canonical: PathBuf,
}

/// What an admitted write was given when its run claimed it.
#[derive(Debug, Clone)]
pub(crate) struct Claim {
    pub(crate) vault: Vault,
    pub(crate) folder: BoundFolder,
}

/// The two filesystem effects tests replace; everything else is ordinary filesystem work.
pub(crate) trait CreateIo: Send + Sync {
    fn persist(&self, staged: TempPath, target: &Path) -> Result<(), PathPersistError>;
    fn sync_dir(&self, dir: &Path) -> std::io::Result<()>;
}

pub(crate) struct NativeCreateIo;

impl CreateIo for NativeCreateIo {
    fn persist(&self, staged: TempPath, target: &Path) -> Result<(), PathPersistError> {
        staged.persist_noclobber(target)
    }

    fn sync_dir(&self, dir: &Path) -> std::io::Result<()> {
        NativePlatform.sync_dir(dir)
    }
}

/// An existing real folder inside the vault, reached without following any link, outside every
/// hidden or internal folder (any segment starting with `.`, as the folder tree hides them).
pub(crate) fn resolve_folder(root: &Path, folder: &str) -> Result<BoundFolder, HandleRefusal> {
    if folder.contains('\0') {
        return Err(HandleRefusal::OutsideVault);
    }
    let relative = Path::new(folder);
    let mut current = root.to_path_buf();
    let mut parts: Vec<String> = Vec::new();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(HandleRefusal::OutsideVault);
        };
        let Some(name) = name.to_str() else {
            return Err(HandleRefusal::OutsideVault);
        };
        if name.starts_with('.') {
            return Err(HandleRefusal::OutsideVault);
        }
        current.push(name);
        let meta = fs::symlink_metadata(&current).map_err(|_| HandleRefusal::Missing)?;
        if meta.file_type().is_symlink() {
            return Err(HandleRefusal::Link);
        }
        if !meta.is_dir() {
            return Err(HandleRefusal::NotFolder);
        }
        parts.push(name.to_string());
    }
    let canonical = current.canonicalize().map_err(|_| HandleRefusal::Missing)?;
    if canonical != current {
        return Err(HandleRefusal::Link);
    }
    if !canonical.starts_with(root) {
        return Err(HandleRefusal::OutsideVault);
    }
    let meta = fs::symlink_metadata(&canonical).map_err(|_| HandleRefusal::Missing)?;
    if !meta.is_dir() {
        return Err(HandleRefusal::NotFolder);
    }
    Ok(BoundFolder {
        path: canonical,
        identity: device_inode(&meta),
        relative: parts.join("/"),
    })
}

/// One ordinary Markdown name: a portable stem, not hidden, ending in `.md`.
pub(crate) fn valid_file_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".md") else {
        return false;
    };
    name.len() <= MAX_FILE_NAME_BYTES
        && !stem.is_empty()
        && !stem.starts_with('.')
        && stem.trim() == stem
        && !name.chars().any(char::is_control)
        && validate_filename_stem(stem).is_ok()
}

/// Still the bound folder: same resolved path and the same folder by identity.
fn recheck(claim: &Claim) -> Result<(), ProposalRefusal> {
    match resolve_folder(&claim.vault.canonical, &claim.folder.relative) {
        Ok(now) if now.path == claim.folder.path && now.identity == claim.folder.identity => Ok(()),
        Ok(_) => Err(ProposalRefusal::HandleMismatch),
        Err(HandleRefusal::Missing | HandleRefusal::NotFolder) => {
            Err(ProposalRefusal::StorageUnavailable)
        }
        Err(_) => Err(ProposalRefusal::HandleMismatch),
    }
}

/// The page path as the vault was requested, so it matches the UI's own entries.
fn receipt_path(claim: &Claim, file_name: &str) -> String {
    let folder = if claim.folder.relative.is_empty() {
        claim.vault.requested.clone()
    } else {
        claim.vault.requested.join(&claim.folder.relative)
    };
    folder.join(file_name).to_string_lossy().into_owned()
}

/// What `content` is, as given by the proposal.
pub(crate) struct Content<'a> {
    pub(crate) file_name: &'a str,
    pub(crate) text: &'a str,
    pub(crate) sha256: &'a str,
}

pub(crate) fn publish(
    io: &dyn CreateIo,
    claim: &Claim,
    operation_id: &str,
    content: &Content<'_>,
) -> ProposalReceipt {
    let refused = |reason| ProposalReceipt::refused(operation_id, reason);
    if !valid_file_name(content.file_name) {
        return refused(ProposalRefusal::InvalidName);
    }
    if content.text.len() > MAX_CONTENT_BYTES {
        return refused(ProposalRefusal::TooLarge);
    }
    if !is_sha256_hex(content.sha256) || hex(&sha256(content.text.as_bytes())) != content.sha256 {
        return refused(ProposalRefusal::DigestMismatch);
    }
    if let Err(reason) = recheck(claim) {
        return refused(reason);
    }
    let target = claim.folder.path.join(content.file_name);
    // The one lease for this write; ordinary saves of this path answer busy while it is held.
    let Ok(_lease) = lease(&[&target]) else {
        return refused(ProposalRefusal::Busy);
    };
    match fs::symlink_metadata(&target) {
        Ok(_) => return exists(operation_id),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(_) => return refused(ProposalRefusal::StorageUnavailable),
    }
    let Ok((staging, staged)) = stage_in(
        &claim.folder.path,
        Path::new(content.file_name),
        content.text.as_bytes(),
        None,
    ) else {
        return refused(ProposalRefusal::StorageUnavailable);
    };
    let staged_identity = fs::symlink_metadata(&staged)
        .ok()
        .as_ref()
        .and_then(device_inode);
    if let Err(reason) = recheck(claim) {
        return refused(reason);
    }
    let Ok(pending) = TempPath::try_from_path(&staged) else {
        return refused(ProposalRefusal::StorageUnavailable);
    };
    let published = Published {
        io,
        claim,
        operation_id,
        content,
        target: &target,
        staged_identity,
    };
    match io.persist(pending, &target) {
        Ok(()) => published.committed(staging),
        Err(error) if error.error.kind() == ErrorKind::AlreadyExists => {
            drop(error);
            exists(operation_id)
        }
        Err(error) => published.after_failure(error, staging, &staged),
    }
}

fn exists(operation_id: &str) -> ProposalReceipt {
    ProposalReceipt::Conflict {
        operation_id: operation_id.to_string(),
        reason: ConflictReason::Exists,
    }
}

struct Published<'p> {
    io: &'p dyn CreateIo,
    claim: &'p Claim,
    operation_id: &'p str,
    content: &'p Content<'p>,
    target: &'p Path,
    staged_identity: Option<(u64, u64)>,
}

impl Published<'_> {
    /// The target is ours: the folder is synced, then the page is read back through one handle.
    fn committed(&self, staging: TempDir) -> ProposalReceipt {
        let durable = self.io.sync_dir(&self.claim.folder.path).is_ok();
        drop(staging);
        match read_back(self.target, self.staged_identity, self.content.text.len()) {
            Some(bytes) if hex(&sha256(&bytes)) == self.content.sha256 => {
                ProposalReceipt::Committed {
                    kind: CommitKind::Create,
                    operation_id: self.operation_id.to_string(),
                    path: receipt_path(self.claim, self.content.file_name),
                    before_sha256: None,
                    after_sha256: self.content.sha256.to_string(),
                    durable,
                    undo_receipt: None,
                }
            }
            _ => ProposalReceipt::uncertain(self.operation_id),
        }
    }

    /// A failed publish proves nothing was written only while the staged file is still ours and
    /// nothing is at the target; otherwise every file is kept and the write is uncertain.
    fn after_failure(
        &self,
        error: PathPersistError,
        staging: TempDir,
        staged: &Path,
    ) -> ProposalReceipt {
        let identity_at = |path: &Path| {
            fs::symlink_metadata(path)
                .ok()
                .as_ref()
                .and_then(device_inode)
        };
        if self.staged_identity.is_some() && identity_at(self.target) == self.staged_identity {
            drop(error);
            return self.committed(staging);
        }
        let staged_kept =
            self.staged_identity.is_some() && identity_at(staged) == self.staged_identity;
        let target_absent = matches!(fs::symlink_metadata(self.target), Err(missing) if missing.kind() == ErrorKind::NotFound);
        if staged_kept && target_absent {
            drop(error);
            return ProposalReceipt::refused(
                self.operation_id,
                ProposalRefusal::StorageUnavailable,
            );
        }
        log::warn!(
            "An extension write could not be confirmed; its staged copy is kept: {}",
            error.error
        );
        let _ = error.path.keep();
        let _ = staging.keep();
        ProposalReceipt::uncertain(self.operation_id)
    }
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

/// The published file as opened: a single-link regular file of exactly the staged identity and
/// the expected length.
fn is_published(meta: &fs::Metadata, identity: (u64, u64), length: usize) -> bool {
    meta.is_file()
        && link_count(meta) == 1
        && device_inode(meta) == Some(identity)
        && meta.len() == length as u64
}

/// The page's bytes, only if it is still the single plain file that was published: the path is
/// checked, then the opened handle before reading, then at most one byte more than expected is
/// read, then the handle and the path again. This bounds what a racing writer can make it read
/// and refuses a path that changed meanwhile. It is not a handle-relative open: another local
/// process racing the path between the first check and the open is not excluded, only caught.
fn read_back(target: &Path, identity: Option<(u64, u64)>, length: usize) -> Option<Vec<u8>> {
    let identity = identity?;
    // A link, a FIFO or anything but the plain file is never opened.
    let before = plain_file(target).ok()?;
    if device_inode(&before) != Some(identity) {
        return None;
    }
    let file = fs::File::open(target).ok()?;
    if !is_published(&file.metadata().ok()?, identity, length) {
        return None;
    }
    let mut bytes = Vec::with_capacity(length);
    (&file)
        .take(length as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() != length || !is_published(&file.metadata().ok()?, identity, length) {
        return None;
    }
    let after = plain_file(target).ok()?;
    (device_inode(&after) == Some(identity)).then_some(bytes)
}
