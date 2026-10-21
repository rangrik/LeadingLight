//! Local conversation records: one private JSON file per conversation, in a folder per vault named
//! by a hash of the vault's resolved path, under LeadingLight's local app data. Never in a vault and
//! never sent anywhere. Attachment texts are not kept, only their summaries.
//!
//! Writes are atomic: a synced temporary file, one rename, then the folder is synced. A failed
//! rename (or unlink) means nothing changed; a failed folder sync after it means the change is in
//! place but may not survive a power loss, and is reported as such, never as no change. Reads are
//! bounded, and a record that breaks any rule is left untouched and not shown. Nothing here removes a
//! conversation except an explicit delete or the reclaiming of an empty, never-sent one.

use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

use super::check::{
    self, ATTACHMENTS, ATTACHMENT_BYTES, CONVERSATIONS_PER_VAULT, INCLUDED_TURNS, LABEL_CHARS,
    REQUEST_BYTES, TURNS_PER_CONVERSATION,
};
use super::is_instant;
use super::wire::{AttachmentSummary, Entry, Failure, RevisionBase};
use crate::vault::staged_file::{NativePlatform, Platform};

const FORMAT: u32 = 1;
/// Fifty turns of the largest request and reply, escaped, fit well within this.
pub(crate) const MAX_RECORD_BYTES: usize = 16 * 1024 * 1024;
/// Folder entries one listing looks at; anything beyond is not shown.
const MAX_SCANNED_ENTRIES: usize = 4 * CONVERSATIONS_PER_VAULT;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Record {
    pub(crate) format: u32,
    pub(crate) conversation_id: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) title: String,
    pub(crate) entries: Vec<Entry>,
}

impl Record {
    pub(crate) fn new(conversation_id: String, at: String) -> Self {
        Self {
            format: FORMAT,
            conversation_id,
            created_at: at.clone(),
            updated_at: at,
            title: String::new(),
            entries: Vec::new(),
        }
    }

    pub(crate) fn turns(&self) -> usize {
        self.entries
            .iter()
            .filter(|entry| entry.is_request())
            .count()
    }

    /// The request still waiting for its outcome, if the last entry is one.
    pub(crate) fn waiting(&self) -> Option<&str> {
        match self.entries.last() {
            Some(entry @ Entry::Request { .. }) => Some(entry.turn_id()),
            _ => None,
        }
    }

    pub(crate) fn request(&self, turn_id: &str) -> Option<&Entry> {
        self.entries
            .iter()
            .find(|entry| entry.is_request() && entry.turn_id() == turn_id)
    }

    pub(crate) fn outcome(&self, turn_id: &str) -> Option<&Entry> {
        self.entries
            .iter()
            .find(|entry| !entry.is_request() && entry.turn_id() == turn_id)
    }
}

/// A folder only this user can read, created if missing; never a link.
pub(crate) fn private_dir(path: &Path) -> std::io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)?;
    if fs::symlink_metadata(path)?.is_dir() {
        Ok(())
    } else {
        Err(std::io::Error::other("not a private folder"))
    }
}

/// The filesystem effects tests replace; reading and listing are ordinary filesystem work.
pub(crate) trait StoreIo: Send + Sync {
    /// Puts a fully written file at `path` in one rename. An error means `path` is unchanged.
    fn publish(&self, file: NamedTempFile, path: &Path) -> std::io::Result<()>;
    fn sync_dir(&self, dir: &Path) -> std::io::Result<()>;
    /// An error means the file is still there.
    fn remove_file(&self, path: &Path) -> std::io::Result<()>;
}

pub(crate) struct NativeStoreIo;

impl StoreIo for NativeStoreIo {
    fn publish(&self, file: NamedTempFile, path: &Path) -> std::io::Result<()> {
        file.persist(path).map(drop).map_err(|error| error.error)
    }

    fn sync_dir(&self, dir: &Path) -> std::io::Result<()> {
        NativePlatform.sync_dir(dir)
    }

    fn remove_file(&self, path: &Path) -> std::io::Result<()> {
        fs::remove_file(path)
    }
}

/// A change that is in place. `Err` instead means nothing changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Published {
    /// In place and its folder synced.
    Durable,
    /// In place, but the folder sync failed: it may not survive a power loss.
    Unsynced,
}

fn synced(io: &dyn StoreIo, dir: &Path) -> Published {
    match io.sync_dir(dir) {
        Ok(()) => Published::Durable,
        Err(error) => {
            log::warn!("An Adapt change is in place, but its folder could not be synced: {error}");
            Published::Unsynced
        }
    }
}

/// A plain file's bytes within `limit`; `None` for no file or anything else.
pub(crate) fn read_bounded(path: &Path, limit: usize) -> Option<Vec<u8>> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > limit as u64 {
        return None;
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() <= limit).then_some(bytes)
}

pub(crate) struct Store {
    root: PathBuf,
    io: Arc<dyn StoreIo>,
}

