//! The ordinary save: inspect the page without following it, read it, stage beside it,
//! recheck the exact bytes, then publish once.

use std::fs;
use std::io::ErrorKind;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use super::outcome::{
    ConflictReason, FailedReason, HoldInfo, HoldKind, OriginalRequest, Refusal, SaveOutcome,
    SaveRequestState, Terminal,
};
use super::registry::{Admission, Digest, Hold, Lookup, Proof, Registry};
use super::{
    binding_digest, hex, page_key, remove_staging_folder, well_formed, PageTarget, VaultRoots,
    REGISTRY,
};
use crate::vault::staged_file::{
    self, file_identity, plain_file, sha256, Fingerprint, Mismatch, NativePlatform, Original,
    Platform, Published, Recheck,
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Holds {
    Keep,
    /// Legacy saves report holds as errors and never keep one.
    Never,
}

/// Test seam: runs after staging and before the exact recheck.
pub(super) trait Steps: Platform {
    fn after_stage(&self, _path: &Path) {}
}

impl Steps for NativePlatform {}

pub(crate) fn save_page(
    request: &OriginalRequest,
    content: &str,
    target: Option<&PageTarget>,
) -> SaveOutcome {
    save_with(
        &REGISTRY,
        &NativePlatform,
        request,
        content.as_bytes(),
        target,
        Holds::Keep,
    )
}

pub(super) fn save_with(
    registry: &Registry,
    platform: &impl Steps,
    request: &OriginalRequest,
    content: &[u8],
    target: Option<&PageTarget>,
    holds: Holds,
) -> SaveOutcome {
    let submitted = sha256(content);
    if !well_formed(request) || hex(&submitted) != request.submitted_sha256 {
        return SaveOutcome::refused(Refusal::RequestMismatch);
    }
    let binding = binding_digest(request);
    let Some(target) = target else {
        return registry.admit_unplaced(request, binding);
    };
    if let Admission::Answer(outcome) = registry.admit(request, binding, &target.key) {
        return outcome;
    }
    // A panic still finishes the record, so nothing stays running.
    let written = panic::catch_unwind(AssertUnwindSafe(|| {
        write(platform, request, content, target)
    }));
    let (outcome, hold) =
        written.unwrap_or_else(|_| uncertain(request, target, submitted, None, None));
    let hold = hold.filter(|_| holds == Holds::Keep);
    registry.finish(&request.request_id, outcome.clone(), hold);
    outcome
}

type Written = (SaveOutcome, Option<Hold>);

fn write(
    platform: &impl Steps,
    request: &OriginalRequest,
    content: &[u8],
    target: &PageTarget,
) -> Written {
    let path = &target.path;
    let refused = |refusal| (SaveOutcome::refused(refusal), None);
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let parent_exists = path
                .parent()
                .is_some_and(|parent| fs::symlink_metadata(parent).is_ok());
            return if parent_exists {
                held(request, HoldKind::Missing, |hold| Refusal::Missing { hold })
            } else {
                held(request, HoldKind::Missing, |hold| Refusal::ParentMissing {
                    hold,
                })
            };
        }
        Err(_) => return refused(Refusal::ReadFailed),
    };
    if meta.file_type().is_symlink() {
        return held(request, HoldKind::Linked, |hold| Refusal::Symlink { hold });
    }
    // A folder always has extra links, so it is checked before the hard-link test.
    if !meta.is_file() {
        return refused(Refusal::ReadFailed);
    }
    match plain_file(path) {
        Ok(_) => {}
        Err(Mismatch::Linked) => {
            return held(request, HoldKind::Linked, |hold| Refusal::Linked { hold })
        }
        Err(_) => return refused(Refusal::ReadFailed),
    }
    if meta.permissions().readonly() {
        return refused(Refusal::ReadOnly);
    }
    let Ok(original) = Original::read(path) else {
        return refused(Refusal::ReadFailed);
    };
    if original.bytes == content {
        return (committed(false, true), None);
    }
    let Ok((staging, staged)) = staged_file::stage(path, content) else {
        return refused(Refusal::StageFailed);
    };
    platform.after_stage(path);
    let fingerprint = original.fingerprint();
    match fingerprint.recheck() {
        Ok(()) => {}
        Err(Recheck::Unreadable) => return refused(Refusal::ReadFailed),
        Err(Recheck::Differs(_)) => {
            let hold = hold_for(request, HoldKind::Conflict, None);
            let outcome = SaveOutcome::Conflict {
                reason: ConflictReason::ChangedDuringSave,
                hold: hold.info(),
            };
            return (outcome, Some(hold));
        }
    }
    match staged_file::publish(&original, staging, &staged, platform) {
        Published::Committed { durable } => (committed(true, durable), None),
        Published::Failed => (
            SaveOutcome::Failed {
                reason: FailedReason::Publish,
            },
            None,
        ),
        Published::Uncertain {
            original_at,
            staged_at,
        } => uncertain(
            request,
            target,
            sha256(content),
            Some(fingerprint),
            Some((original_at, staged_at)),
        ),
    }
}

fn committed(written: bool, durable: bool) -> SaveOutcome {
    SaveOutcome::Committed {
        written,
        durable,
        history: None,
    }
}

