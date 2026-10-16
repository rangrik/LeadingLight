//! S1a wire shapes for automatic earlier versions (revision 3 §8). Recorded paths are portable
//! vault-relative labels; a created copy's path is absolute, as in S0's `CopyOutcome`.

use serde::{Deserialize, Serialize};

/// Why an earlier version that should have been kept was not; the page itself still saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NotKeptReason {
    TooLarge,
    Full,
    LowSpace,
    Busy,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum HistoryNote {
    NotKept { reason: NotKeptReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionReason {
    FirstSave,
    SessionStart,
    ChangedElsewhere,
    BigChange,
    Checkpoint,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRow {
    pub id: String,
    pub recorded_path: String,
    pub captured_at: u64,
    pub reason: VersionReason,
    pub length: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HealthState {
    On,
    NotKeeping,
    /// The store could not be checked right now; nothing should be raised or cleared.
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryHealth {
    pub state: HealthState,
    pub reason: Option<NotKeptReason>,
    pub used_bytes: Option<u64>,
    pub budget_bytes: u64,
    pub unreadable: u64,
    pub attention: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HistoryRefusal {
    OutsideVault,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ListVersionsOutcome {
    #[serde(rename_all = "camelCase")]
    Ok {
        versions: Vec<VersionRow>,
        next_cursor: Option<String>,
        health: HistoryHealth,
    },
    Refused {
        reason: HistoryRefusal,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedLocation {
    pub path: String,
    pub newest_at: u64,
    pub count: u64,
    pub exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ListLocationsOutcome {
    #[serde(rename_all = "camelCase")]
    Ok {
        locations: Vec<SavedLocation>,
        next_cursor: Option<String>,
    },
    Refused {
        reason: HistoryRefusal,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ReadVersionOutcome {
    /// Only after the whole payload matched its length and hash; `text` is null when not UTF-8.
    #[serde(rename_all = "camelCase")]
    Ok {
        text: Option<String>,
        length: u64,
        shown_bytes: u64,
        truncated: bool,
        bom: bool,
        crlf: bool,
    },
    Damaged,
    Missing,
    Refused {
        reason: HistoryRefusal,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionCopyRefusal {
    Busy,
    OutsideVault,
    NameUnavailable,
    OperationMismatch,
    Damaged,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum VersionCopyOutcome {
    #[serde(rename_all = "camelCase")]
    Created {
        path: String,
        relative_path: String,
        durable: bool,
    },
    #[serde(rename_all = "camelCase")]
    FolderUnavailable {
        recorded_folder: String,
    },
    Refused {
        reason: VersionCopyRefusal,
    },
    Failed {
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Uncertain {
        candidate_path: Option<String>,
    },
}