impl Store {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self::with_io(root, Arc::new(NativeStoreIo))
    }

    pub(crate) fn with_io(root: PathBuf, io: Arc<dyn StoreIo>) -> Self {
        Self { root, io }
    }

    /// A fully synced private temporary file beside `path`, one rename onto it, then the folder is
    /// synced. `Err`: not written, `path` is as it was.
    pub(crate) fn write(
        &self,
        dir: &Path,
        path: &Path,
        bytes: &[u8],
    ) -> std::io::Result<Published> {
        let mut file = NamedTempFile::new_in(dir)?;
        file.write_all(bytes)?;
        file.as_file().sync_all()?;
        self.io.publish(file, path)?;
        Ok(synced(self.io.as_ref(), dir))
    }

    fn dir(&self, vault: &str) -> PathBuf {
        self.root.join(vault)
    }

    fn path(&self, vault: &str, conversation_id: &str) -> PathBuf {
        self.dir(vault).join(format!("{conversation_id}.json"))
    }

    pub(crate) fn prepare(&self, vault: &str) -> std::io::Result<()> {
        private_dir(&self.dir(vault))
    }

    pub(crate) fn load(&self, vault: &str, conversation_id: &str) -> Option<Record> {
        if !check::is_token(conversation_id) {
            return None;
        }
        let bytes = read_bounded(&self.path(vault, conversation_id), MAX_RECORD_BYTES)?;
        let record: Record = serde_json::from_slice(&bytes).ok()?;
        is_valid(&record, conversation_id).then_some(record)
    }

    /// Every readable record of this vault, at most `MAX_SCANNED_ENTRIES` folder entries looked at.
    pub(crate) fn list(&self, vault: &str) -> Vec<Record> {
        let Ok(entries) = fs::read_dir(self.dir(vault)) else {
            return Vec::new();
        };
        entries
            .take(MAX_SCANNED_ENTRIES)
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let name = entry.file_name();
                let id = name.to_str()?.strip_suffix(".json")?.to_string();
                self.load(vault, &id)
            })
            .collect()
    }

    /// `Err`: nothing written, the stored record is as it was.
    pub(crate) fn save(&self, vault: &str, record: &Record) -> std::io::Result<Published> {
        let bytes = serde_json::to_vec(record).map_err(std::io::Error::other)?;
        if bytes.len() > MAX_RECORD_BYTES {
            return Err(std::io::Error::other(
                "the conversation is larger than its bound",
            ));
        }
        let dir = self.dir(vault);
        private_dir(&dir)?;
        self.write(&dir, &self.path(vault, &record.conversation_id), &bytes)
    }

    /// `Err`: the record is still there. A record already gone is deleted.
    pub(crate) fn delete(&self, vault: &str, conversation_id: &str) -> std::io::Result<Published> {
        if !check::is_token(conversation_id) {
            return Err(std::io::Error::other("not a conversation id"));
        }
        match self.io.remove_file(&self.path(vault, conversation_id)) {
            Ok(()) => Ok(synced(self.io.as_ref(), &self.dir(vault))),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(Published::Durable),
            Err(error) => Err(error),
        }
    }
}

fn summary_fits(summary: &AttachmentSummary) -> bool {
    check::is_plain_line(&summary.label, LABEL_CHARS)
        && summary.bytes <= ATTACHMENT_BYTES as u64
        && check::is_sha256(&summary.sha256)
}

fn revision_fits(revision: &Option<RevisionBase>) -> bool {
    revision.as_ref().is_none_or(check::revision_fits)
}

/// The contract reader's rules: bounded entries, requests and outcomes alternating, each outcome for
/// the request before it, included turns earlier and finished. Only the last request may wait.
pub(crate) fn is_valid(record: &Record, conversation_id: &str) -> bool {
    let shaped = record.format == FORMAT
        && record.conversation_id == conversation_id
        && check::is_token(conversation_id)
        && is_instant(&record.created_at)
        && is_instant(&record.updated_at)
        && (record.title.is_empty() || check::is_plain_line(&record.title, LABEL_CHARS))
        && record.entries.len() <= 2 * TURNS_PER_CONVERSATION;
    if !shaped {
        return false;
    }
    let mut finished: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut waiting: Option<&str> = None;
    for entry in &record.entries {
        if !is_instant(entry_at(entry)) || !check::is_turn_id(entry.turn_id()) {
            return false;
        }
        match entry {
            Entry::Request {
                turn_id,
                text,
                attachments,
                included_turn_ids,
                revision,
                guide,
                ..
            } => {
                let fits = waiting.is_none()
                    && !finished.contains(turn_id.as_str())
                    && !check::is_blank(text)
                    && text.len() <= REQUEST_BYTES
                    && attachments.len() <= ATTACHMENTS
                    && attachments.iter().all(summary_fits)
                    && included_turn_ids.len() <= INCLUDED_TURNS
                    && included_turn_ids
                        .iter()
                        .all(|id| finished.contains(id.as_str()))
                    && revision_fits(revision)
                    && check::is_token(guide);
                if !fits {
                    return false;
                }
                waiting = Some(turn_id.as_str());
            }
            outcome => {
                if waiting != Some(outcome.turn_id()) || !outcome_fits(outcome) {
                    return false;
                }
                finished.insert(outcome.turn_id());
                waiting = None;
            }
        }
    }
    true
}

fn entry_at(entry: &Entry) -> &str {
    match entry {
        Entry::Request { at, .. }
        | Entry::Reply { at, .. }
        | Entry::Failed { at, .. }
        | Entry::Stopped { at, .. } => at,
    }
}

fn outcome_fits(entry: &Entry) -> bool {
    match entry {
        Entry::Reply { reply, .. } => check::check_reply(reply).is_ok(),
        Entry::Failed {
            reason, resets_at, ..
        } => resets_at
            .as_deref()
            .is_none_or(|at| *reason == Failure::UsageLimit && is_instant(at)),
        Entry::Stopped { .. } => true,
        Entry::Request { .. } => false,
    }
}
