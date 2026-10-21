//! A loopback stand-in for the Responses API, for the offline qualification only.
//!
//! It listens on 127.0.0.1, answers `POST …/responses` with server-sent events chosen by a plan,
//! and records every request. It is also the provider process's HTTP(S) proxy: anything sent
//! through it (a CONNECT or an absolute URL) is an external request, refused and recorded. It
//! accepts only the dummy key below; no real credential exists anywhere in the qualification.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

pub(crate) const DUMMY_TOKEN: &str = "ll-dummy-loopback-token";
pub(crate) const TOKEN_ENV: &str = "LL_FAKE_PROVIDER_TOKEN";
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;
const KEEPALIVE: Duration = Duration::from_millis(200);

/// What the fixture answers one request with.
pub(crate) enum Answer {
    /// A complete event stream.
    Events(Vec<Value>),
    /// These events, then the stream held open until `release` or the limit, whichever is first.
    Hold(Vec<Value>, Duration),
}

/// One request the fixture received.
#[derive(Debug, Clone)]
pub(crate) struct Received {
    pub(crate) method: String,
    pub(crate) path: String,
    pub(crate) dummy_auth: bool,
    pub(crate) body: Value,
    /// The raw body text, for searching.
    pub(crate) text: String,
    /// The plan's label for the answer.
    pub(crate) answer: String,
}

pub(crate) type Plan = dyn Fn(&Value, &str) -> (String, Answer) + Send + Sync;

#[derive(Default)]
struct Log {
    received: Vec<Received>,
    external: Vec<String>,
}

pub(crate) struct Loopback {
    port: u16,
    log: Arc<Mutex<Log>>,
    release: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    accept: Option<JoinHandle<()>>,
}

impl Loopback {
    pub(crate) fn start(plan: Box<Plan>) -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let plan: Arc<Plan> = Arc::from(plan);
        let log = Arc::new(Mutex::new(Log::default()));
        let release = Arc::new(AtomicBool::new(false));
        let stopping = Arc::new(AtomicBool::new(false));
        let accept = {
            let (log, release, stopping) = (
                Arc::clone(&log),
                Arc::clone(&release),
                Arc::clone(&stopping),
            );
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    if stopping.load(Ordering::SeqCst) {
                        break;
                    }
                    let Ok(stream) = stream else {
                        continue;
                    };
                    let (plan, log, release) =
                        (Arc::clone(&plan), Arc::clone(&log), Arc::clone(&release));
                    std::thread::spawn(move || serve(stream, plan.as_ref(), &log, &release));
                }
            })
        };
        Ok(Self {
            port,
            log,
            release,
            stopping,
            accept: Some(accept),
        })
    }

    pub(crate) fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/v1", self.port)
    }

    pub(crate) fn proxy(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub(crate) fn received(&self) -> Vec<Received> {
        self.log
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .received
            .clone()
    }

    pub(crate) fn external(&self) -> Vec<String> {
        self.log
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .external
            .clone()
    }

    /// Ends every held stream.
    pub(crate) fn release(&self) {
        self.release.store(true, Ordering::SeqCst);
    }
}

impl Drop for Loopback {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::SeqCst);
        self.release.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(("127.0.0.1", self.port));
        if let Some(accept) = self.accept.take() {
            let _ = accept.join();
        }
    }
}

