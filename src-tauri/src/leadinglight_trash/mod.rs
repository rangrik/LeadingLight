//! LeadingLight local Trash: deleted files move into a hidden per-vault store and can be
//! restored. Contract: workspace notes `m3-trash-contract.md` (v2).

mod restore;
mod store;
#[cfg(test)]
mod tests;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tempfile::NamedTempFile;

use restore::Settlement;
pub use restore::{restore_from_trash, LocalTrashRestoreReport};
use store::{sync_folder, TrashStore, VaultRoot};

const RECORD_FILE: &str = "item.json";
const INTENT_FILE: &str = "restore.json";
/// No `.md` extension, so vault walkers that rewrite Markdown never touch a deleted body.
const PAYLOAD_FILE: &str = "payload";
const RECORD_VERSION: u32 = 1;
const ID_LENGTH: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureCode {
    NotFound,
    OutsideVault,
    InternalLocation,
    Symlink,
    NotAFile,
    CrossDevice,
    Io,
    InvalidId,
    PayloadMissing,
    UnsupportedItem,
    OriginalLocationUnavailable,
    NameUnavailable,
}

#[derive(Debug)]
struct Failure {
    code: FailureCode,
    message: String,
}

impl Failure {
    fn new(code: FailureCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn io(error: io::Error) -> Self {
        let code = match error.kind() {
            ErrorKind::NotFound => FailureCode::NotFound,
            ErrorKind::CrossesDevices => FailureCode::CrossDevice,
            _ => FailureCode::Io,
        };
        Self::new(code, error.to_string())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedItem {
    pub path: String,
    pub id: String,
    pub original_path: String,
}

#[derive(Debug, Serialize)]
pub struct MoveFailure {
    pub path: String,
    pub code: FailureCode,
    pub message: String,
}

#[derive(Debug, Default, Serialize)]
pub struct LocalTrashMoveReport {
    pub moved: Vec<MovedItem>,
    pub failed: Vec<MoveFailure>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ItemState {
    Ready,
    NeedsAttention,
    Missing,
    CleanupPending,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTrashItem {
    pub id: String,
    pub state: ItemState,
    pub title: Option<String>,
    pub filename: String,
    pub original_path: Option<String>,
    pub deleted_at: Option<u64>,
    pub file_kind: String,
    pub size_bytes: Option<u64>,
    pub restored_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrashRecord {
    version: u32,
    original_path: String,
    title: String,
    deleted_at: u64,
    /// Device and inode at move time: the only proof that an interrupted move never happened.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_identity: Option<[u64; 2]>,
}

impl TrashRecord {
    fn filename(&self) -> &str {
        self.original_path
            .rsplit('/')
            .next()
            .unwrap_or(&self.original_path)
    }
}

fn is_valid_id(id: &str) -> bool {
    id.len() == ID_LENGTH
        && id
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// A `/`-separated vault path whose segments are all plain and visible.
fn is_visible_relative(path: &str) -> bool {
    !path.is_empty()
        && path.split('/').all(|segment| {
            !segment.is_empty()
                && !segment.starts_with('.')
                && !segment.contains(['\\', '\0'])
                && matches!(
                    Path::new(segment)
                        .components()
                        .collect::<Vec<_>>()
                        .as_slice(),
                    [Component::Normal(_)]
                )
        })
}

fn relative_text(path: &Path) -> Option<String> {
    let segments = path
        .components()
        .map(|component| match component {
            Component::Normal(segment) => segment.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    (!segments.is_empty()).then(|| segments.join("/"))
}

fn distinct(values: &[String]) -> Vec<&str> {
    let mut seen = HashSet::new();
    values
        .iter()
        .map(String::as_str)
        .filter(|value| seen.insert(*value))
        .collect()
}

#[cfg(unix)]
fn file_identity(metadata: &fs::Metadata) -> Option<[u64; 2]> {
    use std::os::unix::fs::MetadataExt;

    Some([metadata.dev(), metadata.ino()])
}

#[cfg(not(unix))]
fn file_identity(_metadata: &fs::Metadata) -> Option<[u64; 2]> {
    None
}

fn identity_of(path: &Path) -> Option<[u64; 2]> {
    fs::symlink_metadata(path)
        .ok()
        .as_ref()
        .and_then(file_identity)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

/// Small JSON written atomically: temp file, flush, rename.
fn write_json(folder: &Path, name: &str, value: &impl Serialize) -> io::Result<()> {
    let mut file = NamedTempFile::new_in(folder)?;
    serde_json::to_writer(&mut file, value).map_err(io::Error::other)?;
    file.as_file().sync_all()?;
    file.persist(folder.join(name))
        .map_err(|error| error.error)?;
    sync_folder(folder);
    Ok(())
}

/// Never follows a symlink inside the store.
fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    fs::symlink_metadata(path)
        .ok()
        .filter(|metadata| metadata.is_file())?;
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn read_record(item: &Path) -> Option<TrashRecord> {
    read_json::<TrashRecord>(&item.join(RECORD_FILE)).filter(|record| {
        record.version == RECORD_VERSION && is_visible_relative(&record.original_path)
    })
}

/// Tidies an item folder that holds no page: only our own record, intent and temp files.
fn discard_item_files(item: &Path) {
    if fs::symlink_metadata(item.join(PAYLOAD_FILE)).is_ok() {
        return;
    }
    for name in [INTENT_FILE, RECORD_FILE] {
        let _ = fs::remove_file(item.join(name));
    }
    if let Ok(entries) = fs::read_dir(item) {
        for entry in entries.flatten() {
            let ours = entry.file_name().to_string_lossy().starts_with(".tmp");
            if ours && entry.file_type().is_ok_and(|kind| kind.is_file()) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    let _ = fs::remove_dir(item);
}

struct Source {
    path: PathBuf,
    relative: String,
    identity: Option<[u64; 2]>,
}

impl Source {
    fn filename(&self) -> &str {
        self.relative.rsplit('/').next().unwrap_or(&self.relative)
    }
}

fn outside_vault() -> Failure {
    Failure::new(FailureCode::OutsideVault, "Path must stay inside the vault")
}

fn resolve_source(vault: &VaultRoot, input: &str) -> Result<Source, Failure> {
    let requested = Path::new(input);
    if requested
        .components()
        .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err(outside_vault());
    }
    let requested = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        vault.root.join(requested)
    };
    let entry = fs::symlink_metadata(&requested).map_err(Failure::io)?;
    if entry.file_type().is_symlink() {
        return Err(Failure::new(
            FailureCode::Symlink,
            "Links to other files are not moved to Trash",
        ));
    }
    let path = requested.canonicalize().map_err(Failure::io)?;
    let inside = vault.relative_inside(&path).ok_or_else(outside_vault)?;
    let relative = requested
        .strip_prefix(&vault.root)
        .ok()
        .and_then(relative_text)
        .or_else(|| relative_text(inside));
    let canonical_visible = relative_text(inside).is_some_and(|text| is_visible_relative(&text));
    let Some(relative) = relative.filter(|text| canonical_visible && is_visible_relative(text))
    else {
        return Err(Failure::new(
            FailureCode::InternalLocation,
            "The vault itself and hidden files are not moved to Trash",
        ));
    };
    if !entry.is_file() {
        return Err(Failure::new(
            FailureCode::NotAFile,
            "Only files are moved to Trash",
        ));
    }
    Ok(Source {
        path,
        relative,
        identity: file_identity(&entry),
    })
}

fn page_title(source: &Source) -> String {
    let markdown = crate::vault::classify_file_kind(&source.path) == "markdown";
    match markdown.then(|| fs::read_to_string(&source.path)) {
        Some(Ok(content)) => {
            crate::vault::derive_markdown_title_from_content(&content, source.filename())
        }
        _ => source.filename().to_string(),
    }
}

/// The record is durable before the page moves, so an interruption leaves either the page
/// in place or a complete item.
fn move_one(vault: &VaultRoot, trash: &Path, input: &str) -> Result<MovedItem, Failure> {
    let source = resolve_source(vault, input)?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let item = trash.join(&id);
    fs::create_dir(&item).map_err(Failure::io)?;
    let record = TrashRecord {
        version: RECORD_VERSION,
        original_path: source.relative.clone(),
        title: page_title(&source),
        deleted_at: now_ms(),
        source_identity: source.identity,
    };
    let moved = write_json(&item, RECORD_FILE, &record)
        .and_then(|()| fs::rename(&source.path, item.join(PAYLOAD_FILE)));
    if let Err(error) = moved {
        discard_item_files(&item);
        return Err(Failure::io(error));
    }
    sync_folder(&item);
    if let Some(parent) = source.path.parent() {
        sync_folder(parent);
    }
    Ok(MovedItem {
        path: input.to_string(),
        id,
        original_path: source.relative,
    })
}

/// Moves each file into the vault's local Trash; one bad path never stops the others.
pub fn move_to_trash(root: &Path, paths: &[String]) -> Result<LocalTrashMoveReport, String> {
    let mut report = LocalTrashMoveReport::default();
    let inputs = distinct(paths);
    if inputs.is_empty() {
        return Ok(report);
    }
    let vault = VaultRoot::open(root)?;
    let store = TrashStore::create(&vault)?;
    for input in inputs {
        match move_one(&vault, &store.dir, input) {
            Ok(moved) => report.moved.push(moved),
            Err(failure) => report.failed.push(MoveFailure {
                path: input.to_string(),
                code: failure.code,
                message: failure.message,
            }),
        }
    }
    Ok(report)
}

/// Only the very file recorded at move time, still at its original path, proves the move never
/// happened; a newer page at that path does not.
fn move_never_happened(vault: &VaultRoot, record: &TrashRecord) -> bool {
    record
        .source_identity
        .is_some_and(|expected| identity_of(&vault.child(&record.original_path)) == Some(expected))
}

/// Settles interrupted work for one item, then describes what remains. Only paths named by
/// the item's own files are inspected, and only with `stat`.
fn inspect_item(vault: &VaultRoot, item: &Path, id: String) -> Option<LocalTrashItem> {
    let record = read_record(item);
    let restored_path = match restore::settle(vault, item) {
        Settlement::Published(published) if !published.cleanup_pending => return None,
        Settlement::Published(published) => Some(published.relative),
        Settlement::Open => None,
    };
    let payload = fs::symlink_metadata(item.join(PAYLOAD_FILE)).ok();
    let state = match (&payload, &record) {
        _ if restored_path.is_some() => ItemState::CleanupPending,
        (Some(_), Some(_)) => ItemState::Ready,
        (Some(_), None) => ItemState::NeedsAttention,
        (None, Some(record)) if move_never_happened(vault, record) => {
            discard_item_files(item);
            return None;
        }
        (None, Some(_)) => ItemState::Missing,
        (None, None) if fs::symlink_metadata(item.join(RECORD_FILE)).is_ok() => ItemState::Missing,
        (None, None) => {
            discard_item_files(item);
            return None;
        }
    };
    let filename = record.as_ref().map_or_else(
        || restore::recovered_name(item, &id),
        |record| record.filename().to_string(),
    );
    Some(LocalTrashItem {
        file_kind: crate::vault::classify_file_kind(Path::new(&filename)),
        id,
        state,
        title: record.as_ref().map(|record| record.title.clone()),
        original_path: record.as_ref().map(|record| record.original_path.clone()),
        deleted_at: record.map(|record| record.deleted_at),
        filename,
        size_bytes: payload.map(|payload| payload.len()),
        restored_path,
    })
}

/// Lists Trash newest first; page bodies are never returned.
pub fn list_trash(root: &Path) -> Result<Vec<LocalTrashItem>, String> {
    let vault = VaultRoot::open(root)?;
    let Some(opened) = TrashStore::existing(&vault)? else {
        return Ok(Vec::new());
    };
    let entries = fs::read_dir(&opened.dir).map_err(store::unavailable)?;
    let mut items = entries
        .flatten()
        .filter_map(|entry| {
            let id = entry
                .file_name()
                .to_str()
                .filter(|name| is_valid_id(name))?
                .to_string();
            entry.file_type().ok().filter(|kind| kind.is_dir())?;
            inspect_item(&vault, &entry.path(), id)
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| {
        right
            .deleted_at
            .cmp(&left.deleted_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(items)
}
