//! A backup: count the workspace within bounds, copy each stable file into a new folder of ours,
//! re-read every copy, then publish the manifest last. Nothing before that is a backup.

use std::collections::HashSet;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::Path;

use walkdir::WalkDir;

use super::fsx::{self, Checked, CreateError, OutError, Output, ReadError, ToFile, Tree};
use super::manifest::{self, FileEntry, GapEntry, Manifest, Status};
use super::registry::Op;
use super::rules::{
    check_path, classify, display_name, max_entries, skip_dir, Class, PathFault, MANIFEST,
    MAX_GAPS_KEPT, MAX_MANIFEST_BYTES, MAX_PATH_BYTES, MAX_PATH_BYTES_TOTAL, MAX_SAFE, STORE,
    TRASH_COUNT_CAP, WORKSPACE,
};
use super::{
    path_text, BackupFailure, BackupJob, BackupResult, GapReason, OpResult, Phase, Progress,
    SavedBackup, Summary,
};
use crate::leadinglight_history::{self as history, ExportCandidate};

/// What the bounded count found before anything is written.
struct Plan {
    files: Vec<(String, u64)>,
    versions: Vec<ExportCandidate>,
    /// Version-shaped entries history does not list: omitted, and disclosed.
    unlisted: u64,
    trash: u64,
}

#[derive(Default)]
struct Gaps {
    summary: Summary<GapReason>,
    kept: Vec<GapEntry>,
}

impl Gaps {
    fn add(&mut self, path: String, reason: GapReason) {
        let path = bounded(path);
        if self.kept.len() < MAX_GAPS_KEPT {
            self.kept.push(GapEntry {
                path: path.clone(),
                reason,
            });
        }
        self.summary.add(Some(path), reason);
    }
}

/// A display path cut to the manifest's bound, between characters.
fn bounded(mut path: String) -> String {
    if path.len() > MAX_PATH_BYTES {
        let mut end = MAX_PATH_BYTES;
        while !path.is_char_boundary(end) {
            end -= 1;
        }
        path.truncate(end);
    }
    path
}

fn fault_gap(fault: PathFault) -> GapReason {
    match fault {
        PathFault::NotText => GapReason::NotText,
        PathFault::TooLong => GapReason::TooLong,
        PathFault::TooDeep => GapReason::TooDeep,
    }
}

enum Stop {
    TooLarge,
    Cancelled,
    Gone,
}

/// The bounded walk: no write happens before it passes. Links are never followed.
/// What the walk found, and how much of the shared budget it used.
struct Counted {
    files: Vec<(String, u64)>,
    visited: usize,
    path_bytes: usize,
}

fn count(op: &Op, src: &mut Tree, gaps: &mut Gaps) -> Result<Counted, Stop> {
    let mut files = Vec::new();
    let mut visited = 0usize;
    let mut path_bytes = 0usize;
    let mut walk = WalkDir::new(&src.root)
        .follow_links(false)
        .min_depth(1)
        .sort_by_file_name()
        .into_iter();
    while let Some(entry) = walk.next() {
        visited += 1;
        if visited > max_entries() {
            return Err(Stop::TooLarge);
        }
        if visited.is_multiple_of(256) && op.cancelled() {
            return Err(Stop::Cancelled);
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                let path = error
                    .path()
                    .and_then(|path| path.strip_prefix(&src.root).ok());
                gaps.add(
                    path.map_or_else(String::new, |p| p.to_string_lossy().into_owned()),
                    GapReason::Unreadable,
                );
                continue;
            }
        };
        let relative = entry.path().strip_prefix(&src.root).unwrap_or(entry.path());
        let is_dir = entry.file_type().is_dir();
        let Some(rel) = relative.to_str().map(str::to_string) else {
            gaps.add(relative.to_string_lossy().into_owned(), GapReason::NotText);
            if is_dir {
                walk.skip_current_dir();
            }
            continue;
        };
        if is_dir && skip_dir(&rel) {
            walk.skip_current_dir();
            continue;
        }
        if let Err(fault) = check_path(&rel) {
            gaps.add(rel, fault_gap(fault));
            if is_dir {
                walk.skip_current_dir();
            }
            continue;
        }
        if is_dir {
            match entry.metadata().ok().and_then(|meta| fsx::id_of(&meta)) {
                Some(id) => src.record(&rel, id),
                None => {
                    gaps.add(rel, GapReason::Unreadable);
                    walk.skip_current_dir();
                }
            }
            continue;
        }
        if classify(&rel) != Class::User {
            continue;
        }
        let kind = entry.file_type();
        if kind.is_symlink() {
            gaps.add(rel, GapReason::Link);
        } else if kind.is_file() {
            path_bytes += rel.len();
            if path_bytes > MAX_PATH_BYTES_TOTAL {
                return Err(Stop::TooLarge);
            }
            let len = entry.metadata().map_or(0, |meta| meta.len());
            files.push((rel, len));
        } else {
            gaps.add(rel, GapReason::Special);
        }
    }
    if !src.check("", false) {
        return Err(Stop::Gone);
    }
    Ok(Counted {
        files,
        visited,
        path_bytes,
    })
}

