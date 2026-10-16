//! S0 save and recovery commands. Each runs off the main thread and answers its expected cases
//! as data; `Err` only means the arguments could not be read.

use super::blocking::run_blocking;
use super::vault::VaultBoundary;
use crate::leadinglight_history::outcome::{
    ConfirmedSnapshot, CopyOutcome, CopyRefusal, DraftSnapshot, OriginalRequest, ResolutionOutcome,
    ResolutionRefusal, SaveOutcome, SaveRequestState,
};
use crate::leadinglight_history::{self as history, VaultRoots};

fn vault_roots(request: &OriginalRequest) -> Option<VaultRoots> {
    VaultBoundary::from_request(Some(&request.vault_path))
        .ok()
        .map(|boundary| boundary.roots())
}

#[tauri::command]
pub async fn save_page_content(
    request: OriginalRequest,
    content: String,
) -> Result<SaveOutcome, String> {
    run_blocking(move || {
        let target = VaultBoundary::from_request(Some(&request.vault_path))
            .and_then(|boundary| boundary.page_target(&request.path))
            .ok();
        history::save_page(&request, &content, target.as_ref())
    })
    .await
}

#[tauri::command]
pub async fn check_save_outcome(request: OriginalRequest) -> Result<SaveRequestState, String> {
    run_blocking(move || history::check_save(&request, vault_roots(&request).as_ref())).await
}

#[tauri::command]
pub async fn save_draft_as_new_page(
    request: OriginalRequest,
    draft: DraftSnapshot,
    operation_id: String,
    folder: Option<String>,
) -> Result<CopyOutcome, String> {
    run_blocking(move || match vault_roots(&request) {
        Some(roots) => {
            history::copy_draft(&request, &draft, &operation_id, folder.as_deref(), &roots)
        }
        None => CopyOutcome::Refused {
            reason: CopyRefusal::OutsideVault,
        },
    })
    .await
}

/// An unavailable vault cannot prove the copy, so it answers `busy` and nothing changes.
#[tauri::command]
pub async fn release_hold_with_copy(
    request: OriginalRequest,
    action_id: String,
    confirmed: ConfirmedSnapshot,
    operation_id: String,
) -> Result<ResolutionOutcome, String> {
    run_blocking(move || match vault_roots(&request) {
        Some(roots) => {
            history::release_with_copy(&request, &action_id, &confirmed, &operation_id, &roots)
        }
        None => ResolutionOutcome::Refused {
            reason: ResolutionRefusal::Busy,
        },
    })
    .await
}

#[tauri::command]
pub async fn discard_hold(
    request: OriginalRequest,
    action_id: String,
    confirmed: ConfirmedSnapshot,
) -> Result<ResolutionOutcome, String> {
    run_blocking(move || history::discard(&request, &action_id, &confirmed)).await
}
