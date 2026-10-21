//! An existing page a run may add to, and the Undo of both kinds of write. Binding reads the page
//! once and keeps its digest as the handle's baseline, which never changes. Adding replaces the
//! whole page with the host's reviewed postimage, once, under one page lease: the page is read
//! and compared with the baseline, its exact bytes are kept as a verified, pinned page-history
//! version, the postimage is staged, the exact baseline is checked again, and only then is the
//! page replaced. Undo works the same way in reverse, or moves a created page to Trash through
//! the guarded Trash move. Every refusal proves nothing was written; anything that cannot be
//! proven after a publication was attempted is `uncertain`.
//!
//! Native never reads or judges commentary metadata or passages: the trusted host prepares the
//! postimage, and this module guarantees only which page, which bytes before and which after.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use super::create::{resolve_folder, BoundFolder, CreateIo, Vault, MAX_CONTENT_BYTES};
use super::wire::{
    CommitKind, ConflictReason, HandleRefusal, ProposalReceipt, ProposalRefusal, UndoConflict,
    UndoKind, UndoReceipt, UndoRefusal,
};
use super::{hex, is_sha256_hex};
use crate::leadinglight_history::{
    lease, page_key, read_retained, retain_version, RetainError, Retained, VaultRoots,
};
use crate::leadinglight_trash::{move_exact_to_trash, ExactTrashOutcome};
use crate::vault::atomic_replace::PublishError;
use crate::vault::staged_file::{
    self, plain_file, sha256, Mismatch, Original, Platform, Published, Recheck,
};

const LIMIT: u64 = MAX_CONTENT_BYTES as u64;

/// A page bound to a run: where it is, how it was reached and the bytes it held then.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BoundDocument {
    pub(crate) folder: BoundFolder,
    /// The folder's resolved path joined with the page's name; never through a link.
    pub(crate) path: PathBuf,
    /// Vault-relative with `/`.
    pub(crate) relative: String,
    /// SHA-256 of the bytes read when bound: the immutable baseline.
    pub(crate) baseline: String,
}

/// The page's folder and name from a vault-relative path, without following any link.
fn locate(root: &Path, relative: &str) -> Result<(BoundFolder, String, PathBuf), HandleRefusal> {
    if relative.is_empty() || relative.contains('\0') || relative.starts_with('/') {
        return Err(HandleRefusal::OutsideVault);
    }
    let (folder, name) = relative.rsplit_once('/').unwrap_or(("", relative));
    if name.is_empty() || name.starts_with('.') {
        return Err(HandleRefusal::OutsideVault);
    }
    let folder = resolve_folder(root, folder)?;
    if !name.ends_with(".md") {
        return Err(HandleRefusal::NotDocument);
    }
    let path = folder.path.join(name);
    Ok((folder, name.to_string(), path))
}

pub(crate) fn relative_of(folder: &BoundFolder, name: &str) -> String {
    if folder.relative.is_empty() {
        name.to_string()
    } else {
        format!("{}/{name}", folder.relative)
    }
}

/// Reads the page the person chose or the host resolved, within the content bound, and binds
/// its exact digest. Text the host cannot add to is refused here, before any review.
pub(crate) fn bind(root: &Path, relative: &str) -> Result<BoundDocument, HandleRefusal> {
    let (folder, name, path) = locate(root, relative)?;
    let meta = match fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == ErrorKind::NotFound => return Err(HandleRefusal::Missing),
        Err(_) => return Err(HandleRefusal::NotDocument),
    };
    if meta.file_type().is_symlink() {
        return Err(HandleRefusal::Link);
    }
    if !meta.is_file() {
        return Err(HandleRefusal::NotDocument);
    }
    match plain_file(&path) {
        Ok(_) => {}
        Err(Mismatch::Linked) => return Err(HandleRefusal::Link),
        Err(_) => return Err(HandleRefusal::Missing),
    }
    let original = match Original::read_within(&path, LIMIT) {
        Ok(Some(original)) => original,
        Ok(None) => return Err(HandleRefusal::Unsupported),
        Err(error) if error.kind() == ErrorKind::NotFound => return Err(HandleRefusal::Missing),
        Err(_) => return Err(HandleRefusal::NotDocument),
    };
    // The handle that was read is still the plain file at the path, so nothing was followed.
    match original.recheck_identity() {
        Ok(()) => {}
        Err(Mismatch::Linked) => return Err(HandleRefusal::Link),
        Err(_) => return Err(HandleRefusal::Missing),
    }
    if std::str::from_utf8(&original.bytes).is_err() {
        return Err(HandleRefusal::NotDocument);
    }
    Ok(BoundDocument {
        relative: relative_of(&folder, &name),
        folder,
        path,
        baseline: hex(&sha256(&original.bytes)),
    })
}

