//! The Codex app-server conversations Adapt has: initialize, read or end the account, sign in, and
//! one turn. Written against the protocol the pinned binary generates
//! (`codex app-server generate-json-schema`, 0.162.1), and exercised against that binary by the
//! offline qualification in `codex_tests.rs`.
//!
//! Before any of the person's text is sent, the runtime must report exactly LeadingLight's
//! configuration (the gate in `guard.rs`), and the new thread must report the pinned model, the
//! `adapt` permission profile, no instruction sources and the empty working folder. Nothing here
//! overrides the sandbox, the approval policy or the working folder per thread or per turn: the
//! qualified configuration decides them, and the thread is checked against it.
//!
//! During the turn, a proposed patch (an item, a diff or a request for write authority) or anything
//! the qualification never saw stops it at once. Admission closes first: from then on no answer is
//! read. The turn is interrupted by its own thread and turn ids. Pending requests are answered,
//! each with its schema's own refusal (`decline` for a file change), only once the interrupt's own
//! reply has come back and this very turn has ended as interrupted, so a refusal can never let the
//! turn go on; otherwise they stay unanswered. The caller then kills and reaps the whole process
//! group whatever happened. Nothing is retried.
//!
//! Every write is bounded (see `rpc.rs`): a provider that stops taking input fails the send, and
//! the caller still kills it.

use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::super::check::{self, ReplyFault};
use super::super::instant_from_unix;
use super::super::prompt::{self, Payload};
use super::super::provider::{TurnControl, TurnOutcome};
use super::super::wire::{Failure, TurnPhase};
use super::controls::{
    self, ALLOWED_ITEMS, EFFECT_NOTIFICATIONS, PATCH_ITEM, PATCH_NOTIFICATIONS, PATCH_REQUESTS,
};
use super::guard::Reported;
use super::rpc::{Connection, Inbound, WRITE_TIMEOUT};

const TICK: Duration = Duration::from_millis(50);
/// After asking a turn to stop, how long to wait for the provider to confirm it before the process
/// is killed anyway.
const INTERRUPT_GRACE: Duration = Duration::from_secs(3);
/// After asking a sign-in to cancel, how long to let it say so.
const CANCEL_GRACE: Duration = Duration::from_secs(2);
/// The final answer's text, before it is read as a reply.
const MAX_ANSWER_BYTES: usize = 2 * check::PACKAGE_BYTES;
/// Notifications that warn about the configuration or the model. Any before the turn refuses it.
const WARNINGS: &[&str] = &[
    "warning",
    "configWarning",
    "deprecationNotice",
    "guardianWarning",
];

/// Why a conversation with the provider stopped early.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Halt {
    Cancelled,
    TimedOut,
    /// The provider asked for something or did something the qualification never saw.
    Breach,
    /// The stream ended, overflowed or carried nonsense, or a request failed.
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AccountKind {
    SignedOut,
    ChatGpt,
    /// An API key or any other sign-in Adapt does not use.
    Other,
}

/// Whether the provider stayed within what was qualified.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Verdict {
    Clean,
    /// Its folders or reported configuration were not as qualified, found before anything was
    /// sent. Checked again before the next start.
    Contaminated,
    /// It did something the qualification never saw it do. Codex stays unqualified until the app
    /// restarts.
    Breach,
}

/// Why the host stopped a running turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StopCause {
    Cancelled,
    /// The model proposed a patch. Known, contained behaviour of the pinned build: no breach.
    PatchAttempt,
    Breach,
    /// The service answered with another model.
    Rerouted,
    TimedOut,
}

/// What stopping one turn took, for the log and for the qualification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StopRecord {
    pub(crate) cause: StopCause,
    /// The message that caused it.
    pub(crate) trigger: String,
    pub(crate) thread_id: Option<String>,
    pub(crate) turn_id: Option<String>,
    pub(crate) interrupt_sent: bool,
    /// The interrupt's own reply, matched by request id, came back as the protocol's empty object.
    pub(crate) interrupt_acknowledged: bool,
    /// The interrupt's own reply came back as an error or anything else.
    pub(crate) interrupt_refused: bool,
    /// `turn/completed` arrived for exactly this thread and turn, with status `interrupted`.
    pub(crate) turn_interrupted: bool,
    /// Requests answered with their refusal, only once both of the above were seen.
    pub(crate) refused: Vec<String>,
    /// Requests left unanswered, ended by killing the process instead.
    pub(crate) unanswered: Vec<String>,
    /// Messages that arrived after admission closed and were not read.
    pub(crate) ignored: usize,
    /// Set by the caller: the process group was proven gone.
    pub(crate) group_gone: bool,
}

