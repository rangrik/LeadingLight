//! Attempts, at most one per window. The owner is the calling window's label, which the command
//! takes from Tauri and never from arguments. An attempt is reserved while its request is
//! dispatched, before any task runs, and that reservation moves into the request's own task: at its
//! first poll it starts only if its own ticket still holds the window, so a cancel, a newer request
//! or a page load that came first stops it before any lookup. Tauri can dispatch a fetch after its
//! cancel was answered (out of order, or sent again after a failed reply), so each window also
//! remembers the ids stopped on its page. That record is bounded and never evicted: once it is
//! full, the window admits nothing until its page loads again. Completion and cancellation are
//! decided under one lock, so a result can only be delivered while its attempt is still its
//! window's current one.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use chrono::{SecondsFormat, Utc};
use futures_util::future::{AbortHandle, AbortRegistration, Abortable, Aborted};

use super::address::AddressPolicy;
use super::fetch::{Fetcher, Limits, Page, SystemLookup};
use super::wire::{AttemptId, CancelArgs, CancelReply, FailureReason, FetchArgs, FetchReply};

/// How many stopped attempt ids a window remembers for its page. Reaching it seals the window
/// instead of forgetting one, since a fetch dispatched late with a forgotten id could then run.
pub(super) const REVOKED_PER_PAGE: usize = 1024;

/// The rejection a sealed window's fetch gets; the dialog reads it as unavailable.
const SEALED: &str = "website fetch is paused in this window until its page loads again";

pub(crate) struct WebCapture {
    fetcher: Arc<Fetcher>,
    windows: Arc<Mutex<Windows>>,
}

/// One entry per window with an attempt reserved or running, or with ids stopped on its page.
#[derive(Default)]
struct Windows {
    next_ticket: u64,
    by_label: HashMap<String, Window>,
}

#[derive(Default)]
struct Window {
    active: Option<Active>,
    /// Ids cancelled or replaced on this page, never evicted; full means sealed.
    revoked: Vec<AttemptId>,
}

struct Active {
    attempt_id: AttemptId,
    /// The dispatch that reserved it. Tickets are never reused, so no other dispatch holds it.
    ticket: u64,
    abort: AbortHandle,
}

impl Window {
    fn is_revoked(&self, attempt_id: &AttemptId) -> bool {
        self.revoked.contains(attempt_id)
    }

    fn is_sealed(&self) -> bool {
        self.revoked.len() >= REVOKED_PER_PAGE
    }

    /// A sealed window admits nothing, so an id it can no longer record can never run either.
    fn revoke(&mut self, attempt_id: AttemptId) {
        if !self.is_sealed() && !self.is_revoked(&attempt_id) {
            self.revoked.push(attempt_id);
        }
    }
}

/// What one dispatched fetch was given.
pub(crate) enum Dispatch {
    /// This dispatch's own reservation.
    Run(Reservation),
    /// Its id was already stopped on this page: it answers `cancelled` and does nothing.
    Revoked(AttemptId),
    /// The window's record of stopped ids is full: nothing runs until its page loads again.
    Sealed,
}

/// One dispatch's reservation, carried by that request's own task. Only its ticket can start it.
pub(crate) struct Reservation {
    hold: Hold,
    fetcher: Arc<Fetcher>,
    attempt_id: AttemptId,
    url: String,
    registration: AbortRegistration,
}

impl WebCapture {
    /// The operating system resolver, the public-only policy and the production limits. Nothing
    /// starts until a fetch.
    pub(crate) fn new() -> Self {
        Self::with(Fetcher {
            policy: AddressPolicy::Public,
            lookup: Arc::new(SystemLookup),
            limits: Limits::PRODUCTION,
        })
    }

    fn with(fetcher: Fetcher) -> Self {
        Self {
            fetcher: Arc::new(fetcher),
            windows: Arc::default(),
        }
    }

