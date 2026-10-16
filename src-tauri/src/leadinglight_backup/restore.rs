//! Inspection previews a backup; restore never trusts it. Restore rereads the manifest, checks
//! its binding and every byte as it copies into a new folder, and removes its unfinished marker
//! only when everything was verified.

use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;

use walkdir::WalkDir;

use super::fsx::{self, Checked, CreateError, Discard, OutError, Output, ReadError, ToFile, Tree};
use super::manifest::{self, Manifest, Status};
use super::registry::Op;
use super::rules::{
    max_entries, MANIFEST, MAX_DEPTH, MAX_MANIFEST_BYTES, RESTORE_MARKER, WORKSPACE,
};
use super::{
    path_text, BackupStatus, GapReason, InspectJob, InspectResult, IoFailure, OpResult, Phase,
    Problem, Progress, RestoreFailure, RestoreJob, RestoreResult, Summary,
};

fn one(path: Option<String>, problem: Problem) -> Summary<Problem> {
    let mut summary = Summary::default();
    summary.add(path, problem);
    summary
}

enum Read {
    Missing,
    TooLarge,
    Unusable,
    Bytes(Vec<u8>),
}

/// The manifest bytes, bounded before parsing, never through a link.
fn read_manifest(root: &Tree) -> Read {
    match fsx::read_bounded(&root.abs(MANIFEST), MAX_MANIFEST_BYTES) {
        Ok(Some(bytes)) => Read::Bytes(bytes),
        Ok(None) => Read::TooLarge,
        Err(error) if error.kind() == ErrorKind::NotFound => Read::Missing,
        Err(_) => Read::Unusable,
    }
}

fn gap_problem(reason: GapReason) -> Problem {
    match reason {
        GapReason::Missing => Problem::Missing,
        GapReason::Link | GapReason::Special => Problem::NotRegularFile,
        GapReason::Unreadable => Problem::Unreadable,
        GapReason::Changing => Problem::HashMismatch,
        GapReason::NotText | GapReason::TooLong | GapReason::TooDeep => Problem::BadPath,
    }
}

fn totals(manifest: &Manifest) -> (u64, u64) {
    (manifest.total_files, manifest.total_bytes)
}

fn progress(files: u64, bytes: u64, total: (u64, u64)) -> Option<Progress> {
    Some(Progress {
        files,
        total_files: Some(total.0),
        bytes,
        total_bytes: Some(total.1),
    })
}

/// Counts entries under `workspace/` that the manifest does not list, within a fixed budget.
fn extra_files(workspace: &std::path::Path, listed: &HashSet<&str>) -> Option<u64> {
    let mut extra = 0u64;
    let walk = WalkDir::new(workspace)
        .follow_links(false)
        .min_depth(1)
        .max_depth(MAX_DEPTH + 1);
    for (visited, entry) in walk.into_iter().enumerate() {
        if visited >= max_entries() * 2 {
            return None;
        }
        let Ok(entry) = entry else {
            continue;
        };
        if entry.file_type().is_dir() {
            continue;
        }
        let rel = entry.path().strip_prefix(workspace).ok()?;
        if !rel.to_str().is_some_and(|rel| listed.contains(rel)) {
            extra += 1;
        }
    }
    Some(extra)
}