impl StopRecord {
    fn new(
        cause: StopCause,
        trigger: String,
        thread_id: Option<&str>,
        turn_id: Option<String>,
    ) -> Self {
        Self {
            cause,
            trigger,
            thread_id: thread_id.map(str::to_string),
            turn_id,
            interrupt_sent: false,
            interrupt_acknowledged: false,
            interrupt_refused: false,
            turn_interrupted: false,
            refused: Vec::new(),
            unanswered: Vec::new(),
            ignored: 0,
            group_gone: false,
        }
    }

    /// One line for the log: what happened, never content or ids.
    pub(crate) fn summary(&self) -> String {
        format!(
            "cause={:?} trigger={} ids={}/{} interrupt sent={} acknowledged={} refused={} turn interrupted={} answered with refusal={:?} unanswered={:?} ignored={} group gone={}",
            self.cause,
            self.trigger,
            self.thread_id.is_some(),
            self.turn_id.is_some(),
            self.interrupt_sent,
            self.interrupt_acknowledged,
            self.interrupt_refused,
            self.turn_interrupted,
            self.refused,
            self.unanswered,
            self.ignored,
            self.group_gone,
        )
    }
}

/// How a turn ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TurnEnd {
    pub(crate) outcome: TurnOutcome,
    pub(crate) verdict: Verdict,
    pub(crate) stop: Option<StopRecord>,
}

/// What the new thread must report.
pub(crate) struct Expect<'a> {
    pub(crate) run_dir: &'a Path,
    pub(crate) model_provider: &'a str,
}

/// Waits for the response to `id`. Every other message goes to `observe`; any request from the
/// provider is refused and is a breach (no request is expected outside a turn).
fn await_response(
    connection: &mut Connection,
    id: i64,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
    observe: &mut dyn FnMut(&str, &Value) -> Result<(), Halt>,
) -> Result<Value, Halt> {
    loop {
        if cancelled() {
            return Err(Halt::Cancelled);
        }
        if Instant::now() >= deadline {
            return Err(Halt::TimedOut);
        }
        match connection.next(TICK) {
            None => {}
            Some(Inbound::Response {
                id: answered,
                result,
            }) if answered == id => return Ok(result),
            Some(Inbound::Error { id: answered }) if answered == id => return Err(Halt::Failed),
            Some(Inbound::Response { .. } | Inbound::Error { .. }) => {}
            Some(Inbound::Notification { method, params }) => observe(&method, &params)?,
            Some(Inbound::Request { id, method, .. }) => {
                let _ = connection.refuse(&id, &method);
                return Err(Halt::Breach);
            }
            Some(Inbound::Malformed | Inbound::Overflow | Inbound::Closed) => {
                return Err(Halt::Failed)
            }
        }
    }
}

fn never() -> bool {
    false
}

fn ignore(_: &str, _: &Value) -> Result<(), Halt> {
    Ok(())
}

fn call(
    connection: &mut Connection,
    method: &str,
    params: Value,
    deadline: Instant,
) -> Result<Value, Halt> {
    let id = connection
        .request(method, params)
        .map_err(|_| Halt::Failed)?;
    await_response(connection, id, deadline, &never, &mut ignore)
}

