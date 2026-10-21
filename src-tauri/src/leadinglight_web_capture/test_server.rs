//! Test-only helpers: a loopback HTTP/1.1 server that writes raw bytes, so each test controls
//! framing, stalls and closes exactly, and a table resolver. Real reqwest connections reach the
//! server through the loopback-allowing policy, which exists only under `cfg(test)`.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::{self, Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use futures_util::future::BoxFuture;

use super::fetch::Lookup;
use super::wire::{AttemptId, CancelArgs, FetchArgs};
use super::{AddressPolicy, Limits, WebCapture};

/// Long enough never to fire in a passing test; short enough that nothing hangs forever.
const PATIENCE: Duration = Duration::from_secs(10);

#[derive(Debug, Clone)]
pub(crate) struct Request {
    pub(crate) method: String,
    pub(crate) target: String,
    pub(crate) version: String,
    /// Lowercased names, in the order sent.
    pub(crate) headers: Vec<(String, String)>,
}

impl Request {
    pub(crate) fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(candidate, _)| candidate == name)
            .map(|(_, value)| value.as_str())
    }

    pub(crate) fn header_names(&self) -> Vec<&str> {
        let mut names: Vec<&str> = self.headers.iter().map(|(name, _)| name.as_str()).collect();
        names.sort_unstable();
        names
    }
}

type Handler = dyn Fn(&mut TcpStream) + Send + Sync;

pub(crate) struct Server {
    port: u16,
    connections: Arc<AtomicUsize>,
    requests: Arc<Mutex<Vec<Request>>>,
    stop: Arc<AtomicBool>,
}

impl Server {
    /// Reads and records each connection's request head, then lets `answer` write the response.
    pub(crate) fn http(answer: impl Fn(&Request, &mut TcpStream) + Send + Sync + 'static) -> Self {
        let requests: Arc<Mutex<Vec<Request>>> = Arc::default();
        let recorded = Arc::clone(&requests);
        Self::start(
            Arc::new(move |stream: &mut TcpStream| {
                if let Some(request) = read_request(stream) {
                    lock(&recorded).push(request.clone());
                    answer(&request, stream);
                }
            }),
            requests,
        )
    }

    /// Hands each raw connection to `handle` without reading anything (TLS tests).
    pub(crate) fn raw(handle: impl Fn(&mut TcpStream) + Send + Sync + 'static) -> Self {
        Self::start(Arc::new(handle), Arc::default())
    }

    fn start(handler: Arc<Handler>, requests: Arc<Mutex<Vec<Request>>>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback port");
        listener
            .set_nonblocking(true)
            .expect("non-blocking listener");
        let port = listener.local_addr().expect("local address").port();
        let connections = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let (counted, stopping) = (Arc::clone(&connections), Arc::clone(&stop));
        thread::spawn(move || {
            while !stopping.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        counted.fetch_add(1, Ordering::SeqCst);
                        let handler = Arc::clone(&handler);
                        thread::spawn(move || {
                            // Accepted sockets can inherit the listener's non-blocking mode.
                            let _ = stream.set_nonblocking(false);
                            let _ = stream.set_read_timeout(Some(PATIENCE));
                            handler(&mut stream);
                        });
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            }
        });
        Self {
            port,
            connections,
            requests,
            stop,
        }
    }

    pub(crate) fn port(&self) -> u16 {
        self.port
    }

    pub(crate) fn url(&self, host: &str, path: &str) -> String {
        format!("http://{host}:{}{path}", self.port)
    }

    pub(crate) fn connections(&self) -> usize {
        self.connections.load(Ordering::SeqCst)
    }

    pub(crate) fn requests(&self) -> Vec<Request> {
        lock(&self.requests).clone()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 64 * 1024 || stream.read(&mut byte).ok()? == 0 {
            return None;
        }
        head.push(byte[0]);
    }
    let text = String::from_utf8(head).ok()?;
    let mut lines = text.split("\r\n");
    let mut start = lines.next()?.split(' ');
    let (method, target, version) = (start.next()?, start.next()?, start.next()?);
    let headers = lines
        .filter(|line| !line.is_empty())
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_owned()))
        .collect();
    Some(Request {
        method: method.to_owned(),
        target: target.to_owned(),
        version: version.to_owned(),
        headers,
    })
}

