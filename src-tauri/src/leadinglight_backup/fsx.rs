//! Filesystem steps that never knowingly go through a link or a replaced folder. Every folder is
//! checked against the identity first seen; a same-user swap between a check and an open is an
//! accepted limit (no descriptor-anchored traversal).

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};

use super::rules::{ATTEMPTS, MAX_SAFE};
use super::GapReason;
use crate::vault::staged_file::device_inode;

pub(super) type Id = (u64, u64);

/// `O_NOFOLLOW` for the platforms this feature supports; elsewhere backup is unavailable.
#[cfg(target_os = "macos")]
const NO_FOLLOW: Option<i32> = Some(0x0100);
#[cfg(all(
    target_os = "linux",
    any(target_arch = "x86_64", target_arch = "aarch64")
))]
const NO_FOLLOW: Option<i32> = Some(0o400_000);
#[cfg(not(any(
    target_os = "macos",
    all(
        target_os = "linux",
        any(target_arch = "x86_64", target_arch = "aarch64")
    )
)))]
const NO_FOLLOW: Option<i32> = None;

pub(super) const SUPPORTED: bool = NO_FOLLOW.is_some();
const CHUNK: usize = 1 << 20;

fn no_follow(options: &mut OpenOptions) -> &mut OpenOptions {
    #[cfg(unix)]
    if let Some(flag) = NO_FOLLOW {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(flag);
    }
    options
}

/// Opens an existing file for reading, refusing a link at the final name.
pub(super) fn open_read(path: &Path) -> io::Result<File> {
    no_follow(OpenOptions::new().read(true)).open(path)
}

fn create_new(path: &Path) -> io::Result<File> {
    no_follow(OpenOptions::new().write(true).create_new(true)).open(path)
}

pub(super) fn id_of(meta: &fs::Metadata) -> Option<Id> {
    device_inode(meta)
}

/// A real folder (never a link) and its identity.
pub(super) fn dir_id(path: &Path) -> Option<Id> {
    fs::symlink_metadata(path)
        .ok()
        .filter(|meta| meta.is_dir())
        .and_then(|meta| id_of(&meta))
}

pub(super) fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| (since.as_millis() as u64).min(MAX_SAFE))
}

fn is_link_error(error: &io::Error) -> bool {
    // ELOOP on macOS and Linux: the final name was a link and was not followed.
    matches!(error.raw_os_error(), Some(62) if cfg!(target_os = "macos"))
        || matches!(error.raw_os_error(), Some(40) if cfg!(target_os = "linux"))
}

fn gap_of(error: &io::Error) -> GapReason {
    match error.kind() {
        ErrorKind::NotFound => GapReason::Missing,
        _ if is_link_error(error) => GapReason::Link,
        _ => GapReason::Unreadable,
    }
}

/// Why writing output failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum OutError {
    /// The name already exists on disk but is not ours: a case or normalization collision.
    Conflict(String),
    /// An output folder is no longer the one we made.
    Changed,
    NoSpace,
    NotWritable,
    Io,
}

pub(super) fn out_error(error: &io::Error) -> OutError {
    match error.kind() {
        ErrorKind::StorageFull | ErrorKind::QuotaExceeded => OutError::NoSpace,
        ErrorKind::PermissionDenied | ErrorKind::ReadOnlyFilesystem => OutError::NotWritable,
        _ => OutError::Io,
    }
}

/// A root folder and each folder below it, by the identity first seen.
pub(super) struct Tree {
    pub(super) root: PathBuf,
    ids: HashMap<String, Id>,
}

impl Tree {
    pub(super) fn open(root: &Path) -> Option<Self> {
        let id = dir_id(root)?;
        Some(Self {
            root: root.to_path_buf(),
            ids: HashMap::from([(String::new(), id)]),
        })
    }

    pub(super) fn abs(&self, rel: &str) -> PathBuf {
        if rel.is_empty() {
            self.root.clone()
        } else {
            self.root.join(rel)
        }
    }

    pub(super) fn record(&mut self, rel: &str, id: Id) {
        self.ids.insert(rel.to_string(), id);
    }

    /// Every folder from the root down to `rel_dir` is still the real folder first seen.
    /// Unseen folders are recorded when `learn`; otherwise they fail.
    pub(super) fn check(&mut self, rel_dir: &str, learn: bool) -> bool {
        for prefix in prefixes(rel_dir) {
            let Some(now) = dir_id(&self.abs(prefix)) else {
                return false;
            };
            match self.ids.get(prefix) {
                Some(seen) if *seen != now => return false,
                Some(_) => {}
                None if learn => {
                    self.ids.insert(prefix.to_string(), now);
                }
                None => return false,
            }
        }
        true
    }
}