/// Trash items by folder name only; Trash is never read or copied.
fn count_trash(root: &Path) -> u64 {
    let trash = root.join(STORE).join("trash");
    if fsx::dir_id(&root.join(STORE)).is_none() || fsx::dir_id(&trash).is_none() {
        return 0;
    }
    let mut count = 0u64;
    for entry in fs::read_dir(&trash).into_iter().flatten().flatten() {
        let name = entry.file_name();
        let id = name.to_str().unwrap_or("");
        if id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
            count += 1;
            if count >= TRASH_COUNT_CAP {
                return TRASH_COUNT_CAP;
            }
        }
    }
    count
}

fn failure(error: &OutError) -> BackupFailure {
    match error {
        OutError::Changed => BackupFailure::DestinationChanged,
        OutError::NoSpace => BackupFailure::NoSpace,
        OutError::NotWritable => BackupFailure::DestinationNotWritable,
        OutError::Conflict(_) | OutError::Io => BackupFailure::Io,
    }
}

fn failed(reason: BackupFailure, path: Option<String>, leftover: Option<String>) -> BackupResult {
    BackupResult::Failed {
        reason,
        path,
        leftover,
    }
}

/// Stops after output exists: removes only what is ours and names anything left.
fn abandon(
    op: &Op,
    out: Output,
    result: impl FnOnce(Option<String>) -> BackupResult,
) -> BackupResult {
    let leftover = out.clean_up().map(|path| path_text(&path));
    op.made(None);
    result(leftover)
}

fn create_output(job: &BackupJob) -> Result<Output, BackupFailure> {
    let workspace = job
        .roots
        .requested
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stamp = chrono::Local::now().format("%Y-%m-%d %H.%M");
    let base = format!("{} backup {stamp}", display_name(&workspace));
    for attempt in 1..=99 {
        let name = if attempt == 1 {
            base.clone()
        } else {
            format!("{base} {attempt}")
        };
        match Output::create(&job.destination.path, job.destination.id, &name) {
            Ok(out) => return Ok(out),
            Err(CreateError::Taken) => continue,
            Err(CreateError::Failed(error)) => return Err(failure(&error)),
        }
    }
    Err(BackupFailure::DestinationNotWritable)
}

struct Copied {
    entries: Vec<FileEntry>,
    versions_skipped: u64,
}

fn progress(files: u64, bytes: u64, total: &(u64, u64)) -> Option<Progress> {
    Some(Progress {
        files,
        total_files: Some(total.0),
        bytes,
        total_bytes: Some(total.1),
    })
}

fn sha_of(bytes: &[u8]) -> String {
    fsx::hex(&crate::vault::staged_file::sha256(bytes))
}