/// Writes a complete response with `Content-Length` (unless framing is given) and
/// `Connection: close`. Write errors are ignored: some tests expect the client to be gone.
pub(crate) fn respond(stream: &mut TcpStream, status: u16, headers: &[(&str, &str)], body: &[u8]) {
    let framed = headers.iter().any(|(name, _)| {
        name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("transfer-encoding")
    });
    let mut head = format!("HTTP/1.1 {status} Status\r\nConnection: close\r\n");
    for (name, value) in headers {
        let _ = write!(head, "{name}: {value}\r\n");
    }
    if !framed {
        let _ = write!(head, "Content-Length: {}\r\n", body.len());
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

pub(crate) fn html(stream: &mut TcpStream, body: &str) {
    respond(
        stream,
        200,
        &[("Content-Type", "text/html; charset=utf-8")],
        body.as_bytes(),
    );
}

pub(crate) fn write_raw(stream: &mut TcpStream, bytes: &[u8]) -> bool {
    stream
        .write_all(bytes)
        .and_then(|()| stream.flush())
        .is_ok()
}

/// True once the client closes or resets the connection. The client sends nothing after its
/// request, so any end of input means it let go.
pub(crate) fn wait_closed(stream: &mut TcpStream, within: Duration) -> bool {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(50)));
    let deadline = Instant::now() + within;
    let mut buffer = [0u8; 4096];
    while Instant::now() < deadline {
        match stream.read(&mut buffer) {
            Ok(0) => return true,
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock
                        | io::ErrorKind::TimedOut
                        | io::ErrorKind::Interrupted
                ) => {}
            Err(_) => return true,
        }
    }
    false
}

/// Blocks a server thread until `flag` is set, or gives up after `PATIENCE`.
pub(crate) fn wait_for_flag(flag: &AtomicBool) -> bool {
    let deadline = Instant::now() + PATIENCE;
    while Instant::now() < deadline {
        if flag.load(Ordering::SeqCst) {
            return true;
        }
        thread::sleep(Duration::from_millis(5));
    }
    false
}

/// Awaits a condition another thread makes true, failing the test after `PATIENCE`.
pub(crate) async fn until(what: &str, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + PATIENCE;
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// One TLS ClientHello record, read whole.
pub(crate) fn read_client_hello(stream: &mut TcpStream) -> Option<Vec<u8>> {
    let mut header = [0u8; 5];
    stream.read_exact(&mut header).ok()?;
    let length = usize::from(u16::from_be_bytes([header[3], header[4]]));
    let mut record = vec![0u8; length];
    stream.read_exact(&mut record).ok()?;
    (header[0] == 0x16).then_some(record)
}

/// The host name in a ClientHello's server_name extension (RFC 6066), if any.
pub(crate) fn server_name(record: &[u8]) -> Option<String> {
    let mut reader = Bytes(record);
    if reader.take(1)?[0] != 0x01 {
        return None;
    }
    reader.take(3)?; // handshake length
    reader.take(2 + 32)?; // legacy version, random
    reader.skip_u8_prefixed()?; // session id
    reader.skip_u16_prefixed()?; // cipher suites
    reader.skip_u8_prefixed()?; // compression methods
    let mut extensions = Bytes(reader.u16_prefixed()?);
    while !extensions.0.is_empty() {
        let kind = extensions.u16()?;
        let data = extensions.u16_prefixed()?;
        if kind != 0 {
            continue;
        }
        let mut list = Bytes(Bytes(data).u16_prefixed()?);
        while !list.0.is_empty() {
            let name_type = list.take(1)?[0];
            let name = list.u16_prefixed()?;
            if name_type == 0 {
                return String::from_utf8(name.to_vec()).ok();
            }
        }
    }
    None
}

struct Bytes<'a>(&'a [u8]);