/// The ordinary save's publication, through the run's test seams.
struct IoPlatform<'a>(&'a dyn CreateIo);

impl Platform for IoPlatform<'_> {
    fn publish(&self, original: &Path, staged: &Path) -> Result<PathBuf, PublishError> {
        self.0.replace(original, staged)
    }

    fn sync_dir(&self, dir: &Path) -> std::io::Result<()> {
        self.0.sync_dir(dir)
    }
}

fn roots_of(vault: &Vault) -> VaultRoots {
    VaultRoots {
        requested: vault.requested.clone(),
        canonical: vault.canonical.clone(),
    }
}

/// The page path as the vault was requested, so it matches the UI's own entries.
pub(crate) fn receipt_path(vault: &Vault, relative: &str) -> String {
    relative
        .split('/')
        .fold(vault.requested.clone(), |path, part| path.join(part))
        .to_string_lossy()
        .into_owned()
}

/// True when the page now holds exactly `sha` as one plain file of `length` bytes, read through
/// one handle that is still the file at the path.
fn holds_exactly(path: &Path, sha: &str, length: usize) -> bool {
    plain_file(path).is_ok()
        && Original::read_within(path, length as u64)
            .ok()
            .flatten()
            .is_some_and(|read| {
                read.bytes.len() == length
                    && hex(&sha256(&read.bytes)) == sha
                    && read.recheck_identity().is_ok()
            })
}

/// What the page at a bound path is now, read authoritatively under the caller's lease.
enum Current {
    Read(Original),
    Missing,
    Linked,
    /// Not one plain file within the bound, so not any page this host wrote.
    Other,
    Unreadable,
}

fn read_current(path: &Path) -> Current {
    match plain_file(path) {
        Ok(_) => {}
        Err(Mismatch::Linked) => return Current::Linked,
        Err(_) => {
            return match fs::symlink_metadata(path) {
                Err(error) if error.kind() == ErrorKind::NotFound => Current::Missing,
                _ => Current::Other,
            }
        }
    }
    let original = match Original::read_within(path, LIMIT) {
        Ok(Some(original)) => original,
        Ok(None) => return Current::Other,
        Err(error) if error.kind() == ErrorKind::NotFound => return Current::Missing,
        Err(_) => return Current::Unreadable,
    };
    match original.recheck_identity() {
        Ok(()) => Current::Read(original),
        Err(Mismatch::Linked) => Current::Linked,
        Err(Mismatch::Missing) => Current::Missing,
        Err(Mismatch::Changed) => Current::Other,
    }
}

/// The folder a page was bound or written in is still that folder, by path and identity.
fn same_folder(vault: &Vault, folder: &BoundFolder) -> Result<(), HandleRefusal> {
    match resolve_folder(&vault.canonical, &folder.relative) {
        Ok(now) if now.path == folder.path && now.identity == folder.identity => Ok(()),
        Ok(_) => Err(HandleRefusal::Link),
        Err(reason) => Err(reason),
    }
}

// --- Adding to a page ----------------------------------------------------------------------------

/// What an append was given when its run claimed it.
pub(crate) struct Append<'a> {
    pub(crate) vault: &'a Vault,
    pub(crate) document: &'a BoundDocument,
    pub(crate) content: &'a str,
    pub(crate) content_sha256: &'a str,
    pub(crate) expected_sha256: &'a str,
    /// The token the receipt names; the run registers its Undo with it.
    pub(crate) undo_receipt: &'a str,
}

