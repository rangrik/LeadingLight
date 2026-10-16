//! Save as new page: the draft goes to a fresh sibling name, never over an existing file.
//! One intent per operation, written under the copy lock, lets a lost reply find the same copy.

use std::ffi::OsString;
use std::fs;
use std::io::{ErrorKind, Read};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tempfile::TempPath;

use super::history_outcome::{VersionCopyOutcome, VersionCopyRefusal};
use super::lock::{write_file, CopyLock, LockError};
use super::outcome::{
    ConfirmedSnapshot, CopyOutcome, CopyRefusal, DraftSnapshot, OriginalRequest, ResolutionRefusal,
};
use super::registry::Digest;
use super::versions::{self, Unverified};
use super::{
    binding_digest, digest_of, hex, is_uuid, lease, remove_staging_folder, well_formed, Lease,
    VaultRoots, REGISTRY,
};
use crate::vault::staged_file::{
    device_inode, plain_file, sha256, stage_in, NativePlatform, Platform,
};

const MAX_TRIES: u32 = 100;

/// What one copy operation was asked to do and what it did; never any page text.
#[derive(Serialize, Deserialize)]
struct Intent {
    /// The request, draft and folder choice; a retry must match it exactly.
    args: String,
    binding: String,
    /// The copied draft; keep-copy must confirm exactly this sequence and these bytes.
    seq: u64,
    content_sha256: String,
    destination: PathBuf,
    name: OsString,
    staged: PathBuf,
    identity: Option<(u64, u64)>,
    candidate: Option<PathBuf>,
    durable: bool,
}

struct Job<'a> {
    /// Exactly the bytes the copy must hold: a draft's text or a verified version.
    bytes: &'a [u8],
    roots: &'a VaultRoots,
    intent_path: PathBuf,
    lock: &'a CopyLock,
    platform: &'a dyn Platform,
}

pub(crate) fn copy_draft(
    request: &OriginalRequest,
    draft: &DraftSnapshot,
    operation_id: &str,
    folder: Option<&str>,
    roots: &VaultRoots,
) -> CopyOutcome {
    copy_with(&NativePlatform, request, draft, operation_id, folder, roots)
}

pub(super) fn copy_with(
    platform: &dyn Platform,
    request: &OriginalRequest,
    draft: &DraftSnapshot,
    operation_id: &str,
    folder: Option<&str>,
    roots: &VaultRoots,
) -> CopyOutcome {
    let refused = |reason| CopyOutcome::Refused { reason };
    if !well_formed(request) {
        return refused(CopyRefusal::RequestMismatch);
    }
    if !is_uuid(operation_id) {
        return refused(CopyRefusal::OperationMismatch);
    }
    let binding = binding_digest(request);
    if !REGISTRY.bind(request, binding) {
        return refused(CopyRefusal::RequestMismatch);
    }
    let lock = match CopyLock::acquire(&roots.canonical) {
        Ok(lock) => lock,
        Err(LockError::Busy) => return refused(CopyRefusal::Busy),
        Err(LockError::Unavailable(message)) => return CopyOutcome::Failed { message },
    };
    let content_sha256 = hex(&sha256(draft.content.as_bytes()));
    let args = hex(&digest_of(&[
        &binding,
        &draft.seq.to_le_bytes(),
        content_sha256.as_bytes(),
        &[u8::from(folder.is_some())],
        folder.unwrap_or_default().as_bytes(),
    ]));
    let job = Job {
        bytes: draft.content.as_bytes(),
        roots,
        intent_path: intent_path(&lock, operation_id),
        lock: &lock,
        platform,
    };
    let fresh = Intent {
        args,
        binding: hex(&binding),
        seq: draft.seq,
        content_sha256,
        destination: PathBuf::new(),
        name: page_name(&request.path),
        staged: PathBuf::new(),
        identity: None,
        candidate: None,
        durable: false,
    };
    match read_intent(&job.intent_path) {
        Ok(None) => create(
            &job,
            fresh,
            folder.map_or_else(|| default_folder(request), PathBuf::from),
        ),
        Ok(Some(intent)) if intent.args != fresh.args => refused(CopyRefusal::OperationMismatch),
        Ok(Some(intent)) => resume(&job, intent, folder, default_folder(request)),
        Err(()) => CopyOutcome::Uncertain {
            candidate_path: None,
        },
    }
}

