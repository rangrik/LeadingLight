//! Website capture, native fetch: fetches the one public web page a person asked for, and
//! nothing else.
//!
//! `docs/leadinglight/web-capture-native.md` explains the address policy, pinning, limits,
//! cancellation, decoding and what the tests do and do not qualify. A fetch takes only a URL and
//! the calling window; no note, vault path, provider or package identity reaches it. There are no
//! cookies, credentials, proxies, retries, background fetches or caches. Replies and logs never
//! contain server text, and nothing here logs a URL.
//!
//! The app reaches it only through `commands/web_capture.rs`. The module is self-contained (it
//! names no other crate module), so `tests/web_capture_leaf.rs` also compiles and tests it alone.

mod address;
mod decode;
mod fetch;
mod service;
pub(crate) mod wire;

#[cfg(test)]
mod address_tests;
#[cfg(test)]
mod decode_tests;
#[cfg(test)]
mod fetch_tests;
#[cfg(test)]
mod service_tests;
#[cfg(test)]
pub(crate) mod test_server;

#[cfg(test)]
pub(crate) use address::AddressPolicy;
#[cfg(test)]
pub(crate) use fetch::Limits;
pub(crate) use service::WebCapture;