fn hold_for(request: &OriginalRequest, kind: HoldKind, proof: Option<Proof>) -> Hold {
    Hold {
        request: request.clone(),
        kind,
        proof,
    }
}

fn held(
    request: &OriginalRequest,
    kind: HoldKind,
    refusal: impl FnOnce(HoldInfo) -> Refusal,
) -> Written {
    let hold = hold_for(request, kind, None);
    (SaveOutcome::refused(refusal(hold.info())), Some(hold))
}

fn uncertain(
    request: &OriginalRequest,
    target: &PageTarget,
    submitted: Digest,
    original: Option<Fingerprint>,
    kept: Option<(Option<PathBuf>, Option<PathBuf>)>,
) -> Written {
    let path = target.path.as_path();
    let (original_at, staged_at) = kept.unwrap_or((None, None));
    let shown = |at: &Option<PathBuf>| at.as_ref().map(|at| at.to_string_lossy().into_owned());
    let leftovers = [&staged_at, &original_at]
        .into_iter()
        .flatten()
        .filter(|at| at.as_path() != path)
        .map(|at| at.to_string_lossy().into_owned())
        .collect();
    let proof = Proof {
        path: path.to_path_buf(),
        key: target.key.clone(),
        submitted,
        original,
        staged: staged_at
            .as_ref()
            .and_then(|at| file_identity(at).map(|identity| (at.clone(), identity))),
        leftovers,
    };
    let hold = hold_for(request, HoldKind::Uncertain, Some(proof));
    let outcome = SaveOutcome::Uncertain {
        hold: hold.info(),
        original_at: shown(&original_at),
        staged_at: shown(&staged_at),
    };
    (outcome, Some(hold))
}

/// `roots` is the request's vault as registered now; without it nothing is re-proven.
pub(crate) fn check_save(
    request: &OriginalRequest,
    roots: Option<&VaultRoots>,
) -> SaveRequestState {
    check_with(&REGISTRY, request, roots)
}

pub(super) fn check_with(
    registry: &Registry,
    request: &OriginalRequest,
    roots: Option<&VaultRoots>,
) -> SaveRequestState {
    if !well_formed(request) {
        return SaveRequestState::Mismatch;
    }
    match registry.lookup(request, binding_digest(request)) {
        Lookup::State(state) => state,
        Lookup::Reprove(proof) => registry.settle(&request.request_id, reprove(&proof, roots)),
    }
}

/// `None` while neither the new nor the old bytes can be proven on disk. Nothing is read
/// unless the page's folder still resolves to the one checked at save time, inside the vault.
fn reprove(proof: &Proof, roots: Option<&VaultRoots>) -> Option<SaveOutcome> {
    let same_folder = roots.is_some_and(|roots| proof.key.starts_with(&roots.canonical))
        && page_key(&proof.path).as_ref() == Some(&proof.key);
    if !same_folder {
        return None;
    }
    let page_holds_submitted = plain_file(&proof.path).is_ok()
        && fs::read(&proof.path).is_ok_and(|bytes| sha256(&bytes) == proof.submitted);
    if page_holds_submitted {
        return Some(committed(true, false));
    }
    let unchanged = proof
        .original
        .as_ref()
        .is_some_and(|original| original.recheck().is_ok());
    if !unchanged {
        return None;
    }
    remove_staging(proof);
    Some(SaveOutcome::Failed {
        reason: FailedReason::Publish,
    })
}

/// Removes the kept staged copy only while it is still the file that was staged.
fn remove_staging(proof: &Proof) {
    let Some((staged, identity)) = &proof.staged else {
        return;
    };
    if file_identity(staged).as_ref() == Some(identity) && fs::remove_file(staged).is_ok() {
        remove_staging_folder(staged);
    }
}

/// The old command, now through the same pipeline with a private envelope and no hold.
pub(crate) fn legacy_save(target: &PageTarget, root: &str, content: &str) -> Result<(), String> {
    let request = OriginalRequest {
        request_id: uuid::Uuid::new_v4().hyphenated().to_string(),
        vault_path: root.to_string(),
        session: "legacy".to_string(),
        path: target.path.to_string_lossy().into_owned(),
        seq: 0,
        submitted_sha256: hex(&sha256(content.as_bytes())),
    };
    let outcome = save_with(
        &REGISTRY,
        &NativePlatform,
        &request,
        content.as_bytes(),
        Some(target),
        Holds::Never,
    );
    REGISTRY.forget(&request.request_id);
    match outcome {
        SaveOutcome::Committed { .. } => Ok(()),
        other => Err(legacy_error(&other)),
    }
}

fn legacy_error(outcome: &SaveOutcome) -> String {
    match outcome {
        SaveOutcome::Refused(refusal) => {
            let reason = serde_json::to_value(refusal).unwrap_or_default()["reason"].clone();
            format!("refused: {}", reason.as_str().unwrap_or("unknown"))
        }
        SaveOutcome::Uncertain { .. } => {
            "uncertain: the save could not be confirmed; recovery files were kept".to_string()
        }
        other => match other.terminal() {
            Terminal::Conflict => "conflict: changedDuringSave".to_string(),
            _ => "failed: publish".to_string(),
        },
    }
}