/// Save a verified earlier version as a new page. The bytes are read and verified while the
/// lock keeps pruning away, then they follow the same no-clobber steps as a draft copy.
pub(crate) fn copy_version(
    id: &str,
    sha256_hex: &str,
    folder: Option<&str>,
    operation_id: &str,
    roots: &VaultRoots,
) -> VersionCopyOutcome {
    let refused = |reason| VersionCopyOutcome::Refused { reason };
    if !is_uuid(operation_id) {
        return refused(VersionCopyRefusal::OperationMismatch);
    }
    let lock = match CopyLock::acquire(&roots.canonical) {
        Ok(lock) => lock,
        Err(LockError::Busy) => return refused(VersionCopyRefusal::Busy),
        Err(LockError::Unavailable(message)) => return VersionCopyOutcome::Failed { message },
    };
    let (bytes, meta) = match versions::read_verified(&lock.dir, id, sha256_hex) {
        Ok(verified) => verified,
        Err(Unverified::Missing) => return refused(VersionCopyRefusal::Missing),
        Err(Unverified::Damaged) => return refused(VersionCopyRefusal::Damaged),
    };
    // One operation ID names one copy, whatever its kind.
    if !matches!(read_intent(&intent_path(&lock, operation_id)), Ok(None)) {
        return refused(VersionCopyRefusal::OperationMismatch);
    }
    let args = hex(&digest_of(&[
        b"version",
        id.as_bytes(),
        sha256_hex.as_bytes(),
        &[u8::from(folder.is_some())],
        folder.unwrap_or_default().as_bytes(),
    ]));
    let job = Job {
        bytes: &bytes,
        roots,
        intent_path: lock.dir.join(format!("version-copy-{operation_id}.json")),
        lock: &lock,
        platform: &NativePlatform,
    };
    let recorded = Path::new(&meta.recorded_path);
    let default = recorded.parent().map(Path::to_path_buf).unwrap_or_default();
    let fresh = Intent {
        args,
        binding: String::new(),
        seq: 0,
        content_sha256: meta.sha256.clone(),
        destination: PathBuf::new(),
        name: page_name(&meta.recorded_path),
        staged: PathBuf::new(),
        identity: None,
        candidate: None,
        durable: false,
    };
    let outcome = match read_intent(&job.intent_path) {
        Ok(None) => create(&job, fresh, folder.map_or(default, PathBuf::from)),
        Ok(Some(intent)) if intent.args != fresh.args => {
            return refused(VersionCopyRefusal::OperationMismatch)
        }
        Ok(Some(intent)) => resume(&job, intent, folder, default),
        Err(()) => CopyOutcome::Uncertain {
            candidate_path: None,
        },
    };
    version_outcome(outcome)
}

fn version_outcome(outcome: CopyOutcome) -> VersionCopyOutcome {
    match outcome {
        CopyOutcome::Created {
            path,
            relative_path,
            durable,
        } => VersionCopyOutcome::Created {
            path,
            relative_path,
            durable,
        },
        CopyOutcome::FolderUnavailable { recorded_folder } => {
            VersionCopyOutcome::FolderUnavailable { recorded_folder }
        }
        CopyOutcome::Refused { reason } => VersionCopyOutcome::Refused {
            reason: match reason {
                CopyRefusal::Busy => VersionCopyRefusal::Busy,
                CopyRefusal::OutsideVault => VersionCopyRefusal::OutsideVault,
                CopyRefusal::NameUnavailable => VersionCopyRefusal::NameUnavailable,
                CopyRefusal::OperationMismatch | CopyRefusal::RequestMismatch => {
                    VersionCopyRefusal::OperationMismatch
                }
            },
        },
        CopyOutcome::Failed { message } => VersionCopyOutcome::Failed { message },
        CopyOutcome::Uncertain { candidate_path } => {
            VersionCopyOutcome::Uncertain { candidate_path }
        }
    }
}

fn intent_path(lock: &CopyLock, operation_id: &str) -> PathBuf {
    lock.dir.join(format!("copy-{operation_id}.json"))
}

fn read_intent(path: &Path) -> Result<Option<Intent>, ()> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(drop),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(_) => Err(()),
    }
}

fn save_intent(job: &Job<'_>, intent: &Intent) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(intent).map_err(std::io::Error::other)?;
    write_file(job.platform, &job.lock.dir, &job.intent_path, &bytes)
}

fn page_name(path: &str) -> OsString {
    Path::new(path)
        .file_name()
        .map_or_else(|| OsString::from("Untitled.md"), OsString::from)
}

