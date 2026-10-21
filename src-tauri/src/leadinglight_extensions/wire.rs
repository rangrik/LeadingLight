//! Reply and request shapes, exactly as frozen in `src/leadinglight/extensions/extensionApi.ts`,
//! `src/leadinglight/proposals/proposalContract.ts` and `proposalUndoContract.ts`. `null` fields
//! are sent as `null`, never left out. Replies are only sent from here, so a reason this host never
//! gives is left out of its enum; the frozen readers still accept the whole union.

use serde::{Deserialize, Deserializer, Serialize};

use super::manifest::Capability;
use super::report::Diagnostic;

// --- Candidates and versions -------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportRefusal {
    ReservedId,
    StorageUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ImportReply {
    #[serde(rename_all = "camelCase")]
    Candidate {
        package_sha256: String,
        package_id: String,
        version: String,
        missing_capabilities: Vec<Capability>,
    },
    Invalid {
        diagnostics: Vec<Diagnostic>,
    },
    Refused {
        reason: ImportRefusal,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredVersion {
    pub(crate) package_sha256: String,
    pub(crate) version: String,
    pub(crate) readable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    pub(crate) package_id: String,
    pub(crate) name: String,
    pub(crate) versions: Vec<StoredVersion>,
    pub(crate) active_sha256: Option<String>,
    pub(crate) previous_sha256: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VaultRefusal {
    VaultUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ListReply {
    Ok { extensions: Vec<InstalledExtension> },
    Refused { reason: VaultRefusal },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ReadReply {
    #[serde(rename_all = "camelCase")]
    Ok {
        package_text: String,
    },
    Unreadable,
    Unknown,
}

// --- Activation ------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivationRefusal {
    UnknownVersion,
    Unreadable,
    Invalid,
    MissingCapabilities,
    ReservedId,
    Changed,
    VaultUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ActivationReply {
    #[serde(rename_all = "camelCase")]
    Active {
        package_sha256: String,
        previous_sha256: Option<String>,
        revoked_runs: u64,
    },
    #[serde(rename_all = "camelCase")]
    Refused {
        reason: ActivationRefusal,
        missing_capabilities: Vec<Capability>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeactivationRefusal {
    Changed,
    VaultUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DeactivationReply {
    #[serde(rename_all = "camelCase")]
    Inactive {
        revoked_runs: u64,
    },
    Refused {
        reason: DeactivationRefusal,
    },
}

// --- Sessions and runs -----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum OpenSessionReply {
    #[serde(rename_all = "camelCase")]
    Open {
        session_id: String,
    },
    Refused {
        reason: VaultRefusal,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CloseSessionReply {
    Closed,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunScope {
    pub(crate) run_id: String,
    pub(crate) session_id: String,
    pub(crate) invocation_id: String,
    pub(crate) package_id: String,
    pub(crate) package_sha256: String,
    pub(crate) command_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunRefusal {
    SessionClosed,
    Cancelled,
    Replayed,
    NotActive,
    UnknownCommand,
    MissingCapabilities,
    Unreadable,
    Busy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RunAdmission {
    Admitted { scope: RunScope },
    Refused { reason: RunRefusal },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum EndRunReply {
    Ended,
    UnknownSession,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HandleRefusal {
    StaleRun,
    OutsideVault,
    Missing,
    NotFolder,
    NotDocument,
    Link,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum FolderHandleReply {
    #[serde(rename_all = "camelCase")]
    Bound {
        folder_handle: String,
        display_path: String,
    },
    Refused {
        reason: HandleRefusal,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DocumentHandleReply {
    #[serde(rename_all = "camelCase")]
    Bound {
        document_handle: String,
        display_path: String,
        content_sha256: String,
    },
    Refused {
        reason: HandleRefusal,
    },
}

// --- Proposals ---------------------------------------------------------------------------------------

/// The request, read strictly: an unknown or missing field is an unreadable argument.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum GuardedProposal {
    #[serde(rename_all = "camelCase")]
    Create {
        operation_id: String,
        run_id: String,
        content: String,
        content_sha256: String,
        folder_handle: String,
        file_name: String,
    },
    #[serde(rename_all = "camelCase")]
    Append {
        operation_id: String,
        run_id: String,
        content: String,
        content_sha256: String,
        document_handle: String,
        expected_sha256: String,
    },
}

impl GuardedProposal {
    pub(crate) fn operation_id(&self) -> &str {
        match self {
            GuardedProposal::Create { operation_id, .. }
            | GuardedProposal::Append { operation_id, .. } => operation_id,
        }
    }
}

/// Without `unsupported`, which no proposal kind this host reads can earn. A bound folder that
/// became a link answers `handleMismatch`; `link` is a bound page that became one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProposalRefusal {
    StaleRun,
    HandleMismatch,
    OperationMismatch,
    DigestMismatch,
    InvalidName,
    TooLarge,
    Link,
    Busy,
    StorageUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictReason {
    Exists,
    Changed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommitKind {
    Create,
    Append,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ProposalReceipt {
    /// An append always carries its undo token; a create carries one when Undo is offered.
    #[serde(rename_all = "camelCase")]
    Committed {
        kind: CommitKind,
        operation_id: String,
        path: String,
        before_sha256: Option<String>,
        after_sha256: String,
        durable: bool,
        undo_receipt: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Conflict {
        operation_id: String,
        reason: ConflictReason,
    },
    #[serde(rename_all = "camelCase")]
    Refused {
        operation_id: String,
        reason: ProposalRefusal,
    },
    #[serde(rename_all = "camelCase")]
    Uncertain { operation_id: String },
}

impl ProposalReceipt {
    pub(crate) fn refused(operation_id: &str, reason: ProposalRefusal) -> Self {
        ProposalReceipt::Refused {
            operation_id: operation_id.to_string(),
            reason,
        }
    }

    pub(crate) fn uncertain(operation_id: &str) -> Self {
        ProposalReceipt::Uncertain {
            operation_id: operation_id.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum QueryState {
    #[serde(rename_all = "camelCase")]
    Running { operation_id: String },
    #[serde(rename_all = "camelCase")]
    Unknown { operation_id: String },
}

/// A finished receipt, or `running` / `unknown`. Never a reason to submit again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum QueryReply {
    Receipt(ProposalReceipt),
    State(QueryState),
}

// --- Undo ------------------------------------------------------------------------------------------

/// The request, read strictly: an unknown or missing field is an unreadable argument, and
/// `beforeSha256` must be present, as a digest or `null`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UndoRequest {
    pub(crate) operation_id: String,
    pub(crate) session_id: String,
    pub(crate) undo_receipt: String,
    pub(crate) kind: UndoKind,
    pub(crate) expected_sha256: String,
    #[serde(deserialize_with = "present")]
    pub(crate) before_sha256: Option<String>,
}

/// A field that may be `null` but never left out.
fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Option::deserialize(deserializer)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UndoKind {
    Create,
    Append,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UndoRefusal {
    SessionClosed,
    UnknownReceipt,
    Consumed,
    OperationMismatch,
    Busy,
    StorageUnavailable,
    PreimageUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UndoConflict {
    Changed,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UndoReceipt {
    /// For an append `restored_sha256` and `durable` are present; for a create both are absent.
    #[serde(rename_all = "camelCase")]
    Undone {
        operation_id: String,
        kind: UndoKind,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        restored_sha256: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        durable: Option<bool>,
    },
    #[serde(rename_all = "camelCase")]
    Conflict {
        operation_id: String,
        reason: UndoConflict,
    },
    #[serde(rename_all = "camelCase")]
    Refused {
        operation_id: String,
        reason: UndoRefusal,
    },
    #[serde(rename_all = "camelCase")]
    Uncertain { operation_id: String },
}

impl UndoReceipt {
    pub(crate) fn refused(operation_id: &str, reason: UndoRefusal) -> Self {
        UndoReceipt::Refused {
            operation_id: operation_id.to_string(),
            reason,
        }
    }

    pub(crate) fn conflict(operation_id: &str, reason: UndoConflict) -> Self {
        UndoReceipt::Conflict {
            operation_id: operation_id.to_string(),
            reason,
        }
    }

    pub(crate) fn uncertain(operation_id: &str) -> Self {
        UndoReceipt::Uncertain {
            operation_id: operation_id.to_string(),
        }
    }

    /// `undone` and `uncertain` use the token up; the rest prove nothing was written.
    pub(crate) fn consumes(&self) -> bool {
        matches!(
            self,
            UndoReceipt::Undone { .. } | UndoReceipt::Uncertain { .. }
        )
    }
}

/// A finished undo, or `running` / `unknown` (the same shapes as a proposal query).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum UndoQueryReply {
    Receipt(UndoReceipt),
    State(QueryState),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ReleaseUndoReply {
    Released,
    Unknown,
}