/// "" then each ancestor folder of a relative path, ending with the path itself.
fn prefixes(rel: &str) -> impl Iterator<Item = &str> {
    std::iter::once("").chain(
        rel.match_indices('/')
            .map(move |(at, _)| &rel[..at])
            .chain((!rel.is_empty()).then_some(rel)),
    )
}

pub(super) fn parent_of(rel: &str) -> &str {
    rel.rsplit_once('/').map_or("", |(parent, _)| parent)
}

/// A folder this operation created and every entry it put there, each by identity.
pub(super) struct Output {
    pub(super) tree: Tree,
    /// Folders we made below the root, in creation order.
    dirs: Vec<String>,
    files: Vec<(String, Id)>,
    marker: Option<(String, Id)>,
    /// The marker's name and bytes, kept so it can be put back on a folder that has to stay.
    marker_bytes: Option<(String, Vec<u8>)>,
}

#[derive(Debug)]
pub(super) enum CreateError {
    Taken,
    Failed(OutError),
}

impl Output {
    /// Makes `parent/name` exclusively. The parent must still be the folder checked earlier.
    pub(super) fn create(parent: &Path, parent_id: Id, name: &str) -> Result<Self, CreateError> {
        if dir_id(parent) != Some(parent_id) {
            return Err(CreateError::Failed(OutError::Changed));
        }
        let root = parent.join(name);
        match fs::create_dir(&root) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                return Err(CreateError::Taken)
            }
            Err(error) => return Err(CreateError::Failed(out_error(&error))),
        }
        let tree = Tree::open(&root).ok_or(CreateError::Failed(OutError::Changed))?;
        Ok(Self {
            tree,
            dirs: Vec::new(),
            files: Vec::new(),
            marker: None,
            marker_bytes: None,
        })
    }

    pub(super) fn root(&self) -> &Path {
        &self.tree.root
    }

    /// Our folder at every step to `rel_dir`, making the missing ones; never reuses a stranger's.
    pub(super) fn ensure_dir(&mut self, rel_dir: &str) -> Result<(), OutError> {
        for prefix in prefixes(rel_dir) {
            if self.tree.ids.contains_key(prefix) {
                if !self.tree.check(prefix, false) {
                    return Err(OutError::Changed);
                }
                continue;
            }
            if !self.tree.check(parent_of(prefix), false) {
                return Err(OutError::Changed);
            }
            match fs::create_dir(self.tree.abs(prefix)) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    return Err(OutError::Conflict(prefix.to_string()))
                }
                Err(error) => return Err(out_error(&error)),
            }
            let id = dir_id(&self.tree.abs(prefix)).ok_or(OutError::Changed)?;
            self.tree.record(prefix, id);
            self.dirs.push(prefix.to_string());
        }
        Ok(())
    }

    /// A new file of ours at `rel`; an existing name is a conflict and is never opened.
    pub(super) fn create_file(&mut self, rel: &str) -> Result<File, OutError> {
        self.ensure_dir(parent_of(rel))?;
        let file = match create_new(&self.tree.abs(rel)) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                return Err(OutError::Conflict(rel.to_string()))
            }
            Err(error) => return Err(out_error(&error)),
        };
        let id = file
            .metadata()
            .ok()
            .and_then(|meta| id_of(&meta))
            .ok_or(OutError::Io)?;
        self.files.push((rel.to_string(), id));
        Ok(file)
    }

    /// Writes and syncs a whole small file of ours.
    pub(super) fn write_bytes(&mut self, rel: &str, bytes: &[u8]) -> Result<(), OutError> {
        let mut file = self.create_file(rel)?;
        file.write_all(bytes).map_err(|e| out_error(&e))?;
        file.sync_all().map_err(|e| out_error(&e))
    }

    /// Writes the unfinished marker first; it is the last thing removed.
    pub(super) fn write_marker(&mut self, rel: &str, bytes: &[u8]) -> Result<(), OutError> {
        self.write_bytes(rel, bytes)?;
        self.marker = self.files.pop();
        self.marker_bytes = Some((rel.to_string(), bytes.to_vec()));
        Ok(())
    }

    fn file_id(&self, rel: &str) -> Option<Id> {
        self.files
            .iter()
            .find(|(name, _)| name == rel)
            .map(|(_, id)| *id)
    }

    /// Removes one file of ours, only if it is still the very file we made.
    fn remove_owned(&mut self, rel: &str, id: Id) -> bool {
        if !self.tree.check(parent_of(rel), false) {
            return false;
        }
        let path = self.tree.abs(rel);
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == ErrorKind::NotFound => true,
            Ok(meta) if meta.is_file() && id_of(&meta) == Some(id) => {
                fs::remove_file(&path).is_ok()
            }
            _ => false,
        }
    }

    /// Drops a file of ours before a retry.
    pub(super) fn discard(&mut self, rel: &str) {
        if let Some(id) = self.file_id(rel) {
            if self.remove_owned(rel, id) {
                self.files.retain(|(name, _)| name != rel);
            }
        }
    }

    /// Re-reads a file of ours no further than its expected size plus one byte, checking for
    /// cancel before every chunk.
    pub(super) fn verify(
        &mut self,
        rel: &str,
        bytes: u64,
        sha256: &str,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Checked, OutError> {
        let id = self.file_id(rel).ok_or(OutError::Changed)?;
        if !self.tree.check(parent_of(rel), false) {
            return Err(OutError::Changed);
        }
        let path = self.tree.abs(rel);
        let mut file = open_read(&path).map_err(|_| OutError::Changed)?;
        if file.metadata().ok().and_then(|meta| id_of(&meta)) != Some(id) {
            return Err(OutError::Changed);
        }
        let mut hasher = Sha256::new();
        let mut buffer = vec![0; CHUNK];
        let mut total = 0u64;
        loop {
            if cancelled() {
                return Ok(Checked::Cancelled);
            }
            let ask = (bytes - total).clamp(1, CHUNK as u64) as usize;
            let read = file.read(&mut buffer[..ask]).map_err(|e| out_error(&e))?;
            if read == 0 {
                break;
            }
            if total == bytes {
                return Ok(Checked::Mismatch);
            }
            #[cfg(test)]
            run_hook(&DURING_CHECK, &path);
            hasher.update(&buffer[..read]);
            total += read as u64;
        }
        Ok(if total == bytes && hex(&hasher.finalize()) == sha256 {
            Checked::Match
        } else {
            Checked::Mismatch
        })
    }

    /// Every folder we made is still ours.
    pub(super) fn intact(&mut self) -> bool {
        let dirs = self.dirs.clone();
        self.tree.check("", false) && dirs.iter().all(|dir| self.tree.check(dir, false))
    }

    /// Syncs the folders we made, deepest first, then the root and its parent.
    pub(super) fn sync_dirs(&self) -> bool {
        let mut dirs: Vec<&String> = self.dirs.iter().collect();
        dirs.sort_by_key(|dir| std::cmp::Reverse(dir.matches('/').count()));
        let parent = self.tree.root.parent().map(Path::to_path_buf);
        dirs.iter()
            .map(|dir| self.tree.abs(dir))
            .chain(std::iter::once(self.tree.root.clone()))
            .chain(parent)
            .filter(|dir| !sync_dir(dir))
            .count()
            == 0
    }

    /// Completes a restore: removes the marker only if it is still ours.
    pub(super) fn remove_marker(&mut self) -> bool {
        let Some((rel, id)) = self.marker.clone() else {
            return true;
        };
        let removed = self.remove_owned(&rel, id);
        if removed {
            self.marker = None;
        }
        removed
    }

    /// The root of ours holds nothing but its marker, if it has one. An entry that cannot be
    /// read proves nothing, so it counts as something else being there.
    fn only_marker_left(&mut self) -> bool {
        if !self.tree.check("", false) {
            return false;
        }
        let marker = self.marker.as_ref().map(|(rel, _)| rel.as_str());
        #[cfg(test)]
        let injected = ENTRY_ERROR
            .with(std::cell::Cell::get)
            .then(|| Err(io::Error::other("injected entry error")));
        #[cfg(not(test))]
        let injected = None;
        fs::read_dir(&self.tree.root).is_ok_and(|entries| {
            entries
                .chain(injected)
                .all(|entry| entry.is_ok_and(|entry| entry.file_name().to_str() == marker))
        })
    }

    /// Puts the unfinished marker back on a folder that has to stay, only while the folder is
    /// still ours and only as a new file. Otherwise the folder stays unmarked, and that is said.
    fn remark(&mut self) {
        let Some((rel, bytes)) = self.marker_bytes.clone() else {
            return;
        };
        if self.marker.is_some() {
            return;
        }
        let marked = self.tree.check("", false) && self.write_marker(&rel, &bytes).is_ok();
        if !marked {
            log::warn!(
                "An unfinished restore at {} could not be marked unfinished again",
                self.tree.root.display()
            );
        }
    }

    /// Removes only what we made, deepest first, never recursively. The marker goes only once
    /// every other entry is gone. Returns the folder when anything had to stay.
    pub(super) fn clean_up(mut self) -> Option<PathBuf> {
        let mut clean = true;
        let mut files = std::mem::take(&mut self.files);
        files.sort_by_key(|(rel, _)| std::cmp::Reverse(rel.matches('/').count()));
        for (rel, id) in files {
            clean &= self.remove_owned(&rel, id);
        }
        let mut dirs = std::mem::take(&mut self.dirs);
        dirs.sort_by_key(|dir| std::cmp::Reverse(dir.matches('/').count()));
        for dir in dirs {
            let ours = self.tree.check(&dir, false);
            clean &= ours && fs::remove_dir(self.tree.abs(&dir)).is_ok();
        }
        // Anything else still in the folder, even a stranger's file, keeps it marked unfinished.
        if clean && self.only_marker_left() {
            clean = self.remove_marker();
        } else {
            clean = false;
        }
        #[cfg(test)]
        run_hook(&BEFORE_ROOT_REMOVE, &self.tree.root);
        if clean && self.tree.check("", false) && fs::remove_dir(&self.tree.root).is_ok() {
            return None;
        }
        // The folder stays: it must not be left looking finished.
        self.remark();
        Some(self.tree.root)
    }
}

