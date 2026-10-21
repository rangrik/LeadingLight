//! The narrow seam between the host and one provider. The host owns visits, conversations, turn
//! admission and storage; a provider only reports its own state, runs its own sign-in, and turns one
//! payload into one outcome. Tests replace it with a scripted provider.

use std::sync::atomic::{AtomicBool, Ordering};

use super::prompt::Payload;
use super::wire::{
    CancelConnectReply, ConnectReply, DisconnectReply, Failure, ProviderState, Reply, TurnPhase,
};

/// A provider's state, with a revision that only increases while the process runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderSnapshot {
    pub(crate) revision: u64,
    pub(crate) state: ProviderState,
    /// Changes whenever the signed-in account may have changed. A turn that ends under another
    /// epoch than it started with never delivers an answer; a failure it reports keeps its own
    /// reason, so marking the provider signed out because the turn itself was refused is fine.
    pub(crate) account_epoch: u64,
}

/// How one turn ended at the provider. Every outcome but `Unconfirmed` promises that all of the
/// provider's work for the turn is proven ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TurnOutcome {
    Reply(Reply),
    Failed {
        reason: Failure,
        resets_at: Option<String>,
    },
    /// It ended because the host cancelled it.
    Stopped,
    /// The provider cannot prove that all of its work for the turn ended (for example, its process
    /// group could not be killed and reaped). Whatever the turn produced is discarded: the host keeps
    /// the turn open as stopping, admits nothing from it and starts nothing else in its
    /// conversation until LeadingLight restarts.
    Unconfirmed,
}

/// The host's handle on one running turn: cancellation one way, host-known phases the other. A
/// provider returns any outcome but `Unconfirmed` only once all of its work for the turn is proven
/// ended, so the host can confirm a stop.
pub(crate) struct TurnControl {
    cancelled: AtomicBool,
    report: Box<dyn Fn(TurnPhase) + Send + Sync>,
}

impl TurnControl {
    pub(crate) fn new(report: Box<dyn Fn(TurnPhase) + Send + Sync>) -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            report,
        }
    }

    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Only phases the provider actually reached; the host ignores them once the turn is stopping.
    pub(crate) fn report(&self, phase: TurnPhase) {
        (self.report)(phase);
    }
}

pub(crate) trait Provider: Send + Sync {
    /// Never starts a sign-in and never sends anything.
    fn snapshot(&self) -> ProviderSnapshot;
    /// Starts the provider's own sign-in; `open_browser` opens its URL in the system browser.
    fn connect(&self, open_browser: &dyn Fn(&str) -> bool) -> ConnectReply;
    fn cancel_connect(&self) -> CancelConnectReply;
    fn disconnect(&self) -> DisconnectReply;
    /// Sends exactly `payload` and answers how the turn ended. Called on its own thread. Answers
    /// `Unconfirmed` whenever it cannot prove all of its work ended, whatever else happened.
    fn run_turn(&self, payload: &Payload, control: &TurnControl) -> TurnOutcome;
    /// The app is quitting: end any sign-in in progress without waiting long.
    fn shutdown(&self) {}
}
