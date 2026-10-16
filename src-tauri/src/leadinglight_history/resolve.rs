//! The two final dispositions. Discard never reads the page; keep-copy needs fresh proof that
//! this request's copy still holds the confirmed text.

use super::copy;
use super::lock::CopyLock;
use super::outcome::{ConfirmedSnapshot, OriginalRequest, ResolutionOutcome, ResolutionRefusal};
use super::registry::Action;
use super::{binding_digest, digest_of, is_sha256_hex, is_uuid, well_formed, VaultRoots, REGISTRY};

#[cfg(test)]
thread_local! {
    /// Test seam: runs after the copy is proven and before the resolution is recorded.
    pub(super) static AFTER_PROOF: std::cell::RefCell<Option<Box<dyn Fn()>>> =
        const { std::cell::RefCell::new(None) };
}

fn refused(reason: ResolutionRefusal) -> ResolutionOutcome {
    ResolutionOutcome::Refused { reason }
}

/// One action ID names one exact disposition of one exact snapshot.
fn action(
    request: &OriginalRequest,
    action_id: &str,
    confirmed: &ConfirmedSnapshot,
    operation_id: Option<&str>,
) -> Result<Action, ResolutionRefusal> {
    if !well_formed(request) {
        return Err(ResolutionRefusal::RequestMismatch);
    }
    if operation_id.is_some_and(|id| !is_uuid(id)) {
        return Err(ResolutionRefusal::OperationMismatch);
    }
    if !is_uuid(action_id) || !is_sha256_hex(&confirmed.content_sha256) {
        return Err(ResolutionRefusal::ActionMismatch);
    }
    let kind: &[u8] = if operation_id.is_some() {
        b"copy"
    } else {
        b"discard"
    };
    let digest = digest_of(&[
        kind,
        &binding_digest(request),
        &confirmed.seq.to_le_bytes(),
        confirmed.content_sha256.as_bytes(),
        operation_id.unwrap_or_default().as_bytes(),
    ]);
    Ok(Action {
        id: action_id.to_string(),
        digest,
    })
}

pub(crate) fn release_with_copy(
    request: &OriginalRequest,
    action_id: &str,
    confirmed: &ConfirmedSnapshot,
    operation_id: &str,
    roots: &VaultRoots,
) -> ResolutionOutcome {
    let action = match action(request, action_id, confirmed, Some(operation_id)) {
        Ok(action) => action,
        Err(reason) => return refused(reason),
    };
    let binding = binding_digest(request);
    if !REGISTRY.bind(request, binding) {
        return refused(ResolutionRefusal::RequestMismatch);
    }
    let Ok(lock) = CopyLock::acquire(&roots.canonical) else {
        return refused(ResolutionRefusal::Busy);
    };
    // The lock and the copy's claim last through recording, so nothing changes the copy between
    // its proof and the record.
    let claim = copy::verify(&lock, operation_id, &binding, confirmed, roots);
    #[cfg(test)]
    AFTER_PROOF.with_borrow(|hook| {
        if let Some(hook) = hook {
            hook();
        }
    });
    let proof = claim.as_ref().map(drop).map_err(|reason| *reason);
    REGISTRY.resolve(request, binding, &action, proof)
}

/// Works for unreadable, unsafe or outside pages: nothing on disk is read or written.
pub(crate) fn discard(
    request: &OriginalRequest,
    action_id: &str,
    confirmed: &ConfirmedSnapshot,
) -> ResolutionOutcome {
    match action(request, action_id, confirmed, None) {
        Ok(action) => REGISTRY.resolve(request, binding_digest(request), &action, Ok(())),
        Err(reason) => refused(reason),
    }
}
