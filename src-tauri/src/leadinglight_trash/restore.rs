use super::store::{sync_folder, TrashStore, VaultRoot};
use super::{
    discard_item_files, distinct, file_identity, identity_of, is_valid_id, is_visible_relative,
    read_json, read_record, write_json, Failure, FailureCode, TrashRecord, INTENT_FILE,
    PAYLOAD_FILE, RECORD_VERSION,
};
use crate::vault::VaultEntry;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, ErrorKind, Read};
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

const MAX_NAME_ATTEMPTS: usize = 1000;
const TEXT_SAMPLE_BYTES: u64 = 64 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredItem {
    pub id: String,
    pub path: String,
    pub relative_path: String,
    pub renamed: bool,
    pub relocated: bool,
    pub cleanup_pending: bool,
    pub entry: Option<VaultEntry>,
}

#[derive(Debug, Serialize)]
pub struct RestoreFailure {
    pub id: String,
    pub code: FailureCode,
    pub message: String,
}

#[derive(Debug, Default, Serialize)]
pub struct LocalTrashRestoreReport {
    pub restored: Vec<RestoredItem>,
    pub failed: Vec<RestoreFailure>,
}

/// Names the target and the identity the published file will have; `committed` once it exists.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreIntent {
    version: u32,
    target: String,
    #[serde(default)]
    identity: Option<[u64; 2]>,
    #[serde(default)]
    committed: bool,
}

/// What an earlier restore left behind for one item.
pub(super) enum Settlement {
    /// No restore was under way, or it provably never published.
    Open,
    /// An earlier restore already published the page.
    Published(Published),
}

pub(super) struct Published {
    pub(super) relative: String,
    /// The copy left in Trash could not be removed yet.
    pub(super) cleanup_pending: bool,
    /// The target is provably the published file inside the vault; only then is it read back.
    proven: bool,
}

/// Failure switches for tests; always off in the app.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Fault {
    NoHardLinks,
    PayloadUnlink,
}

#[cfg(not(test))]
fn injected(_fault: Fault) -> bool {
    false
}

#[cfg(test)]
thread_local! {
    static INJECTED: std::cell::RefCell<Vec<Fault>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
fn injected(fault: Fault) -> bool {
    INJECTED.with(|faults| faults.borrow().contains(&fault))
}

#[cfg(test)]
pub(super) fn inject(faults: &[Fault]) {
    INJECTED.with(|current| *current.borrow_mut() = faults.to_vec());
}

fn io_failure(error: io::Error) -> Failure {
    Failure::new(FailureCode::Io, error.to_string())
}

fn not_found(id: &str) -> Failure {
    if is_valid_id(id) {
        Failure::new(FailureCode::NotFound, "No item with that id in Trash")
    } else {
        Failure::new(FailureCode::InvalidId, "Not a Trash item id")
    }
}

/// Name used when the record is unreadable and the original location is unknown.
pub(super) fn recovered_name(item: &Path, id: &str) -> String {
    let stem = format!("recovered-{}", &id[..8]);
    if is_text(&item.join(PAYLOAD_FILE)) {
        format!("{stem}.md")
    } else {
        stem
    }
}

fn is_text(path: &Path) -> bool {
    if !fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file()) {
        return false;
    }
    let mut sample = Vec::new();
    let read =
        File::open(path).and_then(|file| file.take(TEXT_SAMPLE_BYTES).read_to_end(&mut sample));
    read.is_ok()
        && std::str::from_utf8(&sample).map_or_else(|error| error.error_len().is_none(), |_| true)
}

fn read_intent(path: &Path) -> Option<RestoreIntent> {
    read_json::<RestoreIntent>(path)
        .filter(|intent| intent.version == RECORD_VERSION && is_visible_relative(&intent.target))
}

/// Proof that the intent's page exists now: a regular file at the target, inside a visible
/// vault folder, with the recorded identity where the platform has one.
fn is_published(vault: &VaultRoot, intent: &RestoreIntent) -> bool {
    let target = vault.child(&intent.target);
    let in_vault = target
        .parent()
        .is_some_and(|folder| vault.is_visible_folder(folder));
    let Some(entry) = fs::symlink_metadata(&target)
        .ok()
        .filter(|metadata| in_vault && metadata.is_file())
    else {
        return false;
    };
    match (intent.identity, file_identity(&entry)) {
        (Some(expected), Some(actual)) => expected == actual,
        (None, None) => intent.committed,
        _ => false,
    }
}

fn remove_payload(payload: &Path) -> io::Result<()> {
    if injected(Fault::PayloadUnlink) {
        return Err(io::Error::other("injected payload unlink failure"));
    }
    fs::remove_file(payload)
}

