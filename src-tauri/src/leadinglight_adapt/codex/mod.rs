//! Codex over its app-server, as Adapt's first provider.
//!
//! Only one build is ever run: the native binary whose SHA-256 is pinned in `controls.rs`, found
//! among fixed install locations, with the pinned model. Any other Codex is reported as an
//! unsupported version and never run; nothing is ever installed or updated.
//!
//! A fresh app-server process serves each turn, each sign-in and each sign-out, and its whole
//! process group is killed, proven gone and reaped when it is done, so no provider thread or state
//! carries from one Send to the next. Before each start, LeadingLight's configuration is put in
//! place and the private folders pass the preflight in `guard.rs`; before each thread, the runtime's
//! own report passes the gate. A failed check before anything is sent reports Codex `unqualified`
//! until a later check passes. Anything at run time that the qualification never saw reports it
//! `unqualified` until the app restarts. So does a process group that cannot be proven gone; that
//! turn's outcome is `Unconfirmed`, whatever it ended with. Reading status never starts a sign-in.
//! `docs/leadinglight/adapt-provider.md` describes all of it.

pub(crate) mod controls;
pub(crate) mod guard;
#[cfg(all(test, unix))]
pub(crate) mod loopback;
pub(crate) mod process;
pub(crate) mod rpc;
pub(crate) mod session;

use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use tempfile::NamedTempFile;

use super::prompt::Payload;
use super::provider::{Provider, ProviderSnapshot, TurnControl, TurnOutcome};
use super::store::read_bounded;
use super::wire::{
    AccountRefusal, CancelConnectReply, ConnectRefusal, ConnectReply, DisconnectRefusal,
    DisconnectReply, Failure, LastConnect, ProviderState, UnavailableReason,
};
use guard::{Expected, Reported};
use process::{Discovery, Layout, Pin, Pinned, Process};
use rpc::Connection;
use session::{AccountKind, Expect, Halt, TurnEnd, Verdict};

const SETUP_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const CANCEL_SIGN_IN_WAIT: Duration = Duration::from_secs(5);
const MAX_CONFIG_BYTES: usize = 64 * 1024;

/// A model provider other than ChatGPT's. Only the offline qualification has one: its loopback
/// fixture, reached with a dummy key.
#[derive(Debug, Clone)]
pub(crate) struct ModelProvider {
    pub(crate) id: String,
    pub(crate) base_url: String,
    pub(crate) env_key: String,
}

/// Everything that differs between the app and the offline qualification.
#[derive(Debug, Clone)]
pub(crate) struct Settings {
    pub(crate) candidates: Vec<PathBuf>,
    pub(crate) pin: Pin,
    /// The person's own home: the working folder's ancestry is checked up to it, not above.
    pub(crate) boundary: Option<PathBuf>,
    pub(crate) managed: Vec<PathBuf>,
    /// The model the configuration names. Always `controls::MODEL` outside tests.
    pub(crate) model: String,
    pub(crate) provider: Option<ModelProvider>,
    pub(crate) extra_env: Vec<(String, OsString)>,
}

impl Settings {
    pub(crate) fn app(user_home: Option<PathBuf>) -> Self {
        Self {
            candidates: process::candidates(user_home.as_deref()),
            pin: Pin::qualified(),
            boundary: user_home.and_then(|home| home.canonicalize().ok()),
            managed: guard::MANAGED_CONFIG.iter().map(PathBuf::from).collect(),
            model: controls::MODEL.to_string(),
            provider: None,
            extra_env: Vec::new(),
        }
    }