/// A committed append's receipt and the pin on its kept earlier text, or another answer.
pub(crate) fn append(
    io: &dyn CreateIo,
    operation_id: &str,
    request: &Append<'_>,
) -> (ProposalReceipt, Option<Retained>) {
    let answer = |receipt| (receipt, None);
    let refused = |reason| answer(ProposalReceipt::refused(operation_id, reason));
    let changed = || {
        answer(ProposalReceipt::Conflict {
            operation_id: operation_id.to_string(),
            reason: ConflictReason::Changed,
        })
    };
    let Append {
        vault, document, ..
    } = request;
    if request.content.len() > MAX_CONTENT_BYTES {
        return refused(ProposalRefusal::TooLarge);
    }
    let digest_ok = is_sha256_hex(request.content_sha256)
        && hex(&sha256(request.content.as_bytes())) == request.content_sha256;
    if !digest_ok || request.content_sha256 == request.expected_sha256 {
        return refused(ProposalRefusal::DigestMismatch);
    }
    match same_folder(vault, &document.folder) {
        Ok(()) => {}
        Err(HandleRefusal::Missing | HandleRefusal::NotFolder) => return changed(),
        Err(_) => return refused(ProposalRefusal::HandleMismatch),
    }
    let path = &document.path;
    // The one lease for this write: ordinary saves of this page answer busy while it is held.
    let Ok(_lease) = lease(&[path]) else {
        return refused(ProposalRefusal::Busy);
    };
    let original = match read_current(path) {
        Current::Read(original) => original,
        Current::Linked => return refused(ProposalRefusal::Link),
        Current::Missing | Current::Other => return changed(),
        Current::Unreadable => return refused(ProposalRefusal::StorageUnavailable),
    };
    if hex(&sha256(&original.bytes)) != request.expected_sha256 {
        return changed();
    }
    // The exact earlier text is on disk, verified and pinned, before anything is replaced.
    let Some(key) = page_key(path) else {
        return refused(ProposalRefusal::StorageUnavailable);
    };
    let retained = match retain_version(&roots_of(vault), &key, &original.bytes) {
        Ok(retained) => retained,
        Err(RetainError::Busy) => return refused(ProposalRefusal::Busy),
        Err(RetainError::Full | RetainError::Unavailable) => {
            return refused(ProposalRefusal::StorageUnavailable)
        }
    };
    let Ok((staging, staged)) = staged_file::stage(path, request.content.as_bytes()) else {
        return refused(ProposalRefusal::StorageUnavailable);
    };
    io.after_stage(path);
    match original.fingerprint().recheck() {
        Ok(()) => {}
        Err(Recheck::Differs(_)) => return changed(),
        Err(Recheck::Unreadable) => return refused(ProposalRefusal::StorageUnavailable),
    }
    match staged_file::publish(&original, staging, &staged, &IoPlatform(io)) {
        Published::Committed { durable } => {
            if !holds_exactly(path, request.content_sha256, request.content.len()) {
                return answer(ProposalReceipt::uncertain(operation_id));
            }
            let receipt = ProposalReceipt::Committed {
                kind: CommitKind::Append,
                operation_id: operation_id.to_string(),
                path: receipt_path(vault, &document.relative),
                before_sha256: Some(request.expected_sha256.to_string()),
                after_sha256: request.content_sha256.to_string(),
                durable,
                undo_receipt: Some(request.undo_receipt.to_string()),
            };
            (receipt, Some(retained))
        }
        Published::Failed => refused(ProposalRefusal::StorageUnavailable),
        Published::Uncertain { .. } => {
            log::warn!("An extension append could not be confirmed; its staged copy is kept.");
            answer(ProposalReceipt::uncertain(operation_id))
        }
    }
}

// --- Undo ------------------------------------------------------------------------------------------

/// Where a committed write left its page and what it left there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Written {
    pub(crate) kind: UndoKind,
    pub(crate) vault: Vault,
    pub(crate) folder: BoundFolder,
    pub(crate) path: PathBuf,
    pub(crate) relative: String,
    /// The committed receipt's path, which an undone reply names again.
    pub(crate) receipt_path: String,
    pub(crate) after_sha256: String,
    /// What an append Undo restores; `None` for a create.
    pub(crate) before_sha256: Option<String>,
}

/// The written page is still the very bytes that write left, read under the caller's lease.
fn still_written(written: &Written, operation_id: &str) -> Result<Original, UndoReceipt> {
    let conflict = |reason| Err(UndoReceipt::conflict(operation_id, reason));
    match same_folder(&written.vault, &written.folder) {
        Ok(()) => {}
        Err(HandleRefusal::Missing) => return conflict(UndoConflict::Missing),
        Err(_) => return conflict(UndoConflict::Changed),
    }
    let original = match read_current(&written.path) {
        Current::Read(original) => original,
        Current::Missing => return conflict(UndoConflict::Missing),
        Current::Linked | Current::Other => return conflict(UndoConflict::Changed),
        Current::Unreadable => {
            return Err(UndoReceipt::refused(
                operation_id,
                UndoRefusal::StorageUnavailable,
            ))
        }
    };
    if hex(&sha256(&original.bytes)) != written.after_sha256 {
        return conflict(UndoConflict::Changed);
    }
    Ok(original)
}

