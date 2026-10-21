//! Request and reply shapes, exactly as frozen in `src/leadinglight/adapt/adaptContract.ts`.
//! Arguments are read strictly: an unknown or missing field is an unreadable argument. `null`
//! fields are sent as `null`, never left out. Entries also round-trip through local storage.

use serde::{Deserialize, Serialize};

// --- Providers and account -------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderId {
    Codex,
    Claude,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UnavailableReason {
    NotInstalled,
    UnsupportedVersion,
    Unqualified,
    NotAuthorized,
    Failed,
    StorageUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LastConnect {
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AccountRefusal {
    AccountNotSupported,
}

/// Never carries an email, account id, token or plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ProviderState {
    #[serde(rename_all = "camelCase")]
    Unavailable {
        reason: UnavailableReason,
        installed_version: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    SignedOut {
        last_connect: Option<LastConnect>,
    },
    Connecting,
    Connected,
    Refused {
        reason: AccountRefusal,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Providers {
    pub codex: ProviderState,
    pub claude: ProviderState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StatusReply {
    pub revision: u64,
    pub providers: Providers,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusArgs {}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectArgs {
    pub provider: ProviderId,
    pub disclosure_version: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderArgs {
    pub provider: ProviderId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectRefusal {
    Unavailable,
    AlreadyConnected,
    Busy,
    BrowserUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ConnectReply {
    Started,
    Refused { reason: ConnectRefusal },
}

/// Contract amendment 4. `Cancelled`: the sign-in was cancelled, its work is proven ended and its
/// credentials cleaned up. `NotConnecting`: no sign-in, and no cancellation still unresolved.
/// `Unconfirmed`: no sign-in can complete any more, but its work ending or its cleanup cannot be
/// proven, so it is never reported as cancelled. Provider status stays authoritative.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CancelConnectReply {
    Cancelled,
    NotConnecting,
    Unconfirmed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DisconnectRefusal {
    Unavailable,
    Failed,
}

/// `Stopping`: signed out and nothing is admitted, but some cancelled work is not yet proven ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DisconnectReply {
    Disconnected,
    Stopping,
    Refused { reason: DisconnectRefusal },
}

// --- Visits ----------------------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenVisitArgs {
    pub vault_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisitArgs {
    pub visit_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VisitRefusal {
    VaultUnavailable,
    StorageUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum OpenVisitReply {
    #[serde(rename_all = "camelCase")]
    Open {
        visit_id: String,
    },
    Refused {
        reason: VisitRefusal,
    },
}

/// `Stopping`: the visit is closing and admits nothing, but some turn is not yet proven ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CloseVisitReply {
    Closed,
    Stopping,
    Unknown,
}

// --- Conversations ---------------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationArgs {
    pub visit_id: String,
    pub conversation_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadConversationArgs {
    pub visit_id: String,
    pub conversation_id: String,
    pub known_revision: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub conversation_id: String,
    pub updated_at: String,
    pub title: String,
    pub turns: usize,
    pub running: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ListConversationsReply {
    Ok {
        conversations: Vec<ConversationSummary>,
    },
    UnknownVisit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NewConversationRefusal {
    StorageUnavailable,
    ConversationLimit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum NewConversationReply {
    #[serde(rename_all = "camelCase")]
    Created {
        conversation_id: String,
    },
    UnknownVisit,
    Refused {
        reason: NewConversationRefusal,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeleteRefusal {
    Running,
    StorageUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DeleteConversationReply {
    Deleted,
    UnknownVisit,
    UnknownConversation,
    Refused { reason: DeleteRefusal },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentKind {
    PastedText,
    PageSnapshot,
    Extension,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentSummary {
    pub kind: AttachmentKind,
    pub label: String,
    pub bytes: u64,
    pub sha256: String,
}

/// The exact version a change is based on, and the version that was active when the extension was
/// attached (`None`: none was). That last one is the UI's compare-and-set value for activation:
/// stored and returned as given, never guessed, and never sent to the provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevisionBase {
    pub package_id: String,
    pub base_sha256: String,
    #[serde(deserialize_with = "present")]
    pub expected_active_sha256: Option<String>,
}

/// A field that must be present, though it may be `null`; serde would otherwise read a missing
/// `Option` as `None`.
fn present<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

/// Messages are plain prose; `package_text` is untrusted JSON text; `answer` (amendment 5) is
/// untrusted Markdown text, shown only through an inert renderer and never interpreted here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Reply {
    #[serde(rename_all = "camelCase")]
    Candidate {
        message: String,
        package_text: String,
    },
    Question {
        message: String,
        choices: Vec<String>,
    },
    Unsupported {
        message: String,
        alternative: Option<String>,
    },
    Answer {
        message: String,
        answer: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Failure {
    ProviderFailed,
    InvalidOutput,
    OutputTooLarge,
    UsageLimit,
    NotConnected,
    ToolRefused,
    TimedOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StopReason {
    Cancelled,
    VisitClosed,
    AccountChanged,
    AppClosed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Entry {
    #[serde(rename_all = "camelCase")]
    Request {
        turn_id: String,
        at: String,
        provider: ProviderId,
        text: String,
        attachments: Vec<AttachmentSummary>,
        included_turn_ids: Vec<String>,
        revision: Option<RevisionBase>,
        guide: String,
    },
    #[serde(rename_all = "camelCase")]
    Reply {
        turn_id: String,
        at: String,
        reply: Reply,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        turn_id: String,
        at: String,
        reason: Failure,
        resets_at: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Stopped {
        turn_id: String,
        at: String,
        reason: StopReason,
        confirmed: bool,
    },
}

impl Entry {
    pub(crate) fn turn_id(&self) -> &str {
        match self {
            Entry::Request { turn_id, .. }
            | Entry::Reply { turn_id, .. }
            | Entry::Failed { turn_id, .. }
            | Entry::Stopped { turn_id, .. } => turn_id,
        }
    }

    pub(crate) fn is_request(&self) -> bool {
        matches!(self, Entry::Request { .. })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnPhase {
    Sending,
    Working,
    Checking,
    Stopping,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningTurn {
    pub turn_id: String,
    pub phase: TurnPhase,
}

/// Whether what a snapshot shows is in local storage: written and synced, written but the folder
/// sync failed, or held only in memory because the write failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Storage {
    Saved,
    Unconfirmed,
    Unsaved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub conversation_id: String,
    pub revision: u64,
    pub entries: Vec<Entry>,
    pub turn: Option<RunningTurn>,
    pub storage: Storage,
}

/// A local save's result; never a provider call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveConversationReply {
    Saved,
    Unconfirmed,
    Unsaved,
    UnknownVisit,
    UnknownConversation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ReadConversationReply {
    Ok { conversation: Conversation },
    Unchanged { revision: u64 },
    UnknownVisit,
    UnknownConversation,
}

// --- Turns -----------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attachment {
    pub kind: AttachmentKind,
    pub label: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendArgs {
    pub visit_id: String,
    pub conversation_id: String,
    pub turn_id: String,
    pub provider: ProviderId,
    pub request: String,
    pub attachments: Vec<Attachment>,
    pub include_turn_ids: Vec<String>,
    pub revision: Option<RevisionBase>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SendRefusal {
    UnknownVisit,
    UnknownConversation,
    ProviderUnavailable,
    NotConnected,
    Busy,
    Cancelled,
    Replayed,
    TooLarge,
    InvalidRequest,
    ConversationFull,
    StorageUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SendReply {
    #[serde(rename_all = "camelCase")]
    Admitted {
        turn_id: String,
    },
    Refused {
        reason: SendRefusal,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnArgs {
    pub visit_id: String,
    pub conversation_id: String,
    pub turn_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CancelTurnReply {
    Stopped,
    Stopping,
    Finished,
    UnknownVisit,
    UnknownConversation,
}

#[cfg(test)]
mod tests {
    use super::CancelConnectReply;

    /// Amendment 4: only a `status`, and an unproven cancellation is never sent as cancelled.
    #[test]
    fn a_sign_in_cancellation_says_exactly_how_it_ended() {
        let sent = |reply| serde_json::to_value(reply).unwrap();
        assert_eq!(
            sent(CancelConnectReply::Cancelled),
            serde_json::json!({ "status": "cancelled" })
        );
        assert_eq!(
            sent(CancelConnectReply::NotConnecting),
            serde_json::json!({ "status": "notConnecting" })
        );
        assert_eq!(
            sent(CancelConnectReply::Unconfirmed),
            serde_json::json!({ "status": "unconfirmed" })
        );
    }
}