    fn model_provider(&self) -> &str {
        self.provider
            .as_ref()
            .map_or(controls::MODEL_PROVIDER, |provider| provider.id.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Account {
    /// Not looked at yet in this process.
    Unknown,
    SignedOut(Option<LastConnect>),
    Connecting,
    Connected,
    Refused,
    /// The stored sign-in could not be read.
    Failed,
    /// A cancelled sign-in's stored credential, or its cancellation marker, could not be removed.
    /// The credential is never read or used, and no new sign-in starts; removal is tried again on
    /// each status read, cancel and sign-out, and this state lasts across a restart (the marker
    /// says so) until both are gone.
    Blocked,
}

/// The one sign-in in progress: a flag to stop it, and its end. Its worker having ended and its
/// cleanup having been proven are told apart.
struct SignIn {
    cancel: AtomicBool,
    /// Once its worker has ended: whether all of its cleanup was proven.
    ended: Mutex<Option<bool>>,
    settled: Condvar,
}

impl SignIn {
    fn new() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            ended: Mutex::new(None),
            settled: Condvar::new(),
        }
    }

    fn finish(&self, cleanup_proven: bool) {
        *self.ended.lock().unwrap_or_else(PoisonError::into_inner) = Some(cleanup_proven);
        self.settled.notify_all();
    }

    /// `None` if its worker has not ended within `timeout`; otherwise whether its cleanup was
    /// proven.
    fn wait(&self, timeout: Duration) -> Option<bool> {
        let ended = self.ended.lock().unwrap_or_else(PoisonError::into_inner);
        let (ended, _) = self
            .settled
            .wait_timeout_while(ended, timeout, |ended| ended.is_none())
            .unwrap_or_else(PoisonError::into_inner);
        *ended
    }
}

struct State {
    discovery: Option<Discovery>,
    account: Account,
    /// Something the qualification never saw happened: unqualified until the app restarts.
    breached: bool,
    /// The last check before a start failed: unqualified until a check passes.
    contaminated: bool,
    /// Some process group was not proven gone. Until the app restarts, no cancel or sign-out
    /// reports its cleanup as complete.
    unproven_end: bool,
    /// A cancel was asked for and its sign-in's cleanup is not yet proven.
    unresolved_cancel: bool,
    sign_in: Option<Arc<SignIn>>,
    revision: u64,
    epoch: u64,
    last: Option<ProviderState>,
    /// Sign-outs begun; a sign-in that started before one can never complete as connected.
    sign_outs: u64,
    #[cfg(test)]
    spawns: u64,
    #[cfg(test)]
    last_stop: Option<session::StopRecord>,
    #[cfg(test)]
    last_group_gone: Option<bool>,
}

/// A change of who is signed in starts a new account epoch.
fn apply_account(state: &mut State, account: Account) {
    let changed_identity = matches!(
        account,
        Account::Connected | Account::SignedOut(_) | Account::Refused
    ) && state.account != account;
    if changed_identity {
        state.epoch += 1;
    }
    state.account = account;
}

fn unavailable(reason: UnavailableReason, pinned: bool) -> ProviderState {
    ProviderState::Unavailable {
        reason,
        installed_version: pinned.then(|| controls::PINNED_VERSION.to_string()),
    }
}

fn state_for(account: Account) -> ProviderState {
    match account {
        Account::Unknown | Account::SignedOut(None) => {
            ProviderState::SignedOut { last_connect: None }
        }
        Account::SignedOut(last) => ProviderState::SignedOut { last_connect: last },
        Account::Connecting => ProviderState::Connecting,
        Account::Connected => ProviderState::Connected,
        Account::Refused => ProviderState::Refused {
            reason: AccountRefusal::AccountNotSupported,
        },
        Account::Failed | Account::Blocked => unavailable(UnavailableReason::Failed, true),
    }
}

/// Says, across a restart, that a cancelled sign-in's credential is still to be removed.
fn cancelled_marker(layout: &Layout) -> PathBuf {
    layout.root().join("cancelled-sign-in")
}

fn remove_if_present(path: &Path) -> bool {
    match std::fs::remove_file(path) {
        Ok(()) => true,
        Err(error) => error.kind() == std::io::ErrorKind::NotFound,
    }
}

/// Removes LeadingLight's private sign-in, then the cancellation marker. `true` only once both are
/// gone: while the marker survives, a later sign-in's credential would be taken for the cancelled
/// one after a restart, so the cancellation stays unresolved.
fn remove_sign_in(layout: &Layout) -> bool {
    remove_if_present(&layout.auth_file()) && remove_if_present(&cancelled_marker(layout))
}

/// A cancelled sign-in whose credential or marker is still there: never read or used again, and no
/// new sign-in until both are gone.
fn block(state: &mut State, layout: &Layout) {
    log::warn!("A cancelled Codex sign-in could not be fully removed; it will not be used");
    if let Err(error) = std::fs::write(cancelled_marker(layout), b"") {
        log::warn!("The cancelled Codex sign-in could not be marked for a restart: {error}");
    }
    state.account = Account::Blocked;
}

/// Tries again to remove a blocked credential; once removed, the cancellation is resolved unless
/// some process group is still unproven.
fn retry_blocked(state: &mut State, layout: &Layout) {
    if state.account == Account::Blocked && remove_sign_in(layout) {
        apply_account(state, Account::SignedOut(Some(LastConnect::Cancelled)));
        state.unresolved_cancel = state.unproven_end;
    }
}

fn failed(reason: Failure) -> TurnOutcome {
    TurnOutcome::Failed {
        reason,
        resets_at: None,
    }
}

/// LeadingLight's configuration, written in one rename unless it is already exactly in place.
fn write_config(layout: &Layout, config: &str) -> std::io::Result<()> {
    let path = layout.config_file();
    if read_bounded(&path, MAX_CONFIG_BYTES).as_deref() == Some(config.as_bytes()) {
        return Ok(());
    }
    let mut file = NamedTempFile::new_in(layout.codex_home())?;
    file.write_all(config.as_bytes())?;
    file.as_file().sync_all()?;
    file.persist(&path).map(drop).map_err(|error| error.error)
}

/// The verified binary and the prepared folders: what a start needs.
#[derive(Clone)]
struct Ready {
    binary: Pinned,
    layout: Layout,
}

pub(crate) struct Codex {
    root: PathBuf,
    settings: Settings,
    state: Mutex<State>,
}

impl Codex {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self::with(root, Settings::app(dirs::home_dir()))
    }