fn default_folder(request: &OriginalRequest) -> PathBuf {
    Path::new(&request.path)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default()
}

/// A real folder inside the vault and outside its hidden `.leadinglight*` stores.
fn destination(folder: &Path, roots: &VaultRoots) -> Result<PathBuf, CopyOutcome> {
    let requested = roots.requested.join(folder);
    let outside = CopyOutcome::Refused {
        reason: CopyRefusal::OutsideVault,
    };
    if requested
        .components()
        .any(|part| matches!(part, Component::CurDir | Component::ParentDir))
    {
        return Err(outside);
    }
    let unavailable = || CopyOutcome::FolderUnavailable {
        recorded_folder: requested.to_string_lossy().into_owned(),
    };
    if !fs::symlink_metadata(&requested).is_ok_and(|meta| meta.is_dir()) {
        return Err(unavailable());
    }
    let canonical = requested.canonicalize().map_err(|_| unavailable())?;
    let inside = canonical
        .strip_prefix(&roots.canonical)
        .map_err(|_| outside.clone())?;
    let hidden = inside.components().any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .starts_with(".leadinglight")
    });
    if hidden {
        return Err(outside);
    }
    Ok(canonical)
}

/// `<stem>-2.<ext>` onwards; never the original name, so a missing page is never recreated.
fn candidates(dir: &Path, name: &OsString) -> impl Iterator<Item = PathBuf> {
    let dir = dir.to_path_buf();
    let page = Path::new(name);
    let stem = page.file_stem().unwrap_or(name.as_os_str()).to_os_string();
    let extension = page.extension().map(|ext| ext.to_os_string());
    (2..2 + MAX_TRIES).map(move |number| {
        let mut file = stem.clone();
        file.push(format!("-{number}"));
        if let Some(extension) = &extension {
            file.push(".");
            file.push(extension);
        }
        dir.join(file)
    })
}

fn create(job: &Job<'_>, mut intent: Intent, folder: PathBuf) -> CopyOutcome {
    let dir = match destination(&folder, job.roots) {
        Ok(dir) => dir,
        Err(outcome) => return outcome,
    };
    let (staging, staged) = match stage_in(&dir, Path::new("draft"), job.bytes, None) {
        Ok(staged) => staged,
        Err(error) => return failed(error),
    };
    intent.destination = dir.clone();
    intent.staged = staged.clone();
    intent.identity = fs::symlink_metadata(&staged)
        .ok()
        .as_ref()
        .and_then(device_inode);
    // Not durable means not published; the staging goes and a retry starts clean.
    if let Err(error) = save_intent(job, &intent) {
        let _ = fs::remove_file(&job.intent_path);
        return failed(error);
    }
    let mut pending = match TempPath::try_from_path(&staged) {
        Ok(pending) => pending,
        Err(error) => return failed(error),
    };
    for candidate in candidates(&dir, &intent.name) {
        match pending.persist_noclobber(&candidate) {
            Ok(()) => {
                let durable = job.platform.sync_dir(&dir).is_ok();
                drop(staging);
                intent.candidate = Some(candidate.clone());
                intent.durable = durable;
                // If this fails, a retry still finds the copy by its file identity.
                let _ = save_intent(job, &intent);
                return created(&candidate, durable, job.roots);
            }
            Err(error) if error.error.kind() == ErrorKind::AlreadyExists => pending = error.path,
            Err(error) => {
                let _ = fs::remove_file(&job.intent_path);
                return failed(error.error);
            }
        }
    }
    let _ = fs::remove_file(&job.intent_path);
    CopyOutcome::Refused {
        reason: CopyRefusal::NameUnavailable,
    }
}

/// Finishes or reports an earlier attempt with the same operation and arguments.
fn resume(
    job: &Job<'_>,
    mut intent: Intent,
    folder: Option<&str>,
    default: PathBuf,
) -> CopyOutcome {
    let roots = job.roots;
    if let Some(candidate) = intent.candidate.clone() {
        if real_folder_inside(candidate.parent(), &intent, roots) && owns(&intent, &candidate) {
            return created(&candidate, intent.durable, roots);
        }
        return uncertain(Some(&candidate));
    }
    if !real_folder_inside(Some(&intent.destination), &intent, roots) {
        return uncertain(None);
    }
    let staged_here = real_folder_inside(intent.staged.parent(), &intent, roots);
    // A crash came after staging; the copy may already carry the staged file's identity.
    let published = candidates(&intent.destination, &intent.name)
        .find(|candidate| same_file(&intent, candidate));
    if let Some(candidate) = published {
        if staged_here {
            let _ = fs::remove_file(&intent.staged);
            remove_staging_folder(&intent.staged);
        }
        intent.candidate = Some(candidate.clone());
        let _ = save_intent(job, &intent);
        return created(&candidate, false, roots);
    }
    if !staged_here || !same_file(&intent, &intent.staged) {
        return uncertain(None);
    }
    // Never published: clear the old attempt and start again from these bytes.
    let _ = fs::remove_file(&intent.staged);
    remove_staging_folder(&intent.staged);
    let _ = fs::remove_file(&job.intent_path);
    create(job, intent, folder.map_or(default, PathBuf::from))
}