fn sync_dir(dir: &Path) -> bool {
    crate::vault::atomic_replace::sync_dir(dir).is_ok()
}

pub(super) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// What re-reading a file of ours found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Checked {
    Match,
    Mismatch,
    Cancelled,
}

/// Where read bytes go: nowhere (inspection) or into a new file of ours.
pub(super) trait Sink {
    fn begin(&mut self) -> Result<(), OutError>;
    fn write(&mut self, bytes: &[u8]) -> Result<(), OutError>;
    fn finish(&mut self) -> Result<(), OutError>;
    fn abandon(&mut self);
}

pub(super) struct Discard;

impl Sink for Discard {
    fn begin(&mut self) -> Result<(), OutError> {
        Ok(())
    }
    fn write(&mut self, _: &[u8]) -> Result<(), OutError> {
        Ok(())
    }
    fn finish(&mut self) -> Result<(), OutError> {
        Ok(())
    }
    fn abandon(&mut self) {}
}

pub(super) struct ToFile<'a> {
    pub(super) out: &'a mut Output,
    pub(super) rel: String,
    pub(super) modified: Option<u64>,
    pub(super) times_kept: bool,
    file: Option<File>,
}

impl<'a> ToFile<'a> {
    pub(super) fn new(out: &'a mut Output, rel: String, modified: Option<u64>) -> Self {
        Self {
            out,
            rel,
            modified,
            times_kept: true,
            file: None,
        }
    }
}

