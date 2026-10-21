//! One capture attempt: gate the URL, resolve and check every answer, pin the connection to those
//! answers, request with fixed headers, follow redirects by hand, then read and decode a bounded
//! body. Transport errors become fixed reasons; their text, which can hold the URL, is dropped.

use std::error::Error as _;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use futures_util::future::BoxFuture;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::header::{
    HeaderMap, HeaderName, ACCEPT, ACCEPT_ENCODING, CONTENT_ENCODING, CONTENT_TYPE, LOCATION,
    TRANSFER_ENCODING,
};
use reqwest::{redirect, Client, Response, StatusCode, Url};

use super::address::{self, AddressPolicy, Target};
use super::decode::{self, Decoded};
use super::wire::{ContentType, FailureReason};

const USER_AGENT: &str = concat!("LeadingLight/", env!("CARGO_PKG_VERSION"));
const ACCEPT_HTML: &str = "text/html,application/xhtml+xml";

/// Bounds for one attempt. Tests shorten them; production uses `PRODUCTION`.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Limits {
    /// One lookup, per hop.
    pub(crate) dns: Duration,
    /// TCP connect and TLS handshake, per hop.
    pub(crate) connect: Duration,
    /// From sending a request to its response head, then between body reads.
    pub(crate) read_idle: Duration,
    /// The whole attempt: every hop, lookup and body read.
    pub(crate) total: Duration,
    pub(crate) redirects: usize,
    pub(crate) body_bytes: usize,
    /// UTF-8 bytes of the decoded page.
    pub(crate) html_bytes: usize,
}

impl Limits {
    pub(crate) const PRODUCTION: Limits = Limits {
        dns: Duration::from_secs(5),
        connect: Duration::from_secs(5),
        read_idle: Duration::from_secs(10),
        total: Duration::from_secs(30),
        redirects: 5,
        body_bytes: 5 * 1024 * 1024,
        html_bytes: 5 * 1024 * 1024,
    };
}

/// Host name lookup. Production asks the operating system; tests answer from a table.
pub(crate) trait Lookup: Send + Sync {
    fn lookup<'a>(&'a self, host: &'a str, port: u16) -> BoxFuture<'a, io::Result<Vec<IpAddr>>>;
}

pub(super) struct SystemLookup;

impl Lookup for SystemLookup {
    fn lookup<'a>(&'a self, host: &'a str, port: u16) -> BoxFuture<'a, io::Result<Vec<IpAddr>>> {
        Box::pin(async move {
            let answers = tokio::net::lookup_host((host, port)).await?;
            Ok::<_, io::Error>(answers.map(|answer| answer.ip()).collect::<Vec<_>>())
        })
    }
}

/// reqwest's resolver for one hop: the checked answers for exactly that host, and a refusal for
/// any other name, so no connection can use an unchecked answer. The URL keeps the host name, so
/// `Host` and TLS server name stay the host while the connection goes to a checked address.
#[derive(Default)]
struct Pinned {
    host: String,
    addresses: Vec<SocketAddr>,
}

impl Resolve for Pinned {
    fn resolve(&self, name: Name) -> Resolving {
        let answer: Result<Addrs, Box<dyn std::error::Error + Send + Sync>> =
            if name.as_str() == self.host {
                Ok(Box::new(self.addresses.clone().into_iter()))
            } else {
                Err("this name was not checked".into())
            };
        Box::pin(std::future::ready(answer))
    }
}

/// A fetched page, not yet tied to its attempt.
#[derive(Debug)]
pub(super) struct Page {
    pub(super) requested_url: Url,
    pub(super) final_url: Url,
    pub(super) content_type: ContentType,
    pub(super) decoded: Decoded,
}

pub(super) struct Fetcher {
    pub(super) policy: AddressPolicy,
    pub(super) lookup: Arc<dyn Lookup>,
    pub(super) limits: Limits,
}

impl Fetcher {
    pub(super) async fn fetch(&self, input: &str) -> Result<Page, FailureReason> {
        let (requested_url, target) = address::parse_request(input, self.policy)?;
        tokio::time::timeout(self.limits.total, self.follow(requested_url, target))
            .await
            .unwrap_or(Err(FailureReason::TimedOut))
    }

    async fn follow(&self, requested_url: Url, target: Target) -> Result<Page, FailureReason> {
        let (mut url, mut target) = (requested_url.clone(), target);
        let mut redirects = 0;
        loop {
            let response = self.request(&url, &target).await?;
            let status = response.status();
            if !is_redirect(status) {
                if status != StatusCode::OK {
                    return Err(refused_status(status));
                }
                return self.read(response, requested_url, url).await;
            }
            if redirects == self.limits.redirects {
                return Err(FailureReason::TooManyRedirects);
            }
            redirects += 1;
            let location = response
                .headers()
                .get(LOCATION)
                .map(|value| value.as_bytes());
            (url, target) = address::redirect_target(&url, location, self.policy)?;
            // The redirect's own connection closes as `response` drops here.
        }
    }

    async fn request(&self, url: &Url, target: &Target) -> Result<Response, FailureReason> {
        let pinned = match target {
            // reqwest connects to an address literal directly and never asks the resolver.
            Target::Address(_) => Pinned::default(),
            Target::Name(host) => {
                let port = url
                    .port_or_known_default()
                    .ok_or(FailureReason::InvalidUrl)?;
                Pinned {
                    host: host.clone(),
                    addresses: self.resolve(host, port).await?,
                }
            }
        };
        self.client(pinned)?
            .get(url.clone())
            .header(ACCEPT, ACCEPT_HTML)
            .header(ACCEPT_ENCODING, "identity")
            .send()
            .await
            .map_err(|error| transport_failure(&error))
    }