/// Finishes or clears an interrupted restore. The Trash copy is removed only with proof that
/// the page is published, and a committed restore is never treated as unpublished.
pub(super) fn settle(vault: &VaultRoot, item: &Path) -> Settlement {
    let intent_path = item.join(INTENT_FILE);
    if fs::symlink_metadata(&intent_path).is_err() {
        return Settlement::Open;
    }
    let Some(mut intent) = read_intent(&intent_path) else {
        let _ = fs::remove_file(&intent_path);
        return Settlement::Open;
    };
    let proven = is_published(vault, &intent);
    if !intent.committed && !proven {
        let _ = fs::remove_file(&intent_path);
        return Settlement::Open;
    }
    if !intent.committed {
        intent.committed = true;
        let _ = write_json(item, INTENT_FILE, &intent);
    }
    let payload = item.join(PAYLOAD_FILE);
    let payload_left = fs::symlink_metadata(&payload).is_ok();
    let cleanup_pending = payload_left && !(proven && remove_payload(&payload).is_ok());
    if !cleanup_pending {
        discard_item_files(item);
    }
    Settlement::Published(Published {
        relative: intent.target,
        cleanup_pending,
        proven,
    })
}

struct Destination {
    folder: PathBuf,
    folder_relative: String,
    filename: String,
}

impl Destination {
    /// The record's own folder, recreated when missing. Never anywhere else, because
    /// note-relative links depend on it.
    fn original(vault: &VaultRoot, record: &TrashRecord) -> Result<Self, Failure> {
        let (folder_relative, filename) = match record.original_path.rsplit_once('/') {
            Some((folder, name)) => (folder.to_string(), name.to_string()),
            None => (String::new(), record.original_path.clone()),
        };
        let folder = prepare_folder(vault, &folder_relative).ok_or_else(|| {
            Failure::new(
                FailureCode::OriginalLocationUnavailable,
                format!("The original folder '{folder_relative}' cannot be used"),
            )
        })?;
        Ok(Self {
            folder,
            folder_relative,
            filename,
        })
    }

    fn recovered(vault: &VaultRoot, item: &Path, id: &str) -> Self {
        Self {
            folder: vault.root.clone(),
            folder_relative: String::new(),
            filename: recovered_name(item, id),
        }
    }

    fn relative(&self, filename: &str) -> String {
        if self.folder_relative.is_empty() {
            filename.to_string()
        } else {
            format!("{}/{filename}", self.folder_relative)
        }
    }
}

/// Existing levels must already be visible vault folders; missing ones are created inside them.
fn prepare_folder(vault: &VaultRoot, relative: &str) -> Option<PathBuf> {
    let mut folder = vault.root.clone();
    let mut segments = relative
        .split('/')
        .filter(|segment| !segment.is_empty())
        .peekable();
    while let Some(segment) = segments.peek() {
        let next = folder.join(segment);
        match fs::symlink_metadata(&next) {
            Ok(_) if vault.is_visible_folder(&next) => {
                folder = next;
                segments.next();
            }
            Err(error) if error.kind() == ErrorKind::NotFound => break,
            _ => return None,
        }
    }
    for segment in segments {
        folder.push(segment);
        let created = match fs::create_dir(&folder) {
            Ok(()) => true,
            Err(error) => error.kind() == ErrorKind::AlreadyExists,
        };
        // Checked per level, so a folder swapped for a link never receives the next one.
        if !created || !vault.is_visible_folder(&folder) {
            return None;
        }
    }
    vault.is_visible_folder(&folder).then_some(folder)
}

fn candidate_name(filename: &str, attempt: usize) -> String {
    if attempt == 0 {
        return filename.to_string();
    }
    let path = Path::new(filename);
    let stem = path.file_stem().map_or_else(
        || filename.to_string(),
        |stem| stem.to_string_lossy().into_owned(),
    );
    let extension = path
        .extension()
        .map(|extension| format!(".{}", extension.to_string_lossy()))
        .unwrap_or_default();
    format!("{stem}-{}{extension}", attempt + 1)
}

/// A complete, flushed copy in the destination folder with the original modification time.
fn flushed_copy(payload: &Path, folder: &Path) -> io::Result<NamedTempFile> {
    let mut copy = NamedTempFile::new_in(folder)?;
    let mut source = File::open(payload)?;
    io::copy(&mut source, copy.as_file_mut())?;
    copy.as_file()
        .set_modified(source.metadata()?.modified()?)?;
    copy.as_file().sync_all()?;
    Ok(copy)
}

/// Records the intent, then claims the name without replacing anything: a hard link keeps the
/// payload's identity; a copy's identity is recorded before it is renamed in.
fn place(
    item: &Path,
    payload: &Path,
    target: &Path,
    mut intent: RestoreIntent,
) -> io::Result<RestoreIntent> {
    write_json(item, INTENT_FILE, &intent)?;
    let linked = if injected(Fault::NoHardLinks) {
        Err(ErrorKind::Unsupported.into())
    } else {
        fs::hard_link(payload, target)
    };
    match linked {
        Err(error) if error.kind() != ErrorKind::AlreadyExists => {
            let folder = target.parent().ok_or(ErrorKind::NotFound)?;
            let copy = flushed_copy(payload, folder)?;
            intent.identity = copy
                .as_file()
                .metadata()
                .ok()
                .as_ref()
                .and_then(file_identity);
            write_json(item, INTENT_FILE, &intent)?;
            copy.persist_noclobber(target)
                .map_err(|error| error.error)?;
        }
        result => result?,
    }
    Ok(intent)
}