struct Request {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

fn read_request(reader: &mut BufReader<TcpStream>) -> Option<Request> {
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.trim_end().splitn(3, ' ');
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let mut headers = Vec::new();
    let mut total = line.len();
    loop {
        let mut header = String::new();
        let read = reader.read_line(&mut header).ok()?;
        total += read;
        if read == 0 || total > MAX_HEADER_BYTES {
            return None;
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
        }
    }
    let mut request = Request {
        method,
        target,
        headers,
        body: Vec::new(),
    };
    let chunked = request
        .header("transfer-encoding")
        .is_some_and(|value| value.eq_ignore_ascii_case("chunked"));
    request.body = if chunked {
        read_chunked(reader)?
    } else {
        let length: usize = request
            .header("content-length")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        if length > MAX_BODY_BYTES {
            return None;
        }
        let mut body = vec![0_u8; length];
        reader.read_exact(&mut body).ok()?;
        body
    };
    Some(request)
}

fn read_chunked(reader: &mut BufReader<TcpStream>) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    loop {
        let mut size_line = String::new();
        reader.read_line(&mut size_line).ok()?;
        let size_text = size_line.trim().split(';').next()?.trim().to_string();
        let size = usize::from_str_radix(&size_text, 16).ok()?;
        if size == 0 {
            loop {
                let mut trailer = String::new();
                let read = reader.read_line(&mut trailer).ok()?;
                if read == 0 || trailer.trim().is_empty() {
                    return Some(body);
                }
            }
        }
        if body.len() + size > MAX_BODY_BYTES {
            return None;
        }
        let start = body.len();
        body.resize(start + size, 0);
        reader.read_exact(&mut body[start..]).ok()?;
        let mut end = String::new();
        reader.read_line(&mut end).ok()?;
    }
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, payload: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(payload);
    let _ = stream.flush();
}

fn chunk(stream: &mut TcpStream, payload: &[u8]) -> bool {
    let head = format!("{:x}\r\n", payload.len());
    stream.write_all(head.as_bytes()).is_ok()
        && stream.write_all(payload).is_ok()
        && stream.write_all(b"\r\n").is_ok()
        && stream.flush().is_ok()
}

/// The events as a server-sent event stream.
pub(crate) fn sse(events: &[Value]) -> Vec<u8> {
    let mut out = String::new();
    for event in events {
        let kind = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("message");
        out.push_str(&format!("event: {kind}\ndata: {event}\n\n"));
    }
    out.into_bytes()
}

/// One request per connection, then the connection closes.
fn serve(mut stream: TcpStream, plan: &Plan, log: &Mutex<Log>, release: &AtomicBool) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let Ok(reading) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(reading);
    let Some(request) = read_request(&mut reader) else {
        return;
    };
    let lock = || log.lock().unwrap_or_else(PoisonError::into_inner);
    let external = request.method == "CONNECT"
        || request.target.starts_with("http://")
        || request.target.starts_with("https://");
    if external {
        lock()
            .external
            .push(format!("{} {}", request.method, request.target));
        respond(
            &mut stream,
            "403 Forbidden",
            "application/json",
            br#"{"error":"external request refused"}"#,
        );
        return;
    }
    let text = String::from_utf8_lossy(&request.body).into_owned();
    let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
    let dummy_auth =
        request.header("authorization") == Some(format!("Bearer {DUMMY_TOKEN}").as_str());
    let path = request.target.clone();
    let served = request.method == "POST" && path.ends_with("/responses");
    if !served {
        lock().received.push(Received {
            method: request.method.clone(),
            path,
            dummy_auth,
            body,
            text,
            answer: "notServed".to_string(),
        });
        respond(
            &mut stream,
            "404 Not Found",
            "application/json",
            br#"{"error":"not served"}"#,
        );
        return;
    }
    let (label, answer) = plan(&body, &text);
    lock().received.push(Received {
        method: request.method.clone(),
        path,
        dummy_auth,
        body,
        text,
        answer: label,
    });
    match answer {
        Answer::Events(events) => {
            respond(&mut stream, "200 OK", "text/event-stream", &sse(&events))
        }
        Answer::Hold(events, limit) => {
            let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
            if stream.write_all(head.as_bytes()).is_err() || !chunk(&mut stream, &sse(&events)) {
                return;
            }
            let until = Instant::now() + limit;
            while Instant::now() < until && !release.load(Ordering::SeqCst) {
                std::thread::sleep(KEEPALIVE);
                if !chunk(&mut stream, b": held\n\n") {
                    return;
                }
            }
            let _ = stream.write_all(b"0\r\n\r\n");
            let _ = stream.flush();
        }
    }
}