/// Still a real folder under the recorded destination inside the vault, so nothing read or
/// removed in it can follow a folder swapped for a link out of the vault.
fn real_folder_inside(folder: Option<&Path>, intent: &Intent, roots: &VaultRoots) -> bool {
    folder.is_some_and(|folder| {
        folder.starts_with(&intent.destination)
            && intent.destination.starts_with(&roots.canonical)
            && folder.canonicalize().is_ok_and(|real| real == folder)
    })
}

/// Same file as the one staged, by device and inode; extra links are allowed here.
fn same_file(intent: &Intent, path: &Path) -> bool {
    let Some(identity) = intent.identity else {
        return false;
    };
    fs::symlink_metadata(path)
        .is_ok_and(|meta| meta.is_file() && device_inode(&meta) == Some(identity))
}

/// The copy this operation made, as one plain single-link file.
fn owns(intent: &Intent, path: &Path) -> bool {
    intent.identity.is_some()
        && plain_file(path).is_ok_and(|meta| device_inode(&meta) == intent.identity)
}

fn created(candidate: &Path, durable: bool, roots: &VaultRoots) -> CopyOutcome {
    let relative = candidate
        .strip_prefix(&roots.canonical)
        .unwrap_or(candidate);
    let parts: Vec<_> = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect();
    CopyOutcome::Created {
        path: roots
            .requested
            .join(relative)
            .to_string_lossy()
            .into_owned(),
        relative_path: parts.join("/"),
        durable,
    }
}

fn uncertain(candidate: Option<&Path>) -> CopyOutcome {
    CopyOutcome::Uncertain {
        candidate_path: candidate.map(|path| path.to_string_lossy().into_owned()),
    }
}

fn failed(error: impl std::fmt::Display) -> CopyOutcome {
    CopyOutcome::Failed {
        message: error.to_string(),
    }
}

/// Keep-copy proof: this request's published copy, still the same single file, still the
/// confirmed draft right now. A stored answer never stands in for this. The returned claim
/// keeps saves and mutations off the copy until the caller has recorded the resolution.
pub(super) fn verify(
    lock: &CopyLock,
    operation_id: &str,
    binding: &Digest,
    confirmed: &ConfirmedSnapshot,
    roots: &VaultRoots,
) -> Result<Lease, ResolutionRefusal> {
    let Ok(Some(intent)) = read_intent(&intent_path(lock, operation_id)) else {
        return Err(ResolutionRefusal::CopyNotPublished);
    };
    if intent.binding != hex(binding) {
        return Err(ResolutionRefusal::OperationMismatch);
    }
    let Some(candidate) = &intent.candidate else {
        return Err(ResolutionRefusal::CopyNotPublished);
    };
    // Claimed before any read; a copy that is saving, held or being changed answers busy.
    let claim = lease(&[candidate]).map_err(|_| ResolutionRefusal::Busy)?;
    if !real_folder_inside(candidate.parent(), &intent, roots) || !owns(&intent, candidate) {
        return Err(ResolutionRefusal::CopyNotOwned);
    }
    let holds_text = read_owned(&intent, candidate)
        .is_some_and(|bytes| hex(&sha256(&bytes)) == confirmed.content_sha256);
    let same_draft =
        intent.seq == confirmed.seq && intent.content_sha256 == confirmed.content_sha256;
    if !same_draft || !holds_text {
        return Err(ResolutionRefusal::CopyChanged);
    }
    Ok(claim)
}

/// Reads through one handle and checks it is still the owned file, before and after.
fn read_owned(intent: &Intent, path: &Path) -> Option<Vec<u8>> {
    let mut file = fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let handle = file.metadata().ok();
    let same = handle.as_ref().and_then(device_inode) == intent.identity && owns(intent, path);
    same.then_some(bytes)
}