/// Past the commit point: always a success. The Trash copy goes only after the commit mark is
/// written, so recovery can never mistake this restore for an unpublished one.
fn commit(
    vault: &VaultRoot,
    item: &Path,
    payload: &Path,
    folder: &Path,
    mut intent: RestoreIntent,
) -> Published {
    sync_folder(folder);
    intent.committed = true;
    let cleaned = write_json(item, INTENT_FILE, &intent).is_ok() && remove_payload(payload).is_ok();
    if cleaned {
        discard_item_files(item);
    }
    Published {
        proven: is_published(vault, &intent),
        relative: intent.target,
        cleanup_pending: !cleaned,
    }
}

/// Claims the first free name in the destination folder; the Trash copy stays until then.
fn publish(
    vault: &VaultRoot,
    item: &Path,
    payload: &Path,
    destination: &Destination,
) -> Result<Published, Failure> {
    for attempt in 0..MAX_NAME_ATTEMPTS {
        let filename = candidate_name(&destination.filename, attempt);
        let intent = RestoreIntent {
            version: RECORD_VERSION,
            target: destination.relative(&filename),
            identity: identity_of(payload),
            committed: false,
        };
        match place(item, payload, &destination.folder.join(&filename), intent) {
            Ok(intent) => return Ok(commit(vault, item, payload, &destination.folder, intent)),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => {
                let _ = fs::remove_file(item.join(INTENT_FILE));
                return Err(io_failure(error));
            }
        }
    }
    let _ = fs::remove_file(item.join(INTENT_FILE));
    Err(Failure::new(
        FailureCode::NameUnavailable,
        "No free name was found for this item",
    ))
}

fn restored(
    vault: &VaultRoot,
    id: &str,
    record: Option<&TrashRecord>,
    published: Published,
) -> RestoredItem {
    let path = vault.child(&published.relative);
    // An unproven target may now resolve outside the vault, so it is never read.
    let entry = published
        .proven
        .then(|| crate::vault::reload_entry(&path).ok())
        .flatten();
    RestoredItem {
        id: id.to_string(),
        entry,
        path: path.to_string_lossy().into_owned(),
        renamed: record.is_some_and(|record| record.original_path != published.relative),
        relocated: record.is_none(),
        relative_path: published.relative,
        cleanup_pending: published.cleanup_pending,
    }
}

fn restore_one(vault: &VaultRoot, trash: &Path, id: &str) -> Result<RestoredItem, Failure> {
    if !is_valid_id(id) {
        return Err(not_found(id));
    }
    let item = trash.join(id);
    if !fs::symlink_metadata(&item).is_ok_and(|metadata| metadata.is_dir()) {
        return Err(not_found(id));
    }
    let record = read_record(&item);
    // An earlier restore that already published returns that page; it is never published twice.
    if let Settlement::Published(published) = settle(vault, &item) {
        return Ok(restored(vault, id, record.as_ref(), published));
    }
    let payload = item.join(PAYLOAD_FILE);
    match fs::symlink_metadata(&payload) {
        Ok(metadata) if metadata.is_file() => {}
        Ok(_) => {
            return Err(Failure::new(
                FailureCode::UnsupportedItem,
                "The stored item is not a regular file",
            ))
        }
        Err(_) if record.is_some() => {
            return Err(Failure::new(
                FailureCode::PayloadMissing,
                "The file for this item is missing",
            ))
        }
        Err(_) => return Err(not_found(id)),
    }
    let destination = match &record {
        Some(record) => Destination::original(vault, record)?,
        None => Destination::recovered(vault, &item, id),
    };
    let published = publish(vault, &item, &payload, &destination)?;
    Ok(restored(vault, id, record.as_ref(), published))
}

/// Restores each item without replacing anything; failures leave the item in Trash.
pub fn restore_from_trash(root: &Path, ids: &[String]) -> Result<LocalTrashRestoreReport, String> {
    let mut report = LocalTrashRestoreReport::default();
    let ids = distinct(ids);
    if ids.is_empty() {
        return Ok(report);
    }
    let vault = VaultRoot::open(root)?;
    let store = TrashStore::existing(&vault)?;
    for id in ids {
        let outcome = match &store {
            Some(store) => restore_one(&vault, &store.dir, id),
            None => Err(not_found(id)),
        };
        match outcome {
            Ok(restored) => report.restored.push(restored),
            Err(failure) => report.failed.push(RestoreFailure {
                id: id.to_string(),
                code: failure.code,
                message: failure.message,
            }),
        }
    }
    Ok(report)
}