impl Sink for ToFile<'_> {
    fn begin(&mut self) -> Result<(), OutError> {
        self.file = Some(self.out.create_file(&self.rel)?);
        Ok(())
    }
    fn write(&mut self, bytes: &[u8]) -> Result<(), OutError> {
        let file = self.file.as_mut().ok_or(OutError::Io)?;
        file.write_all(bytes).map_err(|e| out_error(&e))
    }
    fn finish(&mut self) -> Result<(), OutError> {
        let file = self.file.take().ok_or(OutError::Io)?;
        if let Some(ms) = self.modified {
            let time = UNIX_EPOCH + std::time::Duration::from_millis(ms);
            self.times_kept &= file.set_modified(time).is_ok();
        }
        file.sync_all().map_err(|e| out_error(&e))
    }
    fn abandon(&mut self) {
        self.file = None;
        self.out.discard(&self.rel);
    }
}

/// One stable read: the bytes went to the sink and matched the same unchanged file throughout.
pub(super) struct Stable {
    pub(super) bytes: u64,
    pub(super) sha256: String,
    pub(super) modified_ms: u64,
}

pub(super) enum ReadError {
    Gap(GapReason),
    Out(OutError),
    Cancelled,
}

/// A test seam: a step run at a fixed point with a path.
#[cfg(test)]
pub(super) type Hook = std::cell::RefCell<Option<Box<dyn FnMut(&Path)>>>;

#[cfg(test)]
pub(super) fn run_hook(key: &'static std::thread::LocalKey<Hook>, path: &Path) {
    key.with(|hook| {
        if let Some(hook) = hook.borrow_mut().as_mut() {
            hook(path);
        }
    });
}

