//! Reply and request shapes, exactly as frozen in `src/leadinglight/extensions/extensionApi.ts` and
//! `src/leadinglight/proposals/proposalContract.ts`. `null` fields are sent as `null`, never left out.
//! Replies are only sent from here, so a reason E1 never gives is left out of its enum; the
//! frozen readers still accept the whole union.

use serde::{Deserialize, Serialize};

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

/// Without `notDocument`, which only a document binding gives (the append milestone).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HandleRefusal {
    StaleRun,
    OutsideVault,
    Missing,
    NotFolder,
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

/// E1 binds no documents; the `bound` shape belongs to the append milestone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DocumentHandleReply {
    Refused { reason: HandleRefusal },
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

/// Without `link`: a bound folder that became a link no longer matches its handle, so E1
/// answers `handleMismatch`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProposalRefusal {
    StaleRun,
    HandleMismatch,
    OperationMismatch,
    DigestMismatch,
    InvalidName,
    TooLarge,
    Unsupported,
    Busy,
    StorageUnavailable,
}

/// Without `changed`, which only an append checking its expected document gives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictReason {
    Exists,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommitKind {
    Create,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ProposalReceipt {
    /// E1 commits creations only, with no undo promise.
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