    /// Called while a fetch request is dispatched, before any task runs. A fresh ticket replaces
    /// the window's attempt, reserved or running and whatever its id: the newest dispatch wins,
    /// and a replaced id stays stopped. An id already stopped on this page changes nothing.
    pub(crate) fn reserve(&self, owner: &str, args: FetchArgs) -> Dispatch {
        let FetchArgs { attempt_id, url } = args;
        let mut guard = self.lock();
        let windows = &mut *guard;
        if let Some(window) = windows.by_label.get(owner) {
            if window.is_revoked(&attempt_id) {
                return Dispatch::Revoked(attempt_id);
            }
            if window.is_sealed() {
                return Dispatch::Sealed;
            }
        }
        windows.next_ticket += 1;
        let ticket = windows.next_ticket;
        let (abort, registration) = AbortHandle::new_pair();
        let window = windows.by_label.entry(owner.to_owned()).or_default();
        let active = Active {
            attempt_id: attempt_id.clone(),
            ticket,
            abort,
        };
        if let Some(previous) = window.active.replace(active) {
            previous.abort.abort();
            if previous.attempt_id != attempt_id {
                window.revoke(previous.attempt_id);
            }
        }
        Dispatch::Run(Reservation {
            hold: Hold {
                windows: Arc::clone(&self.windows),
                owner: owner.to_owned(),
                ticket,
                finished: false,
            },
            fetcher: Arc::clone(&self.fetcher),
            attempt_id,
            url,
            registration,
        })
    }

    /// Stops the window's attempt when the id matches, and remembers the id either way, so a
    /// fetch with it dispatched later does not run. Only a matching attempt answers `cancelled`.
    pub(crate) fn cancel(&self, owner: &str, args: &CancelArgs) -> CancelReply {
        let attempt_id = args.attempt_id.clone();
        let mut windows = self.lock();
        let window = windows.by_label.entry(owner.to_owned()).or_default();
        let stopped = window
            .active
            .take_if(|active| active.attempt_id == attempt_id);
        let matches = stopped.is_some();
        if let Some(active) = stopped {
            active.abort.abort();
        }
        window.revoke(attempt_id.clone());
        if matches {
            CancelReply::Cancelled { attempt_id }
        } else {
            CancelReply::NotActive { attempt_id }
        }
    }

    /// The window's page is loading again or the window is gone: its attempt, reserved or
    /// running, replies `cancelled`, and its record of stopped ids goes with the page.
    pub(crate) fn forget_owner(&self, owner: &str) {
        let forgotten = self.lock().by_label.remove(owner);
        if let Some(Window {
            active: Some(active),
            ..
        }) = forgotten
        {
            active.abort.abort();
        }
    }

    fn lock(&self) -> MutexGuard<'_, Windows> {
        lock(&self.windows)
    }
}

impl Dispatch {
    /// The request's reply. Only `Run` does any work, and only from its first poll.
    pub(crate) async fn reply(self) -> Result<FetchReply, &'static str> {
        match self {
            Self::Run(reservation) => Ok(reservation.run().await),
            Self::Revoked(attempt_id) => Ok(FetchReply::Cancelled { attempt_id }),
            Self::Sealed => Err(SEALED),
        }
    }
}

impl Reservation {
    /// One whose ticket no longer holds its window (cancelled, replaced, or the page reloaded or
    /// closed first) answers `cancelled` and looks up and sends nothing.
    async fn run(self) -> FetchReply {
        let Self {
            hold,
            fetcher,
            attempt_id,
            url,
            registration,
        } = self;
        if !hold.is_current() {
            return FetchReply::Cancelled { attempt_id };
        }
        // Cancelling drops this future, closing any connection and body read. An abort that lands
        // after the check is seen before the fetch is first polled.
        let outcome = Abortable::new(fetcher.fetch(&url), registration).await;
        let current = hold.finish();
        settle(attempt_id, outcome, current)
    }
}