// --- Events ------------------------------------------------------------------------------------

pub(crate) fn created(id: &str) -> Value {
    json!({ "type": "response.created", "response": { "id": id } })
}

pub(crate) fn item_done(index: usize, item: Value) -> Value {
    json!({ "type": "response.output_item.done", "output_index": index, "item": item })
}

pub(crate) fn completed(id: &str) -> Value {
    let usage = json!({
        "input_tokens": 0, "input_tokens_details": null,
        "output_tokens": 0, "output_tokens_details": null, "total_tokens": 0
    });
    json!({ "type": "response.completed", "response": { "id": id, "usage": usage } })
}

/// A response that is one assistant message.
pub(crate) fn message(id: &str, text: &str) -> Vec<Value> {
    let item = json!({
        "type": "message", "role": "assistant", "id": format!("msg_{id}"),
        "content": [{ "type": "output_text", "text": text }]
    });
    vec![created(id), item_done(0, item), completed(id)]
}

/// A response that is only these tool calls.
pub(crate) fn calls(id: &str, items: Vec<Value>) -> Vec<Value> {
    let mut events = vec![created(id)];
    events.extend(
        items
            .into_iter()
            .enumerate()
            .map(|(index, item)| item_done(index, item)),
    );
    events.push(completed(id));
    events
}

/// A call of a freeform tool: raw text, as `apply_patch` is declared.
pub(crate) fn custom_call(call_id: &str, name: &str, input: &str) -> Value {
    json!({ "type": "custom_tool_call", "id": format!("ctc_{call_id}"), "call_id": call_id, "name": name, "input": input })
}

/// A call of a function tool, with JSON arguments.
pub(crate) fn function_call(call_id: &str, name: &str, arguments: &Value) -> Value {
    json!({ "type": "function_call", "id": format!("fc_{call_id}"), "call_id": call_id, "name": name, "arguments": arguments.to_string() })
}

// --- Reading what was sent ---------------------------------------------------------------------

/// Every advertised tool by name: the `tools` field and any `additional_tools` input item, with
/// namespaces flattened to dotted names.
pub(crate) fn advertised_tools(body: &Value) -> Vec<String> {
    fn walk(tools: Option<&Value>, prefix: &str, names: &mut Vec<String>) {
        for tool in tools.and_then(Value::as_array).into_iter().flatten() {
            let name = tool
                .get("name")
                .or_else(|| tool.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("?");
            let name = format!("{prefix}{name}");
            if tool.get("type").and_then(Value::as_str) == Some("namespace") {
                walk(tool.get("tools"), &format!("{name}."), names);
            } else {
                names.push(name);
            }
        }
    }
    let mut names = Vec::new();
    walk(body.get("tools"), "", &mut names);
    for item in body
        .get("input")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if item.get("type").and_then(Value::as_str) == Some("additional_tools") {
            walk(item.get("tools"), "", &mut names);
        }
    }
    names
}

/// The text of one input item: its content parts, or its output.
pub(crate) fn item_text(item: &Value) -> String {
    match item.get("content") {
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(" | "),
        Some(Value::String(text)) => text.clone(),
        _ => match item.get("output") {
            Some(Value::String(text)) => text.clone(),
            Some(other) => other.to_string(),
            None => String::new(),
        },
    }
}

/// Each tool call's output the runtime sent back to the model, by call id.
pub(crate) fn outputs(body: &Value) -> BTreeMap<String, String> {
    body.get("input")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| {
            item.get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind.ends_with("_output"))
        })
        .filter_map(|item| {
            let call_id = item.get("call_id").and_then(Value::as_str)?;
            Some((call_id.to_string(), item_text(item)))
        })
        .collect()
}