    pub(crate) fn with(root: PathBuf, settings: Settings) -> Self {
        Self {
            root,
            settings,
            state: Mutex::new(State {
                discovery: None,
                account: Account::Unknown,
                breached: false,
                contaminated: false,
                unproven_end: false,
                unresolved_cancel: false,
                sign_in: None,
                revision: 0,
                epoch: 0,
                last: None,
                sign_outs: 0,
                #[cfg(test)]
                spawns: 0,
                #[cfg(test)]
                last_stop: None,
                #[cfg(test)]
                last_group_gone: None,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Looks for the pinned binary once, and again whenever the verified file has changed. Files
    /// are measured and hashed, never run.
    fn discovery(&self) -> Discovery {
        let known = self.lock().discovery.clone();
        match known {
            Some(Discovery::Pinned(binary)) if !binary.unchanged() => {}
            Some(found) => return found,
            None => {}
        }
        let found = process::discover(&self.settings.candidates, &self.settings.pin);
        self.lock().discovery = Some(found.clone());
        found
    }

    /// The pinned binary and the private folders, if nothing has crossed the boundary since.
    fn usable(&self) -> Result<Ready, ProviderState> {
        let binary = match self.discovery() {
            Discovery::Missing => return Err(unavailable(UnavailableReason::NotInstalled, false)),
            Discovery::Unpinned => {
                return Err(unavailable(UnavailableReason::UnsupportedVersion, false))
            }
            Discovery::Pinned(binary) => binary,
        };
        if self.lock().breached {
            return Err(unavailable(UnavailableReason::Unqualified, true));
        }
        match Layout::prepare(&self.root) {
            Ok(layout) => Ok(Ready { binary, layout }),
            Err(_) => Err(unavailable(UnavailableReason::StorageUnavailable, true)),
        }
    }

    fn config(&self, layout: &Layout) -> String {
        let provider = self.settings.provider.as_ref().map(|provider| {
            (
                provider.id.as_str(),
                provider.base_url.as_str(),
                provider.env_key.as_str(),
            )
        });
        controls::config_toml(
            &self.settings.model,
            &layout.codex_home(),
            &layout.run(),
            provider,
        )
    }

    /// Puts LeadingLight's configuration in place, then checks the private folders. Remembers
    /// whether they failed.
    fn preflight(&self, ready: &Ready) -> Vec<String> {
        let config = self.config(&ready.layout);
        let mut problems = Vec::new();
        if let Err(error) = write_config(&ready.layout, &config) {
            problems.push(format!("config.toml could not be written: {error}"));
        }
        let expected = Expected {
            layout: &ready.layout,
            config: &config,
            binary: &ready.binary.path,
            binary_id: ready.binary.id,
            boundary: self.settings.boundary.as_deref(),
            managed: &self.settings.managed,
        };
        problems.extend(guard::preflight(&expected));
        self.lock().contaminated = !problems.is_empty();
        problems
    }

    /// Starts an app-server, only from the unchanged verified binary and only once the folders
    /// pass the preflight.
    fn spawn(&self, ready: &Ready) -> Option<(Process, Connection)> {
        if !ready.binary.unchanged() {
            self.lock().discovery = None;
            return None;
        }
        let problems = self.preflight(ready);
        if let Some(first) = problems.first() {
            log::warn!(
                "Codex was not started for Adapt: {first} ({} problems)",
                problems.len()
            );
            return None;
        }
        let command = process::command(
            &ready.binary.path,
            &ready.layout,
            &controls::app_server_args(),
            &self.settings.extra_env,
        );
        #[cfg(test)]
        {
            self.lock().spawns += 1;
        }
        let (process, stdin, stdout) = Process::spawn(command).ok()?;
        Some((process, Connection::new(stdout, stdin)))
    }

    /// Ends a process. One whose group cannot be proven gone leaves Codex unqualified, and every
    /// later cancel and sign-out unconfirmed, until the app restarts, however the caller goes on.
    fn end(&self, process: &mut Process) -> bool {
        let gone = process.end();
        if !gone {
            log::warn!("A Codex process group for Adapt could not be proven gone");
            let mut state = self.lock();
            state.breached = true;
            state.unproven_end = true;
        }
        gone
    }

    /// Starts an app-server and initializes it.
    fn open(&self, ready: &Ready) -> Option<(Process, Connection)> {
        let (mut process, mut connection) = self.spawn(ready)?;
        if session::initialize(&mut connection, Instant::now() + SETUP_TIMEOUT, &|| false).is_err()
        {
            self.end(&mut process);
            return None;
        }
        Some((process, connection))
    }

    /// Whether the private home holds a sign-in at all; nothing is started without one. Stops as
    /// soon as `cancelled` says so.
    fn read_account(&self, ready: &Ready, cancelled: &dyn Fn() -> bool) -> Account {
        if !ready.layout.auth_file().exists() {
            return Account::SignedOut(None);
        }
        let Some((mut process, mut connection)) = self.open(ready) else {
            return Account::Failed;
        };
        let deadline = Instant::now() + SETUP_TIMEOUT;
        let account = session::read_account(&mut connection, deadline, cancelled);
        self.end(&mut process);
        match account {
            Ok(AccountKind::SignedOut) => Account::SignedOut(None),
            Ok(AccountKind::ChatGpt) => Account::Connected,
            Ok(AccountKind::Other) => Account::Refused,
            Err(_) => Account::Failed,
        }
    }

    fn status(&self, ready: &Ready) -> ProviderState {
        let contaminated = self.lock().contaminated;
        if contaminated && !self.preflight(ready).is_empty() {
            return unavailable(UnavailableReason::Unqualified, true);
        }
        {
            let mut state = self.lock();
            if state.account == Account::Unknown && cancelled_marker(&ready.layout).exists() {
                // Cancelled in an earlier run, and its credential could not be removed then.
                state.account = Account::Blocked;
                state.unresolved_cancel = true;
            }
            retry_blocked(&mut state, &ready.layout);
        }
        if self.lock().account == Account::Unknown {
            let account = self.read_account(ready, &|| false);
            let mut state = self.lock();
            if state.account == Account::Unknown && !state.contaminated {
                state.account = account;
            }
        }
        let state = self.lock();
        if state.contaminated {
            return unavailable(UnavailableReason::Unqualified, true);
        }
        state_for(state.account)
    }

    /// Records what one turn showed about the provider and answers its outcome. `group_gone`: its
    /// process group was proven gone and reaped. Without that proof the outcome is `Unconfirmed`,
    /// whatever the turn itself ended with, and Codex stays unqualified until the app restarts.
    fn settle(&self, end: TurnEnd, group_gone: bool) -> TurnOutcome {
        let TurnEnd {
            outcome,
            verdict,
            stop,
        } = end;
        let mut state = self.lock();
        match verdict {
            Verdict::Clean => {}
            Verdict::Contaminated => state.contaminated = true,
            Verdict::Breach => state.breached = true,
        }
        let outcome = if group_gone {
            outcome
        } else {
            state.breached = true;
            state.unproven_end = true;
            TurnOutcome::Unconfirmed
        };
        if outcome == failed(Failure::NotConnected) && state.account == Account::Connected {
            // The provider refused this sign-in. It is signed out, but no other account signed
            // in, so the account epoch stays: this turn keeps `notConnected`. A later Connect starts
            // a new epoch.
            state.account = Account::SignedOut(None);
        }
        let stop = stop.map(|mut record| {
            record.group_gone = group_gone;
            record
        });
        if let Some(record) = &stop {
            log::info!("An Adapt turn was stopped: {}", record.summary());
        }
        #[cfg(test)]
        {
            state.last_stop = stop;
            state.last_group_gone = Some(group_gone);
        }
        outcome
    }

    /// The sign-in thread: waits for the provider's own sign-in to finish, then reads the account.
    /// A sign-out begun meanwhile wins: the sign-in then ends signed out.
    fn finish_sign_in(
        self: Arc<Self>,
        mut process: Process,
        mut connection: Connection,
        login_id: String,
        sign_in: Arc<SignIn>,
        ready: Ready,
        sign_outs: u64,
    ) {
        let cancelled = || sign_in.cancel.load(Ordering::SeqCst);
        let deadline = Instant::now() + SIGN_IN_TIMEOUT;
        let completed = session::await_login(&mut connection, &login_id, deadline, &cancelled);
        let login_ended = self.end(&mut process);
        let read = || self.read_account(&ready, &cancelled);
        let (account, discard) = self.sign_in_result(completed, login_ended, cancelled(), &read);
        self.publish_sign_in(&sign_in, sign_outs, account, discard, &ready.layout);
    }

    /// What a finished sign-in ends as, and whether what it stored is to be discarded. No account
    /// is read after a sign-in process whose group was not proven gone, and anything stored while
    /// any group is unproven is discarded rather than used.
    fn sign_in_result(
        &self,
        completed: Result<bool, Halt>,
        login_ended: bool,
        cancelled: bool,
        read: &dyn Fn() -> Account,
    ) -> (Account, bool) {
        let failed = Account::SignedOut(Some(LastConnect::Failed));
        let account = match completed {
            Ok(true) if cancelled => Account::SignedOut(Some(LastConnect::Cancelled)),
            Ok(true) if !login_ended => failed,
            Ok(true) => match read() {
                Account::Connected => Account::Connected,
                Account::Refused => Account::Refused,
                _ => failed,
            },
            Ok(false) | Err(Halt::Failed | Halt::TimedOut) => failed,
            Err(Halt::Breach) => {
                self.lock().breached = true;
                failed
            }
            Err(Halt::Cancelled) => Account::SignedOut(Some(LastConnect::Cancelled)),
        };
        let discard = completed == Ok(true) && self.lock().unproven_end;
        if discard && matches!(account, Account::Connected | Account::Refused) {
            (failed, true)
        } else {
            (account, discard)
        }
    }

    /// Ends exactly this sign-in with `account`, unless a cancel or a sign-out came first. Both are
    /// decided under the state lock, where a cancel is also recorded, so a sign-in that was
    /// cancelled can never be published as connected, however late its own result arrives.
    ///
    /// Whatever a cancelled or discarded sign-in stored is removed. If that fails, the credential
    /// is blocked: never read or used again. The sign-in's end records whether all of its cleanup
    /// was proven, separately from its worker having ended. A sign-in that is no longer the
    /// current one changes nothing.
    fn publish_sign_in(
        &self,
        sign_in: &SignIn,
        sign_outs: u64,
        account: Account,
        discard: bool,
        layout: &Layout,
    ) {
        let mut state = self.lock();
        let current = state
            .sign_in
            .as_ref()
            .is_some_and(|current| std::ptr::eq(current.as_ref(), sign_in));
        if !current {
            let proven = !state.unproven_end;
            drop(state);
            sign_in.finish(proven);
            return;
        }
        let cancelled = sign_in.cancel.load(Ordering::SeqCst) || state.sign_outs != sign_outs;
        let account = if cancelled {
            Account::SignedOut(Some(LastConnect::Cancelled))
        } else {
            account
        };
        if (cancelled || discard) && !remove_sign_in(layout) {
            block(&mut state, layout);
        } else {
            apply_account(&mut state, account);
        }
        state.sign_in = None;
        let proven = !state.unproven_end && state.account != Account::Blocked;
        if cancelled {
            state.unresolved_cancel = !proven;
        }
        drop(state);
        sign_in.finish(proven);
    }

    fn connect_with(self: &Arc<Self>, open_browser: &dyn Fn(&str) -> bool) -> ConnectReply {
        let refused = |reason| ConnectReply::Refused { reason };
        let Ok(ready) = self.usable() else {
            return refused(ConnectRefusal::Unavailable);
        };
        let (sign_in, sign_outs) = {
            let mut state = self.lock();
            if state.contaminated {
                return refused(ConnectRefusal::Unavailable);
            }
            // An earlier sign-in still ending holds the provider's sign-in; one at a time.
            if state.sign_in.is_some() {
                return refused(ConnectRefusal::Busy);
            }
            match state.account {
                Account::Connecting => return refused(ConnectRefusal::Busy),
                Account::Connected | Account::Refused => {
                    return refused(ConnectRefusal::AlreadyConnected)
                }
                // A cancelled credential still to be removed: a new sign-in could be removed with it.
                Account::Blocked => return refused(ConnectRefusal::Unavailable),
                _ => {}
            }
            let sign_in = Arc::new(SignIn::new());
            state.account = Account::Connecting;
            state.sign_in = Some(Arc::clone(&sign_in));
            (sign_in, state.sign_outs)
        };
        let layout = ready.layout.clone();
        let abandon = |last| {
            let account = Account::SignedOut(last);
            self.publish_sign_in(&sign_in, sign_outs, account, false, &layout);
        };
        let Some((mut process, mut connection)) = self.open(&ready) else {
            abandon(Some(LastConnect::Failed));
            return refused(ConnectRefusal::Unavailable);
        };
        let started = session::start_login(&mut connection, Instant::now() + SETUP_TIMEOUT);
        let Ok((login_id, auth_url)) = started else {
            self.end(&mut process);
            abandon(Some(LastConnect::Failed));
            return refused(ConnectRefusal::Unavailable);
        };
        if !auth_url.starts_with(controls::SIGN_IN_ORIGIN) {
            self.end(&mut process);
            self.lock().breached = true;
            abandon(Some(LastConnect::Failed));
            return refused(ConnectRefusal::Unavailable);
        }
        let cancel = || true;
        if sign_in.cancel.load(Ordering::SeqCst) {
            // Cancelled while it was being set up: the browser is never opened, and it ends
            // signed out like any cancelled sign-in.
            let _ = session::await_login(&mut connection, &login_id, Instant::now(), &cancel);
            self.end(&mut process);
            abandon(Some(LastConnect::Cancelled));
            return ConnectReply::Started;
        }
        if !open_browser(&auth_url) {
            let _ = session::await_login(&mut connection, &login_id, Instant::now(), &cancel);
            self.end(&mut process);
            abandon(None);
            return refused(ConnectRefusal::BrowserUnavailable);
        }
        let host = Arc::clone(self);
        let waiting = Arc::clone(&sign_in);
        let spawned = std::thread::Builder::new()
            .name("leadinglight-adapt-sign-in".to_string())
            .spawn(move || {
                host.finish_sign_in(process, connection, login_id, waiting, ready, sign_outs);
            });
        if spawned.is_err() {
            abandon(Some(LastConnect::Failed));
            return refused(ConnectRefusal::Unavailable);
        }
        ConnectReply::Started
    }

    /// Cancels the sign-in in progress: `None` if there is none, otherwise whether it ended within
    /// the wait with all of its cleanup proven. Either way it can no longer connect.
    fn cancel_sign_in(&self) -> Option<bool> {
        let sign_in = {
            let mut state = self.lock();
            let sign_in = state.sign_in.clone()?;
            sign_in.cancel.store(true, Ordering::SeqCst);
            state.unresolved_cancel = true;
            sign_in
        };
        let proven = sign_in.wait(CANCEL_SIGN_IN_WAIT);
        if proven.is_none() {
            log::info!("A cancelled Codex sign-in is still ending; it can only end signed out");
        }
        Some(proven == Some(true))
    }

    /// With no sign-in in progress: `None` if no earlier cancellation is unresolved, otherwise
    /// whether it now is (its credential removed and no process group unproven).
    fn resolve_cancel(&self) -> Option<bool> {
        let layout = Layout::prepare(&self.root).ok();
        let mut state = self.lock();
        if !state.unresolved_cancel {
            return None;
        }
        if let Some(layout) = &layout {
            retry_blocked(&mut state, layout);
        }
        let resolved = state.account != Account::Blocked && !state.unproven_end;
        state.unresolved_cancel = !resolved;
        Some(resolved)
    }
}

/// What the offline qualification and the unit tests look at. None of it exists in the app.
#[cfg(test)]
impl Codex {
    /// The app's controls, with these install locations and this pin.
    pub(crate) fn for_test(root: PathBuf, candidates: Vec<PathBuf>, pin: Pin) -> Self {
        let settings = Settings {
            candidates,
            pin,
            boundary: None,
            managed: Vec::new(),
            model: controls::MODEL.to_string(),
            provider: None,
            extra_env: Vec::new(),
        };
        Self::with(root, settings)
    }

    /// As if the person had signed in. Only the loopback fixture is ever reached.
    pub(crate) fn assume_connected(&self) {
        apply_account(&mut self.lock(), Account::Connected);
    }

    pub(crate) fn spawns(&self) -> u64 {
        self.lock().spawns
    }

    pub(crate) fn last_stop(&self) -> Option<session::StopRecord> {
        self.lock().last_stop.clone()
    }

    pub(crate) fn last_group_gone(&self) -> Option<bool> {
        self.lock().last_group_gone
    }

    pub(crate) fn settle_for_test(&self, end: TurnEnd, group_gone: bool) -> TurnOutcome {
        self.settle(end, group_gone)
    }

    /// A sign-in in progress, as `connect` leaves it once the browser is open.
    pub(crate) fn begin_sign_in_for_test(&self) -> PendingSignIn {
        let mut state = self.lock();
        let sign_in = Arc::new(SignIn::new());
        state.account = Account::Connecting;
        state.sign_in = Some(Arc::clone(&sign_in));
        PendingSignIn {
            sign_in,
            sign_outs: state.sign_outs,
        }
    }

    /// What `Codex::end` records when a process group cannot be proven gone.
    pub(crate) fn record_unproven_end_for_test(&self) {
        let mut state = self.lock();
        state.breached = true;
        state.unproven_end = true;
    }

    /// The end of the sign-in thread after a successful login, through the same decision and
    /// publication: `login_ended` says whether the login process group was proven gone (if not,
    /// it is recorded as `Codex::end` would), and `connected` is what the account read answers.
    pub(crate) fn finish_sign_in_for_test(
        &self,
        pending: &PendingSignIn,
        login_ended: bool,
        connected: bool,
    ) {
        if !login_ended {
            self.record_unproven_end_for_test();
        }
        let layout = Layout::prepare(&self.root).expect("the private folders");
        let cancelled = pending.sign_in.cancel.load(Ordering::SeqCst);
        let read = || {
            if connected {
                Account::Connected
            } else {
                Account::SignedOut(Some(LastConnect::Failed))
            }
        };
        let (account, discard) = self.sign_in_result(Ok(true), login_ended, cancelled, &read);
        self.publish_sign_in(
            &pending.sign_in,
            pending.sign_outs,
            account,
            discard,
            &layout,
        );
    }
}

#[cfg(test)]
pub(crate) struct PendingSignIn {
    sign_in: Arc<SignIn>,
    sign_outs: u64,
}

/// `Provider` is implemented on the shared handle, so a sign-in can finish on its own thread.
pub(crate) struct CodexProvider(pub(crate) Arc<Codex>);

impl Provider for CodexProvider {
    fn snapshot(&self) -> ProviderSnapshot {
        let codex = &self.0;
        let state = match codex.usable() {
            Err(unavailable) => unavailable,
            Ok(ready) => codex.status(&ready),
        };
        let mut guard = codex.lock();
        if guard.last.as_ref() != Some(&state) {
            guard.revision += 1;
            guard.last = Some(state.clone());
        }
        ProviderSnapshot {
            revision: guard.revision,
            state,
            account_epoch: guard.epoch,
        }
    }

    fn connect(&self, open_browser: &dyn Fn(&str) -> bool) -> ConnectReply {
        self.0.connect_with(open_browser)
    }

    /// The cancel is recorded under the lock the sign-in's publication checks, so it can no longer
    /// connect, and its account read stops at once.
    ///
    /// - `cancelled`: it ended within the wait and all of its cleanup was proven, including
    ///   removing anything it stored.
    /// - `unconfirmed`: it has not ended yet, a credential it stored could not be removed, or
    ///   some process group is unproven.
    /// - `notConnecting`: nothing is in progress and no earlier cancellation is unresolved.
    ///
    /// An unresolved earlier cancellation is tried again: `cancelled` once it is resolved.
    fn cancel_connect(&self) -> CancelConnectReply {
        let codex = &self.0;
        let proven = match codex.cancel_sign_in() {
            Some(proven) => proven,
            None => match codex.resolve_cancel() {
                None => return CancelConnectReply::NotConnecting,
                Some(resolved) => resolved,
            },
        };
        if proven {
            CancelConnectReply::Cancelled
        } else {
            CancelConnectReply::Unconfirmed
        }
    }

    /// Signs out of LeadingLight's private sign-in. `stopping` when it is signed out but a sign-in
    /// has not ended, or some process group, at any time since the app started, could not be
    /// proven gone. Codex left unqualified at run time, or holding a blocked credential, still
    /// signs out locally, starting nothing. `failed` if the credential could not be removed.
    fn disconnect(&self) -> DisconnectReply {
        let codex = &self.0;
        let ready = match codex.usable() {
            Ok(ready) => Some(ready),
            Err(ProviderState::Unavailable {
                reason: UnavailableReason::Unqualified,
                ..
            }) => None,
            Err(_) => {
                return DisconnectReply::Refused {
                    reason: DisconnectRefusal::Unavailable,
                }
            }
        };
        let layout = match &ready {
            Some(ready) => ready.layout.clone(),
            None => match Layout::prepare(&codex.root) {
                Ok(layout) => layout,
                Err(_) => {
                    return DisconnectReply::Refused {
                        reason: DisconnectRefusal::Failed,
                    }
                }
            },
        };
        codex.lock().sign_outs += 1;
        let mut proven = codex.cancel_sign_in() != Some(false);
        // A blocked credential is never used, not even to sign out with.
        let blocked = codex.lock().account == Account::Blocked;
        if let Some(ready) = ready.as_ref().filter(|_| !blocked) {
            if let Some((mut process, mut connection)) = codex.open(ready) {
                let _ = session::logout(&mut connection, Instant::now() + SETUP_TIMEOUT);
                proven &= codex.end(&mut process);
            }
        }
        // The private sign-in is gone either way, or this is not a sign-out.
        if !remove_sign_in(&layout) {
            return DisconnectReply::Refused {
                reason: DisconnectRefusal::Failed,
            };
        }
        let mut state = codex.lock();
        apply_account(&mut state, Account::SignedOut(None));
        state.unresolved_cancel = state.unproven_end;
        let proven = proven && !state.unproven_end;
        drop(state);
        if proven {
            DisconnectReply::Disconnected
        } else {
            DisconnectReply::Stopping
        }
    }

    fn run_turn(&self, payload: &Payload, control: &TurnControl) -> TurnOutcome {
        let codex = &self.0;
        let Ok(ready) = codex.usable() else {
            return failed(Failure::ProviderFailed);
        };
        if codex.lock().account != Account::Connected {
            return failed(Failure::NotConnected);
        }
        let Some((mut process, mut connection)) = codex.spawn(&ready) else {
            return failed(Failure::ProviderFailed);
        };
        let run = ready.layout.run();
        let model_provider = codex.settings.model_provider();
        let expect = Expect {
            run_dir: &run,
            model_provider,
        };
        let admit = |reported: &Reported| {
            let mut problems = guard::gate(reported, &ready.layout, model_provider);
            problems.extend(codex.preflight(&ready));
            problems
        };
        let deadline = Instant::now() + TURN_TIMEOUT;
        let end = session::run_turn(&mut connection, payload, &expect, &admit, control, deadline);
        let group_gone = codex.end(&mut process);
        drop(connection);
        codex.settle(end, group_gone)
    }

    fn shutdown(&self) {
        if let Some(sign_in) = self.0.lock().sign_in.clone() {
            sign_in.cancel.store(true, Ordering::SeqCst);
        }
    }
}