/// Restores an appended page's exact earlier bytes, read back from page history, only while the
/// page still holds exactly what the append wrote. The text it replaces is kept first, the same
/// way, so nothing is replaced without a recoverable copy.
pub(crate) fn undo_append(
    io: &dyn CreateIo,
    operation_id: &str,
    written: &Written,
    retained: &Retained,
) -> UndoReceipt {
    let refused = |reason| UndoReceipt::refused(operation_id, reason);
    let Some(before) = written.before_sha256.as_deref() else {
        return refused(UndoRefusal::UnknownReceipt);
    };
    let path = &written.path;
    let Ok(_lease) = lease(&[path]) else {
        return refused(UndoRefusal::Busy);
    };
    let original = match still_written(written, operation_id) {
        Ok(original) => original,
        Err(answer) => return answer,
    };
    let earlier = match read_retained(retained) {
        Ok(bytes) if hex(&sha256(&bytes)) == before => bytes,
        Ok(_) | Err(RetainError::Full | RetainError::Unavailable) => {
            return refused(UndoRefusal::PreimageUnavailable)
        }
        Err(RetainError::Busy) => return refused(UndoRefusal::Busy),
    };
    let Some(key) = page_key(path) else {
        return refused(UndoRefusal::StorageUnavailable);
    };
    let _replaced = match retain_version(&roots_of(&written.vault), &key, &original.bytes) {
        Ok(replaced) => replaced,
        Err(RetainError::Busy) => return refused(UndoRefusal::Busy),
        Err(RetainError::Full | RetainError::Unavailable) => {
            return refused(UndoRefusal::StorageUnavailable)
        }
    };
    let Ok((staging, staged)) = staged_file::stage(path, &earlier) else {
        return refused(UndoRefusal::StorageUnavailable);
    };
    io.after_stage(path);
    match original.fingerprint().recheck() {
        Ok(()) => {}
        Err(Recheck::Differs(_)) => {
            return UndoReceipt::conflict(operation_id, UndoConflict::Changed)
        }
        Err(Recheck::Unreadable) => return refused(UndoRefusal::StorageUnavailable),
    }
    match staged_file::publish(&original, staging, &staged, &IoPlatform(io)) {
        Published::Committed { durable } if holds_exactly(path, before, earlier.len()) => {
            UndoReceipt::Undone {
                operation_id: operation_id.to_string(),
                kind: UndoKind::Append,
                path: written.receipt_path.clone(),
                restored_sha256: Some(before.to_string()),
                durable: Some(durable),
            }
        }
        Published::Committed { .. } => UndoReceipt::uncertain(operation_id),
        Published::Failed => refused(UndoRefusal::StorageUnavailable),
        Published::Uncertain { .. } => {
            log::warn!("An extension Undo could not be confirmed; its staged copy is kept.");
            UndoReceipt::uncertain(operation_id)
        }
    }
}

/// Moves a created page to the vault's local Trash only while it still holds exactly what the
/// create wrote, checked again at the final rename.
pub(crate) fn undo_create(operation_id: &str, written: &Written) -> UndoReceipt {
    let refused = |reason| UndoReceipt::refused(operation_id, reason);
    let Ok(_lease) = lease(&[&written.path]) else {
        return refused(UndoRefusal::Busy);
    };
    if let Err(answer) = still_written(written, operation_id) {
        return answer;
    }
    match move_exact_to_trash(
        &written.vault.canonical,
        &written.relative,
        &written.after_sha256,
        LIMIT,
    ) {
        ExactTrashOutcome::Moved => UndoReceipt::Undone {
            operation_id: operation_id.to_string(),
            kind: UndoKind::Create,
            path: written.receipt_path.clone(),
            restored_sha256: None,
            durable: None,
        },
        ExactTrashOutcome::Changed => UndoReceipt::conflict(operation_id, UndoConflict::Changed),
        ExactTrashOutcome::Missing => UndoReceipt::conflict(operation_id, UndoConflict::Missing),
        ExactTrashOutcome::NotMoved(message) => {
            log::warn!("An extension Undo could not move the page to Trash: {message}");
            refused(UndoRefusal::StorageUnavailable)
        }
        ExactTrashOutcome::Uncertain(message) => {
            log::warn!("An extension Undo could not be confirmed: {message}");
            UndoReceipt::uncertain(operation_id)
        }
    }
}