    /// Every answer must be allowed, not merely the first: a connection may try any of them.
    async fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>, FailureReason> {
        let answers = tokio::time::timeout(self.limits.dns, self.lookup.lookup(host, port))
            .await
            .map_err(|_| FailureReason::TimedOut)?
            .map_err(|_| FailureReason::DnsFailed)?;
        if answers.is_empty() {
            return Err(FailureReason::DnsFailed);
        }
        if !answers.iter().all(|answer| self.policy.allows(*answer)) {
            return Err(FailureReason::NotPublicAddress);
        }
        let mut addresses: Vec<SocketAddr> = Vec::with_capacity(answers.len());
        for answer in answers {
            let address = SocketAddr::new(answer, port);
            if !addresses.contains(&address) {
                addresses.push(address);
            }
        }
        Ok(addresses)
    }

    /// A new client per hop: rustls with bundled roots, no proxy (an environment or system proxy
    /// would bypass the pin), no redirects, Referer, cookies, decompression or idle connections.
    fn client(&self, pinned: Pinned) -> Result<Client, FailureReason> {
        Client::builder()
            .use_rustls_tls()
            .no_proxy()
            .redirect(redirect::Policy::none())
            .referer(false)
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .http1_only()
            .pool_max_idle_per_host(0)
            .user_agent(USER_AGENT)
            .connect_timeout(self.limits.connect)
            .read_timeout(self.limits.read_idle)
            .dns_resolver(Arc::new(pinned))
            .build()
            .map_err(|_| FailureReason::NetworkError)
    }

    async fn read(
        &self,
        mut response: Response,
        requested_url: Url,
        final_url: Url,
    ) -> Result<Page, FailureReason> {
        if !uses_only_identity(response.headers()) {
            return Err(FailureReason::CompressedResponse);
        }
        let declared = response
            .headers()
            .get(CONTENT_TYPE)
            .map(|value| decode::media_type(value.as_bytes()).ok_or(FailureReason::NotHtml))
            .transpose()?;
        let declared_type = declared
            .as_ref()
            .map(|media| html_type(&media.essence).ok_or(FailureReason::NotHtml))
            .transpose()?;
        let body_limit = self.limits.body_bytes as u64;
        if response
            .content_length()
            .is_some_and(|length| length > body_limit)
        {
            return Err(FailureReason::TooLarge);
        }
        let body = self.body(&mut response).await?;
        let content_type = match declared_type {
            Some(content_type) => content_type,
            None if decode::looks_like_html(&body) => ContentType::Html,
            None => return Err(FailureReason::NotHtml),
        };
        let charset = declared.and_then(|media| media.charset);
        let decoded = decode::decode(&body, charset.as_deref())?;
        if decoded.html.len() > self.limits.html_bytes {
            return Err(FailureReason::TooLarge);
        }
        Ok(Page {
            requested_url,
            final_url,
            content_type,
            decoded,
        })
    }

    /// Reads no further than one chunk past the limit, then drops the connection.
    async fn body(&self, response: &mut Response) -> Result<Vec<u8>, FailureReason> {
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| transport_failure(&error))?
        {
            if body.len() + chunk.len() > self.limits.body_bytes {
                return Err(FailureReason::TooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }
}

fn is_redirect(status: StatusCode) -> bool {
    matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308)
}

fn refused_status(status: StatusCode) -> FailureReason {
    match status.as_u16() {
        401 | 402 | 403 | 451 => FailureReason::AccessDenied,
        404 | 410 => FailureReason::NotFound,
        429 => FailureReason::RateLimited,
        500..=599 => FailureReason::ServerError,
        _ => FailureReason::UnexpectedStatus,
    }
}

fn html_type(essence: &str) -> Option<ContentType> {
    match essence {
        "text/html" => Some(ContentType::Html),
        "application/xhtml+xml" => Some(ContentType::Xhtml),
        _ => None,
    }
}

/// Identity content and plain or chunked framing only; anything else would hand back encoded
/// bytes, since this client asked for `identity` and decompresses nothing.
fn uses_only_identity(headers: &HeaderMap) -> bool {
    let codings = |name: HeaderName| -> Vec<Vec<u8>> {
        headers
            .get_all(name)
            .iter()
            .flat_map(|value| value.as_bytes().split(|byte| *byte == b','))
            .map(|coding| coding.trim_ascii().to_ascii_lowercase())
            .filter(|coding| !coding.is_empty())
            .collect()
    };
    codings(CONTENT_ENCODING)
        .iter()
        .all(|coding| coding == b"identity")
        && codings(TRANSFER_ENCODING)
            .iter()
            .all(|coding| coding == b"identity" || coding == b"chunked")
}

fn transport_failure(error: &reqwest::Error) -> FailureReason {
    if error.is_timeout() {
        FailureReason::TimedOut
    } else if error.is_connect() {
        // rustls handshake and certificate errors surface as `InvalidData`; TCP errors never do.
        if has_io_kind(error, io::ErrorKind::InvalidData) {
            FailureReason::TlsFailed
        } else {
            FailureReason::ConnectFailed
        }
    } else {
        FailureReason::NetworkError
    }
}

fn has_io_kind(error: &reqwest::Error, kind: io::ErrorKind) -> bool {
    let mut next = error.source();
    while let Some(cause) = next {
        if let Some(io_error) = cause.downcast_ref::<io::Error>() {
            if io_error.kind() == kind {
                return true;
            }
            // `io::Error::source` skips the error it wraps, so step into it explicitly.
            if let Some(inner) = io_error.get_ref() {
                next = Some(inner);
                continue;
            }
        }
        next = cause.source();
    }
    false
}
