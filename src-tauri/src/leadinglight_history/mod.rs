//! S0 safer saves: one immutable request per save, in-memory holds, and exact recovery.
//! S1a adds automatic earlier versions, kept inside the vault's hidden history store.
//! E2 adds exact, pinned versions for the Undo of guarded extension writes.

mod copy;
pub(crate) mod history_outcome;
#[cfg(all(test, unix))]
mod history_tests;
mod inventory;
mod lock;
pub(crate) mod outcome;
mod page_write;
mod pins;
mod policy;
mod registry;
mod resolve;
#[cfg(all(test, unix))]
mod retained_tests;
mod retention;
#[cfg(all(test, unix))]
mod tests;
mod versions;

use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest as _, Sha256};

use crate::vault::staged_file::STAGING_PREFIX;

pub(crate) use copy::{copy_draft, copy_version};
pub(crate) use outcome::OriginalRequest;
pub(crate) use page_write::{check_save, legacy_save, save_page};
#[cfg(test)]
pub(crate) use pins::pinned_in;
pub(crate) use pins::Retained;
pub(crate) use registry::Lease;
use registry::{Digest, Registry};
pub(crate) use resolve::{discard, release_with_copy};
pub(crate) use versions::{export_candidates, export_version, ExportCandidate, ExportPlan};
#[cfg(test)]
pub(crate) use versions::{fail_history_syncs, SyncFault};
pub(crate) use versions::{health as history_health, list_locations, list_versions, read_version};
pub(crate) use versions::{read_retained, retain_version, RetainError};

static REGISTRY: Registry = Registry::new();

/// A page checked against its vault: the path as requested and the key that names it.
pub(crate) struct PageTarget {
    pub(crate) path: PathBuf,
    pub(crate) key: PathBuf,
}

/// A vault root as requested and as resolved.
pub(crate) struct VaultRoots {
    pub(crate) requested: PathBuf,
    pub(crate) canonical: PathBuf,
}

/// A page's key: its folder fully resolved, its own name kept, so a linked page is never followed.
pub(crate) fn page_key(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?;
    let mut existing = path.parent()?;
    let mut missing = vec![name];
    let resolved = loop {
        match existing.canonicalize() {
            Ok(resolved) => break resolved,
            Err(_) => {
                missing.push(existing.file_name()?);
                existing = existing.parent()?;
            }
        }
    };
    Some(
        missing
            .iter()
            .rev()
            .fold(resolved, |path, part| path.join(part)),
    )
}

/// Holds the paths for one mutation, so no save can start publishing under them meanwhile.
/// A linked path also holds where it points, because the pages there are keyed by that place.
pub(crate) fn lease(paths: &[impl AsRef<Path>]) -> Result<Lease, String> {
    let mut keys = Vec::new();
    for path in paths.iter().map(AsRef::as_ref) {
        keys.extend(page_key(path));
        if fs::symlink_metadata(path).is_ok_and(|meta| meta.is_symlink()) {
            keys.extend(path.canonicalize().ok());
        }
    }
    REGISTRY.lease(keys)
}

/// SHA-256 over length-prefixed fields, so no two field lists share a digest.
fn digest_of(fields: &[&[u8]]) -> Digest {
    let mut hasher = Sha256::new();
    for field in fields {
        hasher.update((field.len() as u64).to_le_bytes());
        hasher.update(field);
    }
    let mut digest = [0; 32];
    digest.copy_from_slice(&hasher.finalize());
    digest
}

fn binding_digest(request: &OriginalRequest) -> Digest {
    digest_of(&[
        request.request_id.as_bytes(),
        request.vault_path.as_bytes(),
        request.session.as_bytes(),
        request.path.as_bytes(),
        &request.seq.to_le_bytes(),
        request.submitted_sha256.as_bytes(),
    ])
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Only the canonical lowercase form, so one ID never names two operations or files.
fn is_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|uuid| uuid.hyphenated().to_string() == value)
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn well_formed(request: &OriginalRequest) -> bool {
    is_uuid(&request.request_id) && is_sha256_hex(&request.submitted_sha256)
}

/// Removes a kept `.leadinglight-*` staging folder once its staged file is gone.
fn remove_staging_folder(staged: &Path) {
    let Some(folder) = staged.parent() else {
        return;
    };
    let ours = folder
        .file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with(STAGING_PREFIX));
    if ours {
        let _ = fs::remove_file(folder.join(".gitignore"));
        let _ = fs::remove_dir(folder);
    }
}
