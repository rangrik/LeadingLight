//! The app-server's line-delimited JSON-RPC, over any pair of streams.
//!
//! Reading and writing each happen on a thread of their own, so neither can hold the caller past
//! its deadline: a provider that stops reading its input makes a send fail at its bound (or at
//! once when cancelled), and the caller can still kill and reap it, which ends the writing thread
//! too. Lines and the whole input are bounded; past either bound the connection reports an overflow
//! and reads no more.

use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use super::controls;

pub(crate) const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_STREAM_BYTES: usize = 64 * 1024 * 1024;
/// How long one message may take to be taken in by the provider before the send fails.
pub(crate) const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
/// A refusal is a few bytes; a provider that does not take it in quickly is not waited for.
const REPLY_TIMEOUT: Duration = Duration::from_secs(1);
const WRITE_TICK: Duration = Duration::from_millis(20);

/// One message from the provider, as far as the client needs to tell them apart.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Inbound {
    Response {
        id: i64,
        result: Value,
    },
    Error {
        id: i64,
    },
    Notification {
        method: String,
        params: Value,
    },
    /// The provider asks the client for something; Adapt never grants anything.
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Malformed,
    Overflow,
    Closed,
}

fn classify(line: &[u8]) -> Inbound {
    let Ok(Value::Object(object)) = serde_json::from_slice::<Value>(line) else {
        return Inbound::Malformed;
    };
    let method = object.get("method").and_then(Value::as_str);
    let params = || object.get("params").cloned().unwrap_or(Value::Null);
    match (method, object.get("id")) {
        (Some(method), Some(id)) => Inbound::Request {
            id: id.clone(),
            method: method.to_string(),
            params: params(),
        },
        (Some(method), None) => Inbound::Notification {
            method: method.to_string(),
            params: params(),
        },
        (None, Some(id)) => response(&object, id),
        (None, None) => Inbound::Malformed,
    }
}

fn response(object: &Map<String, Value>, id: &Value) -> Inbound {
    let Some(id) = id.as_i64() else {
        return Inbound::Malformed;
    };
    match (object.get("result"), object.contains_key("error")) {
        (Some(result), false) => Inbound::Response {
            id,
            result: result.clone(),
        },
        (None, true) => Inbound::Error { id },
        _ => Inbound::Malformed,
    }
}

/// Reads lines on a thread of its own until the stream ends, a bound is passed, or nobody listens.
fn read_lines(reader: impl Read + Send + 'static) -> Receiver<Inbound> {
    let (sender, receiver) = mpsc::channel();
    let spawned = std::thread::Builder::new()
        .name("leadinglight-adapt-rpc".to_string())
        .spawn(move || {
            let ending = split_lines(reader, |message| sender.send(message).is_ok());
            let _ = sender.send(ending);
        });
    if spawned.is_err() {
        let (sender, closed) = mpsc::channel();
        let _ = sender.send(Inbound::Closed);
        return closed;
    }
    receiver
}

/// Hands each complete line to `deliver` and answers how reading ended.
fn split_lines(mut reader: impl Read, mut deliver: impl FnMut(Inbound) -> bool) -> Inbound {
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = vec![0_u8; 64 * 1024];
    let mut total = 0_usize;
    loop {
        let read = match reader.read(&mut chunk) {
            Ok(0) => return Inbound::Closed,
            Ok(read) => read,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => return Inbound::Closed,
        };
        total += read;
        if total > MAX_STREAM_BYTES {
            return Inbound::Overflow;
        }
        let mut start = pending.len();
        pending.extend_from_slice(&chunk[..read]);
        while let Some(offset) = pending[start..].iter().position(|byte| *byte == b'\n') {
            let end = start + offset;
            let line = &pending[..end];
            if !line.iter().all(u8::is_ascii_whitespace) && !deliver(classify(line)) {
                return Inbound::Closed;
            }
            pending.drain(..=end);
            start = 0;
        }
        if pending.len() > MAX_LINE_BYTES {
            return Inbound::Overflow;
        }
    }
}

/// Writes each line handed to it, in order, and reports each result. It ends when the connection
/// drops its sender, or at the first failed write: a provider that was killed closes its input, so
/// a write blocked on it fails then.
fn write_lines(
    mut writer: Box<dyn Write + Send>,
    lines: Receiver<Vec<u8>>,
    written: Sender<std::io::Result<()>>,
    done: Arc<AtomicBool>,
) {
    for line in lines {
        let result = writer.write_all(&line).and_then(|()| writer.flush());
        let failed = result.is_err();
        if written.send(result).is_err() || failed {
            break;
        }
    }
    drop(writer);
    done.store(true, Ordering::SeqCst);
}

fn never() -> bool {
    false
}

pub(crate) struct Connection {
    lines: Option<Sender<Vec<u8>>>,
    written: Receiver<std::io::Result<()>>,
    /// A send did not complete: nothing more is written, and the provider is to be killed.
    stalled: bool,
    #[cfg(test)]
    writer_done: Arc<AtomicBool>,
    inbound: Receiver<Inbound>,
    next_id: i64,
    ended: bool,
}