fn initialize_with(
    connection: &mut Connection,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
    observe: &mut dyn FnMut(&str, &Value) -> Result<(), Halt>,
) -> Result<(), Halt> {
    let params = json!({
        "clientInfo": {
            "name": "leadinglight_adapt",
            "title": "LeadingLight",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "capabilities": { "experimentalApi": true },
    });
    let id = connection
        .request("initialize", params)
        .map_err(|_| Halt::Failed)?;
    await_response(connection, id, deadline, cancelled, observe)?;
    connection.notify("initialized").map_err(|_| Halt::Failed)
}

pub(crate) fn initialize(
    connection: &mut Connection,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
) -> Result<(), Halt> {
    initialize_with(connection, deadline, cancelled, &mut ignore)
}

/// The stored sign-in, without refreshing it. Stops as soon as `cancelled` says so.
pub(crate) fn read_account(
    connection: &mut Connection,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
) -> Result<AccountKind, Halt> {
    let params = json!({ "refreshToken": false });
    let id = connection
        .request_within("account/read", params, deadline, cancelled)
        .map_err(|_| Halt::Failed)?;
    let result = await_response(connection, id, deadline, cancelled, &mut ignore)?;
    Ok(match result.get("account") {
        None | Some(Value::Null) => AccountKind::SignedOut,
        Some(account) if account.get("type").and_then(Value::as_str) == Some("chatgpt") => {
            AccountKind::ChatGpt
        }
        Some(_) => AccountKind::Other,
    })
}

pub(crate) fn logout(connection: &mut Connection, deadline: Instant) -> Result<(), Halt> {
    call(connection, "account/logout", Value::Null, deadline).map(drop)
}

/// Starts the provider's ChatGPT browser sign-in: its login id and the page to open.
pub(crate) fn start_login(
    connection: &mut Connection,
    deadline: Instant,
) -> Result<(String, String), Halt> {
    let result = call(
        connection,
        "account/login/start",
        json!({ "type": "chatgpt" }),
        deadline,
    )?;
    let field = |name: &str| result.get(name).and_then(Value::as_str).map(str::to_string);
    match (field("type").as_deref(), field("loginId"), field("authUrl")) {
        (Some("chatgpt"), Some(login_id), Some(auth_url)) => Ok((login_id, auth_url)),
        _ => Err(Halt::Failed),
    }
}

/// Waits for this sign-in to complete. On cancel, asks the provider to cancel it first.
pub(crate) fn await_login(
    connection: &mut Connection,
    login_id: &str,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
) -> Result<bool, Halt> {
    loop {
        if cancelled() {
            let grace = Instant::now() + CANCEL_GRACE;
            let params = json!({ "loginId": login_id });
            if let Ok(id) = connection.request_within("account/login/cancel", params, grace, &never)
            {
                let _ = await_response(connection, id, grace, &never, &mut ignore);
            }
            return Err(Halt::Cancelled);
        }
        if Instant::now() >= deadline {
            return Err(Halt::TimedOut);
        }
        match connection.next(TICK) {
            Some(Inbound::Notification { method, params })
                if method == "account/login/completed" =>
            {
                if params.get("loginId").and_then(Value::as_str) == Some(login_id) {
                    return Ok(params.get("success").and_then(Value::as_bool) == Some(true));
                }
            }
            Some(Inbound::Request { id, method, .. }) => {
                let _ = connection.refuse(&id, &method);
                return Err(Halt::Breach);
            }
            Some(Inbound::Malformed | Inbound::Overflow | Inbound::Closed) => {
                return Err(Halt::Failed)
            }
            _ => {}
        }
    }
}

// --- One turn ----------------------------------------------------------------------------------

/// What happens before the turn: warnings are kept for the gate; an effect is a breach.
#[derive(Default)]
struct Setup {
    warnings: Vec<String>,
}

impl Setup {
    fn observe(&mut self, method: &str, _params: &Value) -> Result<(), Halt> {
        if EFFECT_NOTIFICATIONS.contains(&method)
            || PATCH_NOTIFICATIONS.contains(&method)
            || method.starts_with("item/")
        {
            return Err(Halt::Breach);
        }
        if WARNINGS.contains(&method) {
            self.warnings.push(method.to_string());
        }
        Ok(())
    }
}

/// Everything the gate looks at, asked of the runtime in one fixed order.
fn report(
    connection: &mut Connection,
    run: &str,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
    setup: &mut Setup,
) -> Result<Reported, Halt> {
    let mut reported = {
        let mut ask = |method: &str, params: Value| -> Result<Value, Halt> {
            let id = connection
                .request(method, params)
                .map_err(|_| Halt::Failed)?;
            await_response(
                connection,
                id,
                deadline,
                cancelled,
                &mut |method: &str, params: &Value| setup.observe(method, params),
            )
        };
        Reported {
            requirements: ask("configRequirements/read", Value::Null)?,
            config: ask("config/read", json!({ "includeLayers": true, "cwd": run }))?,
            skills: ask("skills/list", json!({ "cwds": [run], "forceReload": true }))?,
            hooks: ask("hooks/list", json!({ "cwds": [run] }))?,
            plugins: ask("plugin/list", json!({ "cwds": [run] }))?,
            mcp_servers: ask("mcpServerStatus/list", json!({}))?,
            warnings: Vec::new(),
        }
    };
    reported.warnings = setup.warnings.clone();
    Ok(reported)
}

/// The new thread is exactly as qualified: its id, or the first thing that is not.
fn thread_fits(started: &Value, expect: &Expect<'_>) -> Result<String, &'static str> {
    let text = |key: &str| started.get(key).and_then(Value::as_str);
    let pointer = |path: &str| started.pointer(path);
    let thread_id = pointer("/thread/id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty());
    let no_instructions = match started.get("instructionSources") {
        None => true,
        Some(Value::Array(sources)) => sources.is_empty(),
        Some(_) => false,
    };
    let checks = [
        ("thread id", thread_id.is_some()),
        ("instruction sources", no_instructions),
        (
            "working folder",
            text("cwd").is_some_and(|cwd| Path::new(cwd) == expect.run_dir),
        ),
        ("model", text("model") == Some(controls::MODEL)),
        (
            "model provider",
            text("modelProvider") == Some(expect.model_provider),
        ),
        (
            "sandbox",
            pointer("/sandbox/type").and_then(Value::as_str) == Some("readOnly")
                && pointer("/sandbox/networkAccess") == Some(&Value::Bool(false)),
        ),
        (
            "permission profile",
            pointer("/activePermissionProfile/id").and_then(Value::as_str)
                == Some(controls::PROFILE),
        ),
        (
            "approval policy",
            text("approvalPolicy") == Some("on-request"),
        ),
        (
            "approvals reviewer",
            text("approvalsReviewer") == Some("user"),
        ),
    ];
    if let Some((name, _)) = checks.iter().find(|(_, fits)| !fits) {
        return Err(*name);
    }
    Ok(thread_id.unwrap_or_default().to_string())
}

enum Observed {
    Continue,
    Stop(StopCause, String),
}

/// What the turn's notifications have shown so far.
#[derive(Default)]
struct Seen {
    answer: Option<String>,
    too_large: bool,
    started: bool,
    completed: Option<Value>,
    /// The latest reset time of a usage window the provider reported as used up.
    resets_at: Option<i64>,
}

impl Seen {
    fn observe(&mut self, method: &str, params: &Value, thread_id: &str) -> Observed {
        if let Some(other) = params.get("threadId").and_then(Value::as_str) {
            if other != thread_id {
                let trigger = format!("{method} on another thread");
                return Observed::Stop(StopCause::Breach, trigger);
            }
        }
        if EFFECT_NOTIFICATIONS.contains(&method) {
            return Observed::Stop(StopCause::Breach, method.to_string());
        }
        if PATCH_NOTIFICATIONS.contains(&method) {
            return Observed::Stop(StopCause::PatchAttempt, method.to_string());
        }
        match method {
            "item/started" | "item/completed" => {
                let item = params.get("item").unwrap_or(&Value::Null);
                let kind = item.get("type").and_then(Value::as_str).unwrap_or("");
                if kind == PATCH_ITEM {
                    return Observed::Stop(StopCause::PatchAttempt, format!("{method}:{kind}"));
                }
                if !ALLOWED_ITEMS.contains(&kind) {
                    return Observed::Stop(StopCause::Breach, format!("{method}:{kind}"));
                }
                if method == "item/completed" && kind == "agentMessage" {
                    self.keep_answer(item);
                }
            }
            "model/rerouted" => return Observed::Stop(StopCause::Rerouted, method.to_string()),
            "turn/started" => self.started = true,
            "turn/completed" => {
                self.completed = Some(params.get("turn").cloned().unwrap_or(Value::Null))
            }
            "account/rateLimits/updated" => self.note_limits(params.get("rateLimits")),
            _ => {}
        }
        Observed::Continue
    }

    /// The last complete message is the answer; commentary before it is not.
    fn keep_answer(&mut self, item: &Value) {
        if item.get("phase").and_then(Value::as_str) == Some("commentary") {
            return;
        }
        match item.get("text").and_then(Value::as_str) {
            Some(text) if text.len() <= MAX_ANSWER_BYTES => self.answer = Some(text.to_string()),
            Some(_) => self.too_large = true,
            None => {}
        }
    }

    fn note_limits(&mut self, limits: Option<&Value>) {
        let Some(limits) = limits else {
            return;
        };
        for window in ["primary", "secondary"] {
            let Some(window) = limits.get(window) else {
                continue;
            };
            let used_up = window
                .get("usedPercent")
                .and_then(Value::as_f64)
                .is_some_and(|used| used >= 100.0);
            let resets_at = window.get("resetsAt").and_then(Value::as_i64);
            if let (true, Some(resets_at)) = (used_up, resets_at) {
                self.resets_at = Some(
                    self.resets_at
                        .map_or(resets_at, |known| known.max(resets_at)),
                );
            }
        }
    }
}

/// The terminal notification of exactly this thread's turn, ended as interrupted.
fn is_interrupted(method: &str, params: &Value, thread_id: &str, turn_id: &str) -> bool {
    let text = |path: &str| params.pointer(path).and_then(Value::as_str);
    method == "turn/completed"
        && text("/threadId") == Some(thread_id)
        && text("/turn/id") == Some(turn_id)
        && text("/turn/status") == Some("interrupted")
}

/// A message that crosses the boundary even while the turn is being stopped.
fn crosses(method: &str, params: &Value) -> bool {
    if EFFECT_NOTIFICATIONS.contains(&method) {
        return true;
    }
    if method == "item/started" || method == "item/completed" {
        let kind = params
            .pointer("/item/type")
            .and_then(Value::as_str)
            .unwrap_or("");
        return kind != PATCH_ITEM && !ALLOWED_ITEMS.contains(&kind);
    }
    false
}

fn failed(reason: Failure) -> TurnOutcome {
    TurnOutcome::Failed {
        reason,
        resets_at: None,
    }
}

fn end(outcome: TurnOutcome, verdict: Verdict) -> TurnEnd {
    TurnEnd {
        outcome,
        verdict,
        stop: None,
    }
}

/// A conversation that ended before any turn existed.
fn halted(halt: Halt) -> TurnEnd {
    match halt {
        Halt::Cancelled => TurnEnd {
            outcome: TurnOutcome::Stopped,
            verdict: Verdict::Clean,
            stop: Some(StopRecord::new(
                StopCause::Cancelled,
                "cancel before the turn".to_string(),
                None,
                None,
            )),
        },
        Halt::TimedOut => end(failed(Failure::TimedOut), Verdict::Clean),
        Halt::Breach => end(failed(Failure::ToolRefused), Verdict::Breach),
        Halt::Failed => end(failed(Failure::ProviderFailed), Verdict::Clean),
    }
}

/// The finished turn, read only once complete and successful.
fn ended(seen: &Seen, turn: &Value) -> TurnOutcome {
    match turn.get("status").and_then(Value::as_str) {
        Some("completed") => {
            if seen.too_large {
                return failed(Failure::OutputTooLarge);
            }
            let Some(answer) = seen.answer.as_deref() else {
                return failed(Failure::InvalidOutput);
            };
            match prompt::read_answer(answer) {
                Ok(reply) => TurnOutcome::Reply(reply),
                Err(ReplyFault::TooLarge) => failed(Failure::OutputTooLarge),
                Err(ReplyFault::Invalid) => failed(Failure::InvalidOutput),
            }
        }
        Some("failed") => {
            let info = turn.pointer("/error/codexErrorInfo");
            match info.and_then(Value::as_str) {
                Some("usageLimitExceeded") => TurnOutcome::Failed {
                    reason: Failure::UsageLimit,
                    resets_at: seen.resets_at.and_then(instant_from_unix),
                },
                Some("unauthorized") => failed(Failure::NotConnected),
                _ => failed(Failure::ProviderFailed),
            }
        }
        _ => failed(Failure::ProviderFailed),
    }
}

/// Stops a running turn. Admission is already closed: nothing read from here on is an answer.
fn stop(
    connection: &mut Connection,
    cause: StopCause,
    trigger: String,
    thread_id: &str,
    turn_id: Option<String>,
    mut pending: Vec<(Value, String)>,
) -> TurnEnd {
    let mut record = StopRecord::new(cause, trigger, Some(thread_id), turn_id.clone());
    let mut breach = cause == StopCause::Breach;
    if let Some(turn_id) = turn_id.as_deref() {
        let grace = Instant::now() + INTERRUPT_GRACE;
        let params = json!({ "threadId": thread_id, "turnId": turn_id });
        if let Ok(id) = connection.request_within("turn/interrupt", params, grace, &never) {
            record.interrupt_sent = true;
            while Instant::now() < grace && !record.interrupt_refused {
                if record.interrupt_acknowledged && record.turn_interrupted {
                    break;
                }
                match connection.next(TICK) {
                    None => {}
                    Some(Inbound::Response {
                        id: answered,
                        result,
                    }) if answered == id => {
                        // The protocol's reply to `turn/interrupt` is an empty object.
                        record.interrupt_acknowledged = result.is_object();
                        record.interrupt_refused = !result.is_object();
                    }
                    Some(Inbound::Error { id: answered }) if answered == id => {
                        record.interrupt_refused = true
                    }
                    Some(Inbound::Response { .. } | Inbound::Error { .. }) => {}
                    Some(Inbound::Request { id, method, .. }) => pending.push((id, method)),
                    Some(Inbound::Notification { method, params }) => {
                        if is_interrupted(&method, &params, thread_id, turn_id) {
                            record.turn_interrupted = true;
                        } else {
                            breach |= crosses(&method, &params);
                            record.ignored += 1;
                        }
                    }
                    Some(Inbound::Malformed | Inbound::Overflow | Inbound::Closed) => break,
                }
            }
        }
    }
    // A refusal can let a turn go on (`decline` continues it). Requests are answered only once
    // this very turn has both acknowledged the interrupt and ended as interrupted; otherwise they
    // are left to the kill that follows, which grants nothing either.
    let interrupted = record.interrupt_acknowledged && record.turn_interrupted;
    for (id, method) in pending {
        if interrupted && connection.refuse(&id, &method).is_ok() {
            record.refused.push(method);
        } else {
            record.unanswered.push(method);
        }
    }
    let outcome = match cause {
        StopCause::Cancelled => TurnOutcome::Stopped,
        StopCause::PatchAttempt | StopCause::Breach => failed(Failure::ToolRefused),
        StopCause::Rerouted => failed(Failure::ProviderFailed),
        StopCause::TimedOut => failed(Failure::TimedOut),
    };
    TurnEnd {
        outcome,
        verdict: if breach {
            Verdict::Breach
        } else {
            Verdict::Clean
        },
        stop: Some(record),
    }
}

/// Follows the started turn to its end, or stops it.
fn follow(
    connection: &mut Connection,
    thread_id: &str,
    start_id: i64,
    control: &TurnControl,
    deadline: Instant,
) -> TurnEnd {
    let mut seen = Seen::default();
    let mut turn_id: Option<String> = None;
    let mut reported_working = false;
    loop {
        if !reported_working && seen.started {
            control.report(TurnPhase::Working);
            reported_working = true;
        }
        if let Some(turn) = seen.completed.take() {
            let completed_id = turn.get("id").and_then(Value::as_str);
            if turn_id.is_some() && completed_id != turn_id.as_deref() {
                let trigger = "turn/completed for another turn".to_string();
                return stop(
                    connection,
                    StopCause::Breach,
                    trigger,
                    thread_id,
                    turn_id,
                    Vec::new(),
                );
            }
            control.report(TurnPhase::Checking);
            return end(ended(&seen, &turn), Verdict::Clean);
        }
        if control.is_cancelled() {
            let trigger = "cancel".to_string();
            return stop(
                connection,
                StopCause::Cancelled,
                trigger,
                thread_id,
                turn_id,
                Vec::new(),
            );
        }
        if Instant::now() >= deadline {
            let trigger = "deadline".to_string();
            return stop(
                connection,
                StopCause::TimedOut,
                trigger,
                thread_id,
                turn_id,
                Vec::new(),
            );
        }
        let turn_of = |params: &Value, known: Option<String>| {
            known.or_else(|| {
                params
                    .get("turnId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
        };
        match connection.next(TICK) {
            None => {}
            Some(Inbound::Response { id, result }) if id == start_id => {
                match result.pointer("/turn/id").and_then(Value::as_str) {
                    Some(accepted) if !accepted.is_empty() => turn_id = Some(accepted.to_string()),
                    _ => return end(failed(Failure::ProviderFailed), Verdict::Clean),
                }
            }
            Some(Inbound::Error { id }) if id == start_id => {
                return end(failed(Failure::ProviderFailed), Verdict::Clean)
            }
            Some(Inbound::Response { .. } | Inbound::Error { .. }) => {}
            Some(Inbound::Notification { method, params }) => {
                if let Observed::Stop(cause, trigger) = seen.observe(&method, &params, thread_id) {
                    let turn_id = turn_of(&params, turn_id);
                    return stop(connection, cause, trigger, thread_id, turn_id, Vec::new());
                }
            }
            Some(Inbound::Request { id, method, params }) => {
                let same_thread = params.get("threadId").and_then(Value::as_str) == Some(thread_id);
                let cause = if same_thread && PATCH_REQUESTS.contains(&method.as_str()) {
                    StopCause::PatchAttempt
                } else {
                    StopCause::Breach
                };
                let trigger = format!("request {method}");
                let turn_id = turn_of(&params, turn_id);
                return stop(
                    connection,
                    cause,
                    trigger,
                    thread_id,
                    turn_id,
                    vec![(id, method)],
                );
            }
            Some(Inbound::Malformed | Inbound::Overflow | Inbound::Closed) => {
                return end(failed(Failure::ProviderFailed), Verdict::Clean)
            }
        }
    }
}

/// One fresh ephemeral thread and one turn with exactly `payload`. `admit` judges what the runtime
/// reports about itself; the person's text is sent only after that and the thread are proven.
pub(crate) fn run_turn(
    connection: &mut Connection,
    payload: &Payload,
    expect: &Expect<'_>,
    admit: &dyn Fn(&Reported) -> Vec<String>,
    control: &TurnControl,
    deadline: Instant,
) -> TurnEnd {
    let cancelled = || control.is_cancelled();
    let mut setup = Setup::default();
    let initialized = initialize_with(
        connection,
        deadline,
        &cancelled,
        &mut |method: &str, params: &Value| setup.observe(method, params),
    );
    if let Err(halt) = initialized {
        return halted(halt);
    }
    let run = expect.run_dir.to_string_lossy().into_owned();
    let reported = match report(connection, &run, deadline, &cancelled, &mut setup) {
        Ok(reported) => reported,
        Err(halt) => return halted(halt),
    };
    let problems = admit(&reported);
    if let Some(first) = problems.first() {
        log::warn!(
            "Codex was not started for Adapt: {first} ({} problems)",
            problems.len()
        );
        return end(failed(Failure::ProviderFailed), Verdict::Contaminated);
    }

    let thread = json!({
        "cwd": run,
        "baseInstructions": payload.instructions,
        "ephemeral": true,
    });
    let sent = connection.request_within("thread/start", thread, write_bound(deadline), &cancelled);
    let started = match sent {
        Ok(id) => await_response(
            connection,
            id,
            deadline,
            &cancelled,
            &mut |method: &str, params: &Value| setup.observe(method, params),
        ),
        Err(_) if cancelled() => Err(Halt::Cancelled),
        Err(_) => Err(Halt::Failed),
    };
    let started = match started {
        Ok(started) => started,
        Err(halt) => return halted(halt),
    };
    if !setup.warnings.is_empty() {
        log::warn!("Codex warned before the Adapt turn; nothing was sent");
        return end(failed(Failure::ProviderFailed), Verdict::Contaminated);
    }
    let thread_id = match thread_fits(&started, expect) {
        Ok(thread_id) => thread_id,
        Err(misfit) => {
            log::warn!("The Codex thread is not as qualified ({misfit}); nothing was sent");
            return end(failed(Failure::ProviderFailed), Verdict::Breach);
        }
    };

    let turn = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": payload.message, "text_elements": [] }],
        "outputSchema": payload.output_schema,
    });
    // The person's text: the largest write. A provider that stops taking it in fails the send at
    // its bound, or at once on cancel, and is then killed like any other.
    let sent = connection.request_within("turn/start", turn, write_bound(deadline), &cancelled);
    match sent {
        Ok(start_id) => follow(connection, &thread_id, start_id, control, deadline),
        Err(_) if cancelled() => halted(Halt::Cancelled),
        Err(_) => end(failed(Failure::ProviderFailed), Verdict::Clean),
    }
}

/// How long one write may take within the turn's own deadline.
fn write_bound(deadline: Instant) -> Instant {
    deadline.min(Instant::now() + WRITE_TIMEOUT)
}
