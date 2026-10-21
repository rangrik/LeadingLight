//! Request and reply shapes, exactly as frozen in the website capture native contract and mirrored
//! by `src/leadinglight/webCapture/webCaptureContract.ts`. Arguments are read strictly: an unknown
//! or missing field, or an attempt id that is not a canonical UUID, is an unreadable argument.
//! Replies carry fixed values only, never server text, header values or addresses.

use serde::{Deserialize, Serialize};

/// A canonical lowercase hyphenated UUID the caller chose for one attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct AttemptId(String);

impl TryFrom<String> for AttemptId {
    type Error = &'static str;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let canonical =
            uuid::Uuid::parse_str(&value).is_ok_and(|uuid| uuid.hyphenated().to_string() == value);
        if canonical {
            Ok(Self(value))
        } else {
            Err("attemptId must be a canonical lowercase UUID")
        }
    }
}

impl From<AttemptId> for String {
    fn from(id: AttemptId) -> Self {
        id.0
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FetchArgs {
    pub attempt_id: AttemptId,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelArgs {
    pub attempt_id: AttemptId,
}

/// The closed list of reasons an attempt fails. Each is decided natively from fixed facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureReason {
    InvalidUrl,
    UnsupportedScheme,
    CredentialsInUrl,
    NotPublicAddress,
    DnsFailed,
    ConnectFailed,
    TlsFailed,
    TimedOut,
    NetworkError,
    TooManyRedirects,
    InsecureRedirect,
    InvalidRedirect,
    AccessDenied,
    NotFound,
    RateLimited,
    ServerError,
    UnexpectedStatus,
    NotHtml,
    CompressedResponse,
    TooLarge,
    UnsupportedCharset,
}

/// The MIME essence of the page; a missing `Content-Type` is `Html` only after the sniff.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ContentType {
    #[serde(rename = "text/html")]
    Html,
    #[serde(rename = "application/xhtml+xml")]
    Xhtml,
}

/// Where the encoding came from. `Fallback` is a guess, and is reported as one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EncodingSource {
    Bom,
    Header,
    Meta,
    Detected,
    Fallback,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum FetchReply {
    #[serde(rename_all = "camelCase")]
    Fetched {
        attempt_id: AttemptId,
        requested_url: String,
        final_url: String,
        fetched_at: String,
        content_type: ContentType,
        encoding: &'static str,
        encoding_source: EncodingSource,
        html: String,
        had_replacements: bool,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        attempt_id: AttemptId,
        reason: FailureReason,
    },
    #[serde(rename_all = "camelCase")]
    Cancelled { attempt_id: AttemptId },
}

/// `Cancelled`: that attempt was running in this window and is stopped; its fetch replies
/// `cancelled`. `NotActive`: no fetch with that id is live in this window, but the id is still
/// recorded as revoked for the window's current page, so a fetch with it dispatched later does not
/// run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CancelReply {
    #[serde(rename_all = "camelCase")]
    Cancelled { attempt_id: AttemptId },
    #[serde(rename_all = "camelCase")]
    NotActive { attempt_id: AttemptId },
}