/// Copies every counted file and every intact saved version.
fn copy(
    op: &Op,
    job: &BackupJob,
    src: &mut Tree,
    out: &mut Output,
    plan: &Plan,
    gaps: &mut Gaps,
) -> Result<Copied, Result<(BackupFailure, Option<String>), ()>> {
    let total = (
        (plan.files.len() + plan.versions.len()) as u64,
        plan.files.iter().map(|(_, len)| len).sum::<u64>()
            + plan.versions.iter().map(|v| v.length).sum::<u64>(),
    );
    let (mut done, mut bytes) = (0u64, 0u64);
    let mut entries = Vec::with_capacity(plan.files.len());
    for (rel, _) in &plan.files {
        let mut sink = ToFile::new(out, format!("{WORKSPACE}/{rel}"), None);
        match fsx::read_stable(src, rel, &mut sink, &|| op.cancelled()) {
            Ok(read) => {
                bytes += read.bytes;
                entries.push(FileEntry {
                    path: rel.clone(),
                    bytes: read.bytes,
                    sha256: read.sha256,
                    modified_ms: read.modified_ms,
                });
            }
            Err(ReadError::Gap(reason)) => gaps.add(rel.clone(), reason),
            Err(ReadError::Out(error)) => return Err(Ok((failure(&error), Some(rel.clone())))),
            Err(ReadError::Cancelled) => return Err(Err(())),
        }
        done += 1;
        op.report(Phase::Copying, progress(done, bytes, &total));
    }
    let mut versions_skipped = plan.unlisted;
    let mut locations = HashSet::new();
    let now =
        fsx::modified_ms(&fs::metadata(out.root()).map_err(|_| Ok((BackupFailure::Io, None)))?);
    for candidate in &plan.versions {
        if op.cancelled() {
            return Err(Err(()));
        }
        let Some(version) = history::export_version(&job.roots, candidate) else {
            versions_skipped += 1;
            continue;
        };
        let dir = format!("{STORE}/history/versions/{}", candidate.loc);
        let mut files = vec![
            (
                format!("{dir}/{}/version.json", candidate.name),
                version.record,
            ),
            (format!("{dir}/{}/payload", candidate.name), version.payload),
        ];
        if locations.insert(candidate.loc.clone()) {
            files.insert(0, (format!("{dir}/location.json"), version.location_record));
        }
        for (rel, content) in files {
            out.write_bytes(&format!("{WORKSPACE}/{rel}"), &content)
                .map_err(|error| Ok((failure(&error), None)))?;
            bytes += content.len() as u64;
            entries.push(FileEntry {
                sha256: sha_of(&content),
                bytes: content.len() as u64,
                modified_ms: now,
                path: rel,
            });
        }
        done += 1;
        op.report(Phase::Copying, progress(done, bytes, &total));
    }
    Ok(Copied {
        entries,
        versions_skipped,
    })
}

#[cfg(test)]
thread_local! {
    /// Test seam: runs just before the completion point, with the output folder.
    pub(super) static BEFORE_COMMIT: fsx::Hook = const { std::cell::RefCell::new(None) };
}

fn before_commit(root: &Path) {
    #[cfg(test)]
    fsx::run_hook(&BEFORE_COMMIT, root);
    let _ = root;
}

pub(super) fn run(op: &Op, job: BackupJob) -> BackupResult {
    let Some(mut src) = Tree::open(&job.roots.canonical) else {
        return failed(BackupFailure::Io, None, None);
    };
    let mut gaps = Gaps::default();
    let counted = match count(op, &mut src, &mut gaps) {
        Ok(counted) => counted,
        Err(Stop::TooLarge) => return failed(BackupFailure::TooLarge, None, None),
        Err(Stop::Cancelled) => return BackupResult::Cancelled { leftover: None },
        Err(Stop::Gone) => return failed(BackupFailure::Io, None, None),
    };
    // History shares the walk's budget, spent before anything is allocated past it.
    let budget = max_entries().saturating_sub(counted.visited);
    let Ok(history) = history::export_candidates(&job.roots, budget) else {
        return failed(BackupFailure::TooLarge, None, None);
    };
    let history::ExportPlan {
        candidates: versions,
        unlisted,
        unreadable,
    } = history;
    // A store that could not be read is never taken as "no versions".
    for path in unreadable {
        gaps.add(path, GapReason::Unreadable);
    }
    let version_path_bytes: usize = versions
        .iter()
        .map(|v| 3 * (STORE.len() + v.loc.len() + v.name.len() + 40))
        .sum();
    let files = counted.files;
    if files.len() + versions.len() * 3 > max_entries()
        || counted.path_bytes + version_path_bytes > MAX_PATH_BYTES_TOTAL
    {
        return failed(BackupFailure::TooLarge, None, None);
    }
    let trash = count_trash(&job.roots.canonical);
    let plan = Plan {
        files,
        versions,
        unlisted,
        trash,
    };
    if op.cancelled() {
        return BackupResult::Cancelled { leftover: None };
    }
    let mut out = match create_output(&job) {
        Ok(out) => out,
        Err(reason) => return failed(reason, None, None),
    };
    op.made(Some(out.root().to_path_buf()));
    if let Err(error) = out.ensure_dir(WORKSPACE) {
        return abandon(op, out, |left| failed(failure(&error), None, left));
    }
    let copied = match copy(op, &job, &mut src, &mut out, &plan, &mut gaps) {
        Ok(copied) => copied,
        Err(Ok((reason, path))) => return abandon(op, out, |left| failed(reason, path, left)),
        Err(Err(())) => return abandon(op, out, |leftover| BackupResult::Cancelled { leftover }),
    };
    op.report(Phase::Checking, None);
    for entry in &copied.entries {
        if op.cancelled() {
            return abandon(op, out, |leftover| BackupResult::Cancelled { leftover });
        }
        let rel = format!("{WORKSPACE}/{}", entry.path);
        match out.verify(&rel, entry.bytes, &entry.sha256, &|| op.cancelled()) {
            Ok(Checked::Match) => {}
            Ok(Checked::Cancelled) => {
                return abandon(op, out, |leftover| BackupResult::Cancelled { leftover })
            }
            Ok(Checked::Mismatch) => {
                let path = Some(entry.path.clone());
                return abandon(op, out, |left| {
                    failed(BackupFailure::CheckFailed, path, left)
                });
            }
            Err(error) => return abandon(op, out, |left| failed(failure(&error), None, left)),
        }
    }
    op.report(Phase::Finishing, None);
    publish(op, out, &job, &plan, copied, gaps)
}