#[cfg(test)]
thread_local! {
    /// Runs after a source file is opened, before its bytes are read.
    pub(super) static AFTER_OPEN: Hook = const { std::cell::RefCell::new(None) };
    /// Runs after each chunk read from a source file.
    pub(super) static DURING_READ: Hook = const { std::cell::RefCell::new(None) };
    /// Runs after each chunk the check pass re-reads.
    pub(super) static DURING_CHECK: Hook = const { std::cell::RefCell::new(None) };
    /// Runs just before cleanup removes the output folder itself.
    pub(super) static BEFORE_ROOT_REMOVE: Hook = const { std::cell::RefCell::new(None) };
    /// Makes the root listing in cleanup report one unreadable entry.
    pub(super) static ENTRY_ERROR: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

fn after_open(path: &Path) {
    #[cfg(test)]
    run_hook(&AFTER_OPEN, path);
    let _ = path;
}

/// Reads `rel` from `src` into `sink`, retrying a file that changed while it was read.
pub(super) fn read_stable(
    src: &mut Tree,
    rel: &str,
    sink: &mut dyn Sink,
    cancelled: &dyn Fn() -> bool,
) -> Result<Stable, ReadError> {
    for _ in 0..ATTEMPTS {
        match read_once(src, rel, sink, cancelled) {
            Attempt::Done(read) => return Ok(read),
            Attempt::Fail(error) => return Err(error),
            Attempt::Changed => sink.abandon(),
        }
    }
    Err(ReadError::Gap(GapReason::Changing))
}

enum Attempt {
    Done(Stable),
    Changed,
    Fail(ReadError),
}

fn same(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    id_of(a) == id_of(b) && a.len() == b.len() && a.modified().ok() == b.modified().ok()
}

fn read_once(
    src: &mut Tree,
    rel: &str,
    sink: &mut dyn Sink,
    cancelled: &dyn Fn() -> bool,
) -> Attempt {
    let gap = |reason| Attempt::Fail(ReadError::Gap(reason));
    let parent = parent_of(rel);
    if !src.check(parent, true) {
        return gap(GapReason::Changing);
    }
    let path = src.abs(rel);
    let before = match fs::symlink_metadata(&path) {
        Ok(meta) if meta.file_type().is_symlink() => return gap(GapReason::Link),
        Ok(meta) if !meta.is_file() => return gap(GapReason::Special),
        Ok(meta) => meta,
        Err(error) => return gap(gap_of(&error)),
    };
    let mut file = match open_read(&path) {
        Ok(file) => file,
        Err(error) => return gap(gap_of(&error)),
    };
    match file.metadata() {
        Ok(opened) if same(&opened, &before) => {}
        Ok(_) => return Attempt::Changed,
        Err(_) => return gap(GapReason::Unreadable),
    }
    after_open(&path);
    if let Err(error) = sink.begin() {
        return Attempt::Fail(ReadError::Out(error));
    }
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; CHUNK];
    let mut total = 0u64;
    loop {
        if cancelled() {
            sink.abandon();
            return Attempt::Fail(ReadError::Cancelled);
        }
        // Never read past the size we saw; at that end one byte more only probes for growth.
        let ask = (before.len() - total).clamp(1, CHUNK as u64) as usize;
        let read = match file.read(&mut buffer[..ask]) {
            Ok(0) => break,
            Ok(read) => read,
            Err(_) => {
                sink.abandon();
                return gap(GapReason::Unreadable);
            }
        };
        if total == before.len() {
            return Attempt::Changed;
        }
        #[cfg(test)]
        run_hook(&DURING_READ, &path);
        hasher.update(&buffer[..read]);
        total += read as u64;
        if let Err(error) = sink.write(&buffer[..read]) {
            sink.abandon();
            return Attempt::Fail(ReadError::Out(error));
        }
    }
    let stable = file.metadata().is_ok_and(|after| same(&after, &before))
        && fs::symlink_metadata(&path).is_ok_and(|now| same(&now, &before))
        && total == before.len()
        && src.check(parent, false);
    if !stable {
        return Attempt::Changed;
    }
    if let Err(error) = sink.finish() {
        sink.abandon();
        return Attempt::Fail(ReadError::Out(error));
    }
    Attempt::Done(Stable {
        bytes: total,
        sha256: hex(&hasher.finalize()),
        modified_ms: modified_ms(&before),
    })
}

/// Reads at most `limit` bytes of a file that must be a regular file, not a link.
pub(super) fn read_bounded(path: &Path, limit: u64) -> io::Result<Option<Vec<u8>>> {
    let file = open_read(path)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::from(ErrorKind::InvalidData));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    Ok((bytes.len() as u64 <= limit).then_some(bytes))
}