impl<'a> Bytes<'a> {
    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        if self.0.len() < count {
            return None;
        }
        let (taken, rest) = self.0.split_at(count);
        self.0 = rest;
        Some(taken)
    }

    fn u16(&mut self) -> Option<u16> {
        let bytes = self.take(2)?;
        Some(u16::from_be_bytes([bytes[0], bytes[1]]))
    }

    fn u16_prefixed(&mut self) -> Option<&'a [u8]> {
        let length = usize::from(self.u16()?);
        self.take(length)
    }

    fn skip_u8_prefixed(&mut self) -> Option<()> {
        let length = usize::from(self.take(1)?[0]);
        self.take(length).map(|_| ())
    }

    fn skip_u16_prefixed(&mut self) -> Option<()> {
        self.u16_prefixed().map(|_| ())
    }
}

/// What the table answers for one name.
pub(crate) enum Answer {
    Addresses(Vec<IpAddr>),
    Fails,
    Stalls,
}

/// A resolver that answers from a table and records every question.
#[derive(Default)]
pub(crate) struct Table {
    answers: HashMap<String, Answer>,
    asked: Mutex<Vec<(String, u16)>>,
}

impl Table {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn with(mut self, host: &str, addresses: &[&str]) -> Self {
        let addresses = addresses
            .iter()
            .map(|address| address.parse().expect("an IP address"))
            .collect();
        self.answers
            .insert(host.to_owned(), Answer::Addresses(addresses));
        self
    }

    pub(crate) fn answering(mut self, host: &str, answer: Answer) -> Self {
        self.answers.insert(host.to_owned(), answer);
        self
    }

    pub(crate) fn asked(&self) -> Vec<(String, u16)> {
        lock(&self.asked).clone()
    }
}

impl Lookup for Table {
    fn lookup<'a>(&'a self, host: &'a str, port: u16) -> BoxFuture<'a, io::Result<Vec<IpAddr>>> {
        lock(&self.asked).push((host.to_owned(), port));
        match self.answers.get(host) {
            Some(Answer::Addresses(addresses)) => {
                Box::pin(std::future::ready(Ok::<_, io::Error>(addresses.clone())))
            }
            Some(Answer::Stalls) => Box::pin(std::future::pending::<io::Result<Vec<IpAddr>>>()),
            Some(Answer::Fails) | None => Box::pin(std::future::ready(Err::<Vec<IpAddr>, _>(
                io::Error::new(io::ErrorKind::NotFound, "no such host in the table"),
            ))),
        }
    }
}

/// Generous limits for tests that are not about limits.
pub(crate) fn test_limits() -> Limits {
    Limits {
        dns: Duration::from_secs(2),
        connect: Duration::from_secs(2),
        read_idle: Duration::from_secs(4),
        total: Duration::from_secs(8),
        redirects: 5,
        body_bytes: 64 * 1024,
        html_bytes: 64 * 1024,
    }
}

/// A capture that may also reach the loopback test server, answering names from `table`.
pub(crate) fn loopback_capture(table: &Arc<Table>, limits: Limits) -> WebCapture {
    let lookup: Arc<Table> = Arc::clone(table);
    WebCapture::for_tests(AddressPolicy::PublicOrLoopback, lookup, limits)
}

pub(crate) fn attempt(number: u8) -> AttemptId {
    let id = format!("00000000-0000-4000-8000-0000000000{number:02x}");
    AttemptId::try_from(id).expect("a canonical UUID")
}

pub(crate) fn fetch_args(number: u8, url: &str) -> FetchArgs {
    FetchArgs {
        attempt_id: attempt(number),
        url: url.to_owned(),
    }
}

pub(crate) fn cancel_args(number: u8) -> CancelArgs {
    CancelArgs {
        attempt_id: attempt(number),
    }
}
