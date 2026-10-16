//! The frozen wire shapes shared with the frontend queue. Inputs reject unknown fields, so two
//! different envelopes can never bind as one.

use serde::{Deserialize, Serialize};

/// One save attempt, made by the frontend before invoke and never changed afterwards.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginalRequest {
    pub request_id: String,
    pub vault_path: String,
    pub session: String,
    pub path: String,
    pub seq: u64,
    pub submitted_sha256: String,
}

/// The text a person wants to keep now; it may be newer than the original request.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftSnapshot {
    pub seq: u64,
    pub content: String,
}

/// The exact snapshot one final resolution settles.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmedSnapshot {
    pub seq: u64,
    pub content_sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HoldKind {
    Missing,
    Linked,
    Conflict,
    Uncertain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldInfo {
    pub request_id: String,
    pub kind: HoldKind,
    pub seq: u64,
    pub submitted_sha256: String,
}

/// Every refusal means no publication was attempted; none certifies the bytes on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "reason", rename_all = "camelCase")]
pub enum Refusal {
    OutsideVault,
    ReadOnly,
    ReadFailed,
    StageFailed,
    Busy,
    RequestMismatch,
    RequestVoided,
    /// Another request holds this page; its envelope lets a window that never saw it recover.
    #[serde(rename_all = "camelCase")]
    Held {
        held_by: String,
        held_request: OriginalRequest,
        held_kind: HoldKind,
    },
    Missing {
        hold: HoldInfo,
    },
    ParentMissing {
        hold: HoldInfo,
    },
    Linked {
        hold: HoldInfo,
    },
    Symlink {
        hold: HoldInfo,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailedReason {
    Publish,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictReason {
    ChangedDuringSave,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveOutcome {
    /// `history` is S1's hook and is always null in S0.
    Committed {
        written: bool,
        durable: bool,
        history: Option<()>,
    },
    Refused(Refusal),
    /// A publish was attempted and the original is proven unchanged.
    Failed {
        reason: FailedReason,
    },
    Conflict {
        reason: ConflictReason,
        hold: HoldInfo,
    },
    #[serde(rename_all = "camelCase")]
    Uncertain {
        hold: HoldInfo,
        original_at: Option<String>,
        staged_at: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Terminal {
    Committed,
    Refused,
    Failed,
    Conflict,
    Uncertain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SaveRequestState {
    Voided,
    Running,
    Done { outcome: SaveOutcome },
    Retired { terminal: Terminal, resolved: bool },
    Mismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CopyRefusal {
    Busy,
    OutsideVault,
    NameUnavailable,
    OperationMismatch,
    RequestMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CopyOutcome {
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
        reason: CopyRefusal,
    },
    /// Nothing was created.
    Failed {
        message: String,
    },
    /// Ownership is unproven; no new copy will be made for this operation.
    #[serde(rename_all = "camelCase")]
    Uncertain {
        candidate_path: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolutionRefusal {
    RequestMismatch,
    ActionMismatch,
    CopyNotPublished,
    CopyNotOwned,
    /// The owned copy no longer holds the confirmed text, or cannot be read.
    CopyChanged,
    OperationMismatch,
    Busy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ResolutionOutcome {
    #[serde(rename_all = "camelCase")]
    Resolved {
        action_id: String,
        hold_retired: bool,
        leftovers: Vec<String>,
    },
    Running,
    Refused {
        reason: ResolutionRefusal,
    },
}

impl SaveOutcome {
    pub(crate) fn refused(refusal: Refusal) -> Self {
        Self::Refused(refusal)
    }

    pub(crate) fn terminal(&self) -> Terminal {
        match self {
            Self::Committed { .. } => Terminal::Committed,
            Self::Refused(_) => Terminal::Refused,
            Self::Failed { .. } => Terminal::Failed,
            Self::Conflict { .. } => Terminal::Conflict,
            Self::Uncertain { .. } => Terminal::Uncertain,
        }
    }
}