/// Writes the manifest beside the copy and publishes it without replacing anything.
fn publish(
    op: &Op,
    mut out: Output,
    job: &BackupJob,
    plan: &Plan,
    copied: Copied,
    gaps: Gaps,
) -> BackupResult {
    let workspace = display_name(
        &job.roots
            .requested
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
    );
    let bytes = copied
        .entries
        .iter()
        .try_fold(0u64, |sum, entry| sum.checked_add(entry.bytes))
        .filter(|sum| *sum <= MAX_SAFE);
    let Some(bytes) = bytes else {
        return abandon(op, out, |left| failed(BackupFailure::TooLarge, None, left));
    };
    let files = copied.entries.len() as u64;
    let status = if gaps.summary.total == 0 {
        Status::Complete
    } else {
        Status::Incomplete
    };
    let mut entries = copied.entries;
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    let manifest = Manifest {
        format: manifest::FORMAT.to_string(),
        version: manifest::VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        workspace_name: workspace,
        status,
        files: entries,
        gaps: gaps.kept,
        gaps_total: gaps.summary.total,
        versions_skipped: copied.versions_skipped,
        trash_items_not_included: plan.trash,
        total_files: files,
        total_bytes: bytes,
    };
    let encoded = manifest::encode(&manifest);
    if encoded.len() as u64 > MAX_MANIFEST_BYTES {
        return abandon(op, out, |left| {
            failed(BackupFailure::ManifestTooLarge, None, left)
        });
    }
    let synced = out.sync_dirs();
    let staged = tempfile::Builder::new()
        .prefix(".leadinglight-manifest-")
        .tempfile_in(out.root())
        .and_then(|mut file| {
            file.write_all(&encoded)?;
            file.as_file().sync_all()?;
            Ok(file)
        });
    let staged = match staged {
        Ok(staged) => staged,
        Err(error) => {
            let reason = failure(&fsx::out_error(&error));
            return abandon(op, out, |left| failed(reason, None, left));
        }
    };
    let staged_id = staged
        .as_file()
        .metadata()
        .ok()
        .and_then(|meta| fsx::id_of(&meta));
    before_commit(out.root());
    if !out.intact() {
        drop(staged);
        return abandon(op, out, |left| {
            failed(BackupFailure::DestinationChanged, None, left)
        });
    }
    let target = out.root().join(MANIFEST);
    let saved = SavedBackup {
        folder: path_text(out.root()),
        folder_name: out
            .root()
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        files,
        bytes,
        durable: false,
        gaps: gaps.summary,
        versions_skipped: copied.versions_skipped,
        trash_items_not_included: plan.trash,
    };
    // The completion point: publishing the manifest, with cancel held off while it runs.
    let completed = op.complete(|| {
        let published = match staged.persist_noclobber(&target) {
            Ok(_) => Ok(()),
            Err(error) if error.error.kind() == ErrorKind::AlreadyExists => {
                drop(error.file);
                Err(BackupFailure::DestinationChanged)
            }
            // An unclear error: published only if the manifest there is the very file we wrote.
            Err(error) => {
                drop(error.file);
                let ours = fs::symlink_metadata(&target)
                    .ok()
                    .and_then(|meta| fsx::id_of(&meta))
                    .is_some_and(|id| Some(id) == staged_id);
                if ours {
                    Ok(())
                } else {
                    Err(BackupFailure::Io)
                }
            }
        };
        published.map(|()| {
            let saved = SavedBackup {
                durable: synced && out.sync_dirs(),
                ..saved
            };
            OpResult::Backup(match status {
                Status::Complete => BackupResult::Complete(saved),
                Status::Incomplete => BackupResult::Incomplete(saved),
            })
        })
    });
    match completed {
        None => abandon(op, out, |leftover| BackupResult::Cancelled { leftover }),
        Some(Err(reason)) => abandon(op, out, |left| failed(reason, None, left)),
        Some(Ok(OpResult::Backup(result))) => result,
        Some(Ok(_)) => failed(BackupFailure::Internal, None, None),
    }
}