pub(super) fn inspect(op: &Op, job: InspectJob) -> InspectResult {
    let Some(root) = Tree::open(&job.backup.path) else {
        return InspectResult::Failed {
            reason: IoFailure::Io,
        };
    };
    let bytes = match read_manifest(&root) {
        Read::Bytes(bytes) => bytes,
        Read::Missing => return InspectResult::NotBackup,
        Read::TooLarge => {
            return InspectResult::Damaged {
                problems: one(None, Problem::ManifestTooLarge),
            }
        }
        Read::Unusable => {
            return InspectResult::Damaged {
                problems: one(None, Problem::ManifestInvalid),
            }
        }
    };
    let manifest_sha256 = fsx::hex(&crate::vault::staged_file::sha256(&bytes));
    let manifest = match manifest::parse(&bytes) {
        Ok(manifest) => manifest,
        Err(problems) => return InspectResult::Damaged { problems },
    };
    let Some(mut workspace) = Tree::open(&root.abs(WORKSPACE)) else {
        return InspectResult::Damaged {
            problems: one(Some(WORKSPACE.to_string()), Problem::Missing),
        };
    };
    let total = totals(&manifest);
    let mut problems = Summary::default();
    let (mut done, mut bytes_done) = (0u64, 0u64);
    for entry in &manifest.files {
        let path = Some(entry.path.clone());
        let size = fs::symlink_metadata(workspace.abs(&entry.path)).map(|meta| meta.len());
        if size.as_ref().is_ok_and(|len| *len != entry.bytes) {
            problems.add(path, Problem::SizeMismatch);
        } else {
            match fsx::read_stable(&mut workspace, &entry.path, &mut Discard, &|| {
                op.cancelled()
            }) {
                Ok(read) if read.sha256 == entry.sha256 && read.bytes == entry.bytes => {}
                Ok(_) => problems.add(path, Problem::HashMismatch),
                Err(ReadError::Gap(reason)) => problems.add(path, gap_problem(reason)),
                Err(ReadError::Cancelled) => return InspectResult::Cancelled,
                Err(ReadError::Out(_)) => problems.add(path, Problem::Unreadable),
            }
        }
        done += 1;
        bytes_done += entry.bytes;
        op.report(Phase::Checking, progress(done, bytes_done, total));
    }
    let listed: HashSet<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
    let extra = extra_files(&workspace.root, &listed);
    if extra.is_none() {
        problems.add(None, Problem::TooLarge);
    }
    if problems.total > 0 {
        return InspectResult::Damaged { problems };
    }
    InspectResult::Ok {
        manifest_sha256,
        created_at: manifest.created_at,
        app_version: manifest.app_version,
        workspace_name: manifest.workspace_name,
        backup_status: match manifest.status {
            Status::Complete => BackupStatus::Complete,
            Status::Incomplete => BackupStatus::Incomplete,
        },
        files: manifest.total_files,
        bytes: manifest.total_bytes,
        gaps: manifest.gaps_total,
        extra_files: extra.unwrap_or(0),
    }
}

fn failure(error: &OutError) -> (RestoreFailure, Option<String>) {
    match error {
        // A name taken on the output disk (case or normalization): never overwritten.
        OutError::Conflict(path) => (RestoreFailure::Io, Some(path.clone())),
        OutError::Changed => (RestoreFailure::DestinationChanged, None),
        OutError::NoSpace => (RestoreFailure::NoSpace, None),
        OutError::NotWritable => (RestoreFailure::ParentNotWritable, None),
        OutError::Io => (RestoreFailure::Io, None),
    }
}

/// Stops after output exists: removes what is ours, keeping the marker while anything remains.
fn abandon(
    op: &Op,
    out: Output,
    result: impl FnOnce(Option<String>) -> RestoreResult,
) -> RestoreResult {
    let leftover = out.clean_up().map(|path| path_text(&path));
    op.made(None);
    result(leftover)
}

fn failed(error: &OutError, out: Output, op: &Op) -> RestoreResult {
    let (reason, path) = failure(error);
    abandon(op, out, |leftover| RestoreResult::Failed {
        reason,
        path,
        leftover,
    })
}

#[cfg(test)]
thread_local! {
    /// Test seam: runs just before the marker is removed, with the restored folder.
    pub(super) static BEFORE_COMPLETE: fsx::Hook = const { std::cell::RefCell::new(None) };
}

fn before_complete(root: &std::path::Path) {
    #[cfg(test)]
    fsx::run_hook(&BEFORE_COMPLETE, root);
    let _ = root;
}