impl Connection {
    pub(crate) fn new(
        reader: impl Read + Send + 'static,
        writer: impl Write + Send + 'static,
    ) -> Self {
        let (lines, queued) = mpsc::channel::<Vec<u8>>();
        let (results, written) = mpsc::channel();
        let writer_done = Arc::new(AtomicBool::new(false));
        let done = Arc::clone(&writer_done);
        let writer: Box<dyn Write + Send> = Box::new(writer);
        let spawned = std::thread::Builder::new()
            .name("leadinglight-adapt-rpc-write".to_string())
            .spawn(move || write_lines(writer, queued, results, done));
        let lines = match spawned {
            Ok(_) => Some(lines),
            Err(_) => {
                writer_done.store(true, Ordering::SeqCst);
                None
            }
        };
        Self {
            lines,
            written,
            stalled: false,
            #[cfg(test)]
            writer_done,
            inbound: read_lines(reader),
            next_id: 0,
            ended: false,
        }
    }

    /// Hands one message to the writing thread and waits until it is written, the deadline passes
    /// or `cancelled` says so. A send already cancelled or past its deadline is refused before
    /// anything is handed over, so no frame is written. Once handed over, anything but a completed
    /// write stalls the connection for good.
    fn send(
        &mut self,
        message: &Value,
        deadline: Instant,
        cancelled: &dyn Fn() -> bool,
    ) -> std::io::Result<()> {
        let refused =
            |kind: ErrorKind, text: &str| Err(std::io::Error::new(kind, text.to_string()));
        if self.stalled {
            return refused(ErrorKind::BrokenPipe, "the provider stopped taking input");
        }
        if cancelled() {
            return refused(ErrorKind::Interrupted, "the send was cancelled");
        }
        if Instant::now() >= deadline {
            return refused(ErrorKind::TimedOut, "the send's deadline had passed");
        }
        let mut line = serde_json::to_vec(message).map_err(std::io::Error::other)?;
        line.push(b'\n');
        let queued = self
            .lines
            .as_ref()
            .is_some_and(|lines| lines.send(line).is_ok());
        if !queued {
            self.stalled = true;
            return refused(ErrorKind::BrokenPipe, "the provider's input is closed");
        }
        loop {
            let wait = deadline
                .saturating_duration_since(Instant::now())
                .min(WRITE_TICK);
            match self.written.recv_timeout(wait) {
                Ok(result) => {
                    self.stalled |= result.is_err();
                    return result;
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.stalled = true;
                    return refused(ErrorKind::BrokenPipe, "the provider's input is closed");
                }
                Err(RecvTimeoutError::Timeout) => {
                    if cancelled() {
                        self.stalled = true;
                        return refused(ErrorKind::Interrupted, "the send was cancelled");
                    }
                    if Instant::now() >= deadline {
                        self.stalled = true;
                        return refused(ErrorKind::TimedOut, "the provider did not take its input");
                    }
                }
            }
        }
    }

    /// A request, written within `deadline` unless `cancelled`. A `null` `params` is left out, for
    /// methods that take none.
    pub(crate) fn request_within(
        &mut self,
        method: &str,
        params: Value,
        deadline: Instant,
        cancelled: &dyn Fn() -> bool,
    ) -> std::io::Result<i64> {
        self.next_id += 1;
        let id = self.next_id;
        let mut message = json!({ "id": id, "method": method });
        if !params.is_null() {
            message["params"] = params;
        }
        self.send(&message, deadline, cancelled)?;
        Ok(id)
    }

    /// A request, written within `WRITE_TIMEOUT`.
    pub(crate) fn request(&mut self, method: &str, params: Value) -> std::io::Result<i64> {
        self.request_within(method, params, Instant::now() + WRITE_TIMEOUT, &never)
    }

    pub(crate) fn notify(&mut self, method: &str) -> std::io::Result<()> {
        self.send(
            &json!({ "method": method }),
            Instant::now() + WRITE_TIMEOUT,
            &never,
        )
    }

    /// Answers a provider request with its schema's own refusal (`decline`, `denied`), or with an
    /// error where the schema has none. Nothing is ever approved, answered, run or provided.
    pub(crate) fn refuse(&mut self, id: &Value, method: &str) -> std::io::Result<()> {
        let message = match controls::refusal(method) {
            Some(result) => json!({ "id": id, "result": result }),
            None => json!({
                "id": id,
                "error": { "code": -32601, "message": "LeadingLight does not allow this." }
            }),
        };
        self.send(&message, Instant::now() + REPLY_TIMEOUT, &never)
    }

    /// The next message, `None` if none came within `timeout`. Once the stream has ended, always
    /// `Closed` (or the overflow that ended it, once).
    pub(crate) fn next(&mut self, timeout: Duration) -> Option<Inbound> {
        if self.ended {
            return Some(Inbound::Closed);
        }
        match self.inbound.recv_timeout(timeout) {
            Ok(message) => {
                if matches!(message, Inbound::Closed | Inbound::Overflow) {
                    self.ended = true;
                }
                Some(message)
            }
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => {
                self.ended = true;
                Some(Inbound::Closed)
            }
        }
    }

    /// Whether the writing thread has ended. It ends once the connection is dropped and its last
    /// write has completed or failed.
    #[cfg(test)]
    pub(crate) fn writer_done(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.writer_done)
    }
}
