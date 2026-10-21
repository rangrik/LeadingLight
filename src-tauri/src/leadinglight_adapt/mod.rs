//! Adapt: a local chat that asks a provider for an E1 extension package, and nothing else.
//!
//! The frozen contract is `src/leadinglight/adapt/adaptContract.ts`;
//! `docs/leadinglight/adapt-native.md` explains lifetimes, limits, what is sent and what is not
//! proven yet. Native never reads a note for Adapt, never imports, activates or edits anything,
//! and sends only the text a Send names. The vault path scopes local storage and never reaches a
//! provider. Codex is the only provider, and is used only in a qualified version; Claude is
//! reported unavailable. There is no other provider and no paid fallback.

mod check;
mod codex;
mod host;
mod prompt;
mod provider;
mod store;
pub(crate) mod wire;

#[cfg(all(test, unix))]
mod codex_tests;
#[cfg(all(test, unix))]
mod host_tests;
#[cfg(test)]
mod prompt_tests;
#[cfg(all(test, unix))]
mod store_tests;

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use chrono::SecondsFormat;

pub(crate) use host::Host;

/// Now, as the contract's ISO 8601 UTC instant.
pub(crate) fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub(crate) fn instant_from_unix(seconds: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(seconds, 0)
        .map(|at| at.to_rfc3339_opts(SecondsFormat::Secs, true))
}

/// `YYYY-MM-DDTHH:MM:SS[.fraction]Z` and a real instant, as the contract reader requires.
pub(crate) fn is_instant(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() < 20 || bytes.last() != Some(&b'Z') {
        return false;
    }
    let digits = |from: usize, to: usize| bytes[from..to].iter().all(u8::is_ascii_digit);
    let shaped = digits(0, 4)
        && bytes[4] == b'-'
        && digits(5, 7)
        && bytes[7] == b'-'
        && digits(8, 10)
        && bytes[10] == b'T'
        && digits(11, 13)
        && bytes[13] == b':'
        && digits(14, 16)
        && bytes[16] == b':'
        && digits(17, 19);
    let fraction = &bytes[19..bytes.len() - 1];
    let fraction_fits = fraction.is_empty()
        || (fraction[0] == b'.'
            && (2..=10).contains(&fraction.len())
            && fraction[1..].iter().all(u8::is_ascii_digit));
    shaped && fraction_fits && chrono::DateTime::parse_from_rfc3339(text).is_ok()
}

pub(crate) fn hex_sha256(bytes: &[u8]) -> String {
    crate::vault::staged_file::sha256(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The app's Adapt host, created on first use so a missing app-data folder never affects startup.
#[derive(Default)]
pub(crate) struct AdaptState(OnceLock<Result<Arc<Host>, String>>);

impl AdaptState {
    pub(crate) fn get(&self) -> Result<Arc<Host>, String> {
        self.0
            .get_or_init(|| {
                default_root().map(|root| {
                    let provider_home = root.join("provider").join("codex");
                    let provider = codex::CodexProvider(Arc::new(codex::Codex::new(provider_home)));
                    Arc::new(Host::new(root, Box::new(provider)))
                })
            })
            .clone()
    }

    /// Only if Adapt was used in this process; nothing is created for this.
    pub(crate) fn forget_owner(&self, owner: &str) {
        if let Some(Ok(host)) = self.0.get() {
            host.forget_owner(owner);
        }
    }

    /// The app is quitting: running turns stop and any sign-in in progress ends.
    pub(crate) fn shutdown(&self) {
        if let Some(Ok(host)) = self.0.get() {
            host.shutdown();
        }
    }
}

/// `adapt/` beside the app's settings, in the same local configuration namespace.
fn default_root() -> Result<PathBuf, String> {
    let settings = crate::app_config::preferred_app_config_path("settings.json")?;
    settings
        .parent()
        .map(|folder| folder.join("adapt"))
        .ok_or_else(|| "The local configuration folder could not be found".to_string())
}

/// A page load in a window ends that window's visits, even when its own close reply is lost.
pub(crate) fn on_page_load(
    webview: &tauri::Webview,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    use tauri::Manager;

    if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
        webview.state::<AdaptState>().forget_owner(webview.label());
    }
}