pub(super) fn restore(op: &Op, job: RestoreJob) -> RestoreResult {
    let changed = |problem: Problem| RestoreResult::BackupChanged {
        problems: one(Some(MANIFEST.to_string()), problem),
        leftover: None,
    };
    let Some(root) = Tree::open(&job.backup.path) else {
        return changed(Problem::Missing);
    };
    let bytes = match read_manifest(&root) {
        Read::Bytes(bytes) => bytes,
        Read::Missing => return changed(Problem::ManifestMissing),
        Read::TooLarge => return changed(Problem::ManifestTooLarge),
        Read::Unusable => return changed(Problem::ManifestInvalid),
    };
    if fsx::hex(&crate::vault::staged_file::sha256(&bytes)) != job.manifest_sha256 {
        return changed(Problem::HashMismatch);
    }
    let manifest = match manifest::parse(&bytes) {
        Ok(manifest) => manifest,
        Err(problems) => return RestoreResult::Damaged { problems },
    };
    let Some(mut workspace) = Tree::open(&root.abs(WORKSPACE)) else {
        return RestoreResult::BackupChanged {
            problems: one(Some(WORKSPACE.to_string()), Problem::Missing),
            leftover: None,
        };
    };
    let mut out = match Output::create(&job.parent.path, job.parent.id, &job.name) {
        Ok(out) => out,
        Err(CreateError::Taken) => return RestoreResult::NameTaken,
        Err(CreateError::Failed(error)) => {
            let (reason, path) = failure(&error);
            return RestoreResult::Failed {
                reason,
                path,
                leftover: None,
            };
        }
    };
    op.made(Some(out.root().to_path_buf()));
    let marker = format!("{{\"manifestSha256\":\"{}\"}}\n", job.manifest_sha256);
    if let Err(error) = out.write_marker(RESTORE_MARKER, marker.as_bytes()) {
        return failed(&error, out, op);
    }
    let total = totals(&manifest);
    let (mut done, mut bytes_done, mut times_kept) = (0u64, 0u64, true);
    for entry in &manifest.files {
        let mut sink = ToFile::new(&mut out, entry.path.clone(), Some(entry.modified_ms));
        let read = fsx::read_stable(&mut workspace, &entry.path, &mut sink, &|| op.cancelled());
        times_kept &= sink.times_kept;
        let problem = match read {
            Ok(read) if read.sha256 == entry.sha256 && read.bytes == entry.bytes => None,
            Ok(read) if read.bytes != entry.bytes => Some(Problem::SizeMismatch),
            Ok(_) => Some(Problem::HashMismatch),
            Err(ReadError::Gap(reason)) => Some(gap_problem(reason)),
            Err(ReadError::Out(error)) => return failed(&error, out, op),
            Err(ReadError::Cancelled) => {
                return abandon(op, out, |leftover| RestoreResult::Cancelled { leftover })
            }
        };
        if let Some(problem) = problem {
            let problems = one(Some(entry.path.clone()), problem);
            return abandon(op, out, |leftover| RestoreResult::BackupChanged {
                problems,
                leftover,
            });
        }
        done += 1;
        bytes_done += entry.bytes;
        op.report(Phase::Copying, progress(done, bytes_done, total));
    }
    op.report(Phase::Checking, None);
    for entry in &manifest.files {
        if op.cancelled() {
            return abandon(op, out, |leftover| RestoreResult::Cancelled { leftover });
        }
        match out.verify(&entry.path, entry.bytes, &entry.sha256, &|| op.cancelled()) {
            Ok(Checked::Match) => {}
            Ok(Checked::Cancelled) => {
                return abandon(op, out, |leftover| RestoreResult::Cancelled { leftover })
            }
            Ok(Checked::Mismatch) => {
                let path = Some(entry.path.clone());
                return abandon(op, out, |leftover| RestoreResult::Failed {
                    reason: RestoreFailure::CheckFailed,
                    path,
                    leftover,
                });
            }
            Err(error) => return failed(&error, out, op),
        }
    }
    op.report(Phase::Finishing, None);
    let synced = out.sync_dirs();
    before_complete(out.root());
    if !out.intact() {
        return failed(&OutError::Changed, out, op);
    }
    let folder = path_text(out.root());
    let folder_name = out
        .root()
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    // The completion point: removing the marker, with cancel held off while it runs.
    let completed = op.complete(|| {
        if !out.remove_marker() {
            return Err(());
        }
        Ok(OpResult::Restore(RestoreResult::Restored {
            folder: folder.clone(),
            folder_name,
            files: manifest.total_files,
            bytes: manifest.total_bytes,
            durable: synced && out.sync_dirs(),
            times_kept,
        }))
    });
    match completed {
        None => abandon(op, out, |leftover| RestoreResult::Cancelled { leftover }),
        // Every file is in place, but it stays marked unfinished: never a completed restore.
        Some(Err(())) => RestoreResult::Failed {
            reason: RestoreFailure::Io,
            path: Some(RESTORE_MARKER.to_string()),
            leftover: Some(folder),
        },
        Some(Ok(OpResult::Restore(result))) => result,
        Some(Ok(_)) => RestoreResult::Failed {
            reason: RestoreFailure::Internal,
            path: None,
            leftover: Some(folder),
        },
    }
}