/// A dispatch's hold on its window's slot, by its own ticket. It frees the slot when the attempt
/// finishes or its future is dropped, and only while its ticket still holds it.
pub(super) struct Hold {
    windows: Arc<Mutex<Windows>>,
    owner: String,
    ticket: u64,
    finished: bool,
}

impl Hold {
    fn is_current(&self) -> bool {
        lock(&self.windows)
            .by_label
            .get(&self.owner)
            .and_then(|window| window.active.as_ref())
            .is_some_and(|active| active.ticket == self.ticket)
    }

    /// True when this attempt was still its window's current one, so its result may be delivered.
    pub(super) fn finish(mut self) -> bool {
        self.finished = true;
        release(&self.windows, &self.owner, self.ticket)
    }
}

impl Drop for Hold {
    fn drop(&mut self) {
        if !self.finished {
            release(&self.windows, &self.owner, self.ticket);
        }
    }
}

/// Frees the window's slot if this ticket still holds it; true when it did. A window left with
/// nothing to remember is dropped.
fn release(windows: &Mutex<Windows>, owner: &str, ticket: u64) -> bool {
    let mut windows = lock(windows);
    let Some(window) = windows.by_label.get_mut(owner) else {
        return false;
    };
    let current = window
        .active
        .as_ref()
        .is_some_and(|active| active.ticket == ticket);
    if current {
        window.active = None;
        if window.revoked.is_empty() {
            windows.by_label.remove(owner);
        }
    }
    current
}

fn lock(windows: &Mutex<Windows>) -> MutexGuard<'_, Windows> {
    windows.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A result reaches the window only if the attempt finished on its own and was still current.
pub(super) fn settle(
    attempt_id: AttemptId,
    outcome: Result<Result<Page, FailureReason>, Aborted>,
    current: bool,
) -> FetchReply {
    match outcome {
        Ok(Ok(page)) if current => FetchReply::Fetched {
            attempt_id,
            requested_url: page.requested_url.into(),
            final_url: page.final_url.into(),
            fetched_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            content_type: page.content_type,
            encoding: page.decoded.encoding.name(),
            encoding_source: page.decoded.source,
            html: page.decoded.html,
            had_replacements: page.decoded.had_replacements,
        },
        Ok(Err(reason)) if current => FetchReply::Failed { attempt_id, reason },
        _ => FetchReply::Cancelled { attempt_id },
    }
}

#[cfg(test)]
impl WebCapture {
    /// Dispatch and run in one step, for tests that do not exercise the dispatch boundary.
    pub(crate) async fn fetch(&self, owner: &str, args: FetchArgs) -> FetchReply {
        self.reserve(owner, args)
            .reply()
            .await
            .expect("the window is not sealed")
    }

    /// Any policy (including loopback), a table resolver and shortened limits.
    pub(crate) fn for_tests(
        policy: AddressPolicy,
        lookup: Arc<dyn super::fetch::Lookup>,
        limits: Limits,
    ) -> Self {
        Self::with(Fetcher {
            policy,
            lookup,
            limits,
        })
    }

    /// How many windows have an attempt reserved or running now.
    pub(crate) fn active_windows(&self) -> usize {
        self.lock()
            .by_label
            .values()
            .filter(|window| window.active.is_some())
            .count()
    }

    /// How many windows hold anything at all: an attempt, or ids stopped on their page.
    pub(crate) fn remembered_windows(&self) -> usize {
        self.lock().by_label.len()
    }

    /// How many stopped ids this window remembers for its page.
    pub(crate) fn revoked_in(&self, owner: &str) -> usize {
        self.lock()
            .by_label
            .get(owner)
            .map_or(0, |window| window.revoked.len())
    }
}

#[cfg(test)]
impl Reservation {
    /// The hold and abort registration alone, for tests that finish an attempt by hand.
    pub(super) fn into_parts(self) -> (Hold, AbortRegistration) {
        (self.hold, self.registration)
    }
}
