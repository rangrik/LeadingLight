//! Manual workspace backup to a plain folder, inspection of a backup, and restore into a new
//! folder. One operation runs at a time on its own thread; the UI polls its state.

mod backup;
#[cfg(test)]
mod cross_reader_tests;
mod fsx;
mod manifest;
mod registry;
mod restore;
mod rules;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub(crate) use registry::{cancel, state};

use crate::leadinglight_history::VaultRoots;
use fsx::Id;
use rules::SAMPLE;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Backup,
    Inspect,
    Restore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Counting,
    Copying,
    Checking,
    Finishing,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub files: u64,
    pub total_files: Option<u64>,
    pub bytes: u64,
    pub total_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample<R> {
    pub path: Option<String>,
    pub reason: R,
}

/// A bounded account: the exact total, counts by reason, and at most five examples.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary<R: Ord> {
    pub total: u64,
    pub counts: BTreeMap<R, u64>,
    pub sample: Vec<Sample<R>>,
}

impl<R: Ord> Default for Summary<R> {
    fn default() -> Self {
        Self {
            total: 0,
            counts: BTreeMap::new(),
            sample: Vec::new(),
        }
    }
}

impl<R: Ord + Copy> Summary<R> {
    pub(crate) fn add(&mut self, path: Option<String>, reason: R) {
        self.total += 1;
        *self.counts.entry(reason).or_default() += 1;
        if self.sample.len() < SAMPLE {
            self.sample.push(Sample { path, reason });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GapReason {
    Unreadable,
    Changing,
    Missing,
    Link,
    Special,
    NotText,
    TooLong,
    TooDeep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Problem {
    ManifestMissing,
    ManifestTooLarge,
    ManifestInvalid,
    UnsupportedVersion,
    BadPath,
    DuplicatePath,
    PathConflict,
    Missing,
    NotRegularFile,
    SizeMismatch,
    HashMismatch,
    Unreadable,
    TooLarge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartRefusal {
    Busy,
    OperationMismatch,
    NotWorkspace,
    DestinationMissing,
    DestinationNotFolder,
    DestinationInWorkspace,
    BackupMissing,
    BackupNotFolder,
    ParentMissing,
    ParentNotFolder,
    ParentInWorkspace,
    ParentInBackup,
    NameInvalid,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BackupFailure {
    TooLarge,
    ManifestTooLarge,
    NoSpace,
    DestinationNotWritable,
    DestinationChanged,
    CheckFailed,
    Io,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedBackup {
    pub folder: String,
    pub folder_name: String,
    pub files: u64,
    pub bytes: u64,
    pub durable: bool,
    pub gaps: Summary<GapReason>,
    pub versions_skipped: u64,
    /// Counted up to 10,000; at the cap it means "at least".
    pub trash_items_not_included: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum BackupResult {
    Complete(SavedBackup),
    Incomplete(SavedBackup),
    #[serde(rename_all = "camelCase")]
    Cancelled {
        leftover: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        reason: BackupFailure,
        path: Option<String>,
        leftover: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IoFailure {
    Io,
    Internal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BackupStatus {
    Complete,
    Incomplete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum InspectResult {
    #[serde(rename_all = "camelCase")]
    Ok {
        manifest_sha256: String,
        created_at: String,
        app_version: String,
        workspace_name: String,
        backup_status: BackupStatus,
        files: u64,
        bytes: u64,
        gaps: u64,
        extra_files: u64,
    },
    NotBackup,
    Damaged {
        problems: Summary<Problem>,
    },
    Cancelled,
    Failed {
        reason: IoFailure,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreFailure {
    NoSpace,
    ParentNotWritable,
    DestinationChanged,
    CheckFailed,
    Io,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RestoreResult {
    #[serde(rename_all = "camelCase")]
    Restored {
        folder: String,
        folder_name: String,
        files: u64,
        bytes: u64,
        durable: bool,
        times_kept: bool,
    },
    NameTaken,
    #[serde(rename_all = "camelCase")]
    BackupChanged {
        problems: Summary<Problem>,
        leftover: Option<String>,
    },
    Damaged {
        problems: Summary<Problem>,
    },
    #[serde(rename_all = "camelCase")]
    Cancelled {
        leftover: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        reason: RestoreFailure,
        path: Option<String>,
        leftover: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum OpResult {
    Backup(BackupResult),
    Inspect(InspectResult),
    Restore(RestoreResult),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum StartAnswer {
    Started,
    Finished { result: OpResult },
    Refused { reason: StartRefusal },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum OperationState {
    Unknown,
    #[serde(rename_all = "camelCase")]
    Running {
        kind: Kind,
        phase: Phase,
        progress: Option<Progress>,
        cancel_requested: bool,
    },
    Finished {
        kind: Kind,
        result: OpResult,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAnswer {
    pub accepted: bool,
}

pub(crate) fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// A folder the user chose: its canonical path and identity.
struct Chosen {
    path: PathBuf,
    id: Id,
}

enum Choose {
    Missing,
    NotFolder,
}

fn choose(raw: &str) -> Result<Chosen, Choose> {
    let given = Path::new(raw);
    if raw.trim().is_empty() || !given.is_absolute() {
        return Err(Choose::Missing);
    }
    let path = given.canonicalize().map_err(|_| Choose::Missing)?;
    let id = fsx::dir_id(&path).ok_or(Choose::NotFolder)?;
    Ok(Chosen { path, id })
}

fn inside(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

/// What a backup needs, already checked: the workspace and where its copy goes.
pub(crate) struct BackupJob {
    roots: VaultRoots,
    destination: Chosen,
}

/// Checks a backup request before anything is written. `known` are every workspace's
/// canonical roots, from the native registry; the source is always added.
pub(crate) fn prepare_backup(
    roots: VaultRoots,
    destination: &str,
    mut known: Vec<PathBuf>,
) -> Result<BackupJob, StartRefusal> {
    if !fsx::SUPPORTED {
        return Err(StartRefusal::Unavailable);
    }
    if fsx::dir_id(&roots.canonical).is_none() {
        return Err(StartRefusal::NotWorkspace);
    }
    known.push(roots.canonical.clone());
    let destination = choose(destination).map_err(|why| match why {
        Choose::Missing => StartRefusal::DestinationMissing,
        Choose::NotFolder => StartRefusal::DestinationNotFolder,
    })?;
    if inside(&destination.path, &known) {
        return Err(StartRefusal::DestinationInWorkspace);
    }
    Ok(BackupJob { roots, destination })
}

pub(crate) struct InspectJob {
    backup: Chosen,
}

pub(crate) fn prepare_inspect(backup: &str) -> Result<InspectJob, StartRefusal> {
    if !fsx::SUPPORTED {
        return Err(StartRefusal::Unavailable);
    }
    let backup = choose(backup).map_err(|why| match why {
        Choose::Missing => StartRefusal::BackupMissing,
        Choose::NotFolder => StartRefusal::BackupNotFolder,
    })?;
    Ok(InspectJob { backup })
}

pub(crate) struct RestoreJob {
    backup: Chosen,
    manifest_sha256: String,
    parent: Chosen,
    name: String,
}

pub(crate) fn prepare_restore(
    backup: &str,
    manifest_sha256: &str,
    parent: &str,
    name: &str,
    known: &[PathBuf],
) -> Result<RestoreJob, StartRefusal> {
    let InspectJob { backup } = prepare_inspect(backup)?;
    let parent = choose(parent).map_err(|why| match why {
        Choose::Missing => StartRefusal::ParentMissing,
        Choose::NotFolder => StartRefusal::ParentNotFolder,
    })?;
    if inside(&parent.path, known) {
        return Err(StartRefusal::ParentInWorkspace);
    }
    if parent.path.starts_with(&backup.path) {
        return Err(StartRefusal::ParentInBackup);
    }
    if !rules::name_ok(name) {
        return Err(StartRefusal::NameInvalid);
    }
    Ok(RestoreJob {
        backup,
        manifest_sha256: manifest_sha256.to_string(),
        parent,
        name: name.to_string(),
    })
}

/// Starts a checked backup; the same id with the same arguments never starts twice while it
/// is retained in this process.
pub(crate) fn start_backup(
    operation_id: &str,
    args: &[&str],
    prepare: impl FnOnce() -> Result<BackupJob, StartRefusal>,
) -> StartAnswer {
    registry::start(operation_id, Kind::Backup, args, prepare, |op, job| {
        OpResult::Backup(backup::run(op, job))
    })
}

pub(crate) fn start_inspect(operation_id: &str, backup: &str) -> StartAnswer {
    registry::start(
        operation_id,
        Kind::Inspect,
        &[backup],
        || prepare_inspect(backup),
        |op, job| OpResult::Inspect(restore::inspect(op, job)),
    )
}

pub(crate) fn start_restore(
    operation_id: &str,
    args: &[&str],
    prepare: impl FnOnce() -> Result<RestoreJob, StartRefusal>,
) -> StartAnswer {
    registry::start(operation_id, Kind::Restore, args, prepare, |op, job| {
        OpResult::Restore(restore::restore(op, job))
    })
}
