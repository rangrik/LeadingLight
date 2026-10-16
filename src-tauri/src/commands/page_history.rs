//! S0 save and recovery commands and S1a page history. Each runs off the main thread and answers
//! its expected cases as data; `Err` only means the arguments could not be read.

use super::blocking::run_blocking;
use super::vault::VaultBoundary;
use crate::leadinglight_history::history_outcome::{
    HealthState, HistoryHealth, HistoryRefusal, ListLocationsOutcome, ListVersionsOutcome,
    ReadVersionOutcome, VersionCopyOutcome, VersionCopyRefusal,
};
use crate::leadinglight_history::outcome::{
    ConfirmedSnapshot, CopyOutcome, CopyRefusal, DraftSnapshot, OriginalRequest, ResolutionOutcome,
    ResolutionRefusal, SaveOutcome, SaveRequestState,
};
use crate::leadinglight_history::{self as history, VaultRoots};

fn history_roots(vault_path: &str) -> Option<VaultRoots> {
    VaultBoundary::from_request(Some(vault_path))
        .ok()
        .map(|boundary| boundary.roots())
}

#[tauri::command]
pub async fn list_page_versions(
    vault_path: String,
    path: String,
    cursor: Option<String>,
) -> Result<ListVersionsOutcome, String> {
    run_blocking(move || {
        let page = VaultBoundary::from_request(Some(&vault_path))
            .and_then(|boundary| Ok((boundary.page_target(&path)?, boundary.roots())));
        match page {
            Ok((target, roots)) => history::list_versions(&roots, &target, cursor.as_deref()),
            Err(_) => ListVersionsOutcome::Refused {
                reason: HistoryRefusal::OutsideVault,
            },
        }
    })
    .await
}

#[tauri::command]
pub async fn list_saved_locations(
    vault_path: String,
    cursor: Option<String>,
) -> Result<ListLocationsOutcome, String> {
    run_blocking(move || match history_roots(&vault_path) {
        Some(roots) => history::list_locations(&roots, cursor.as_deref()),
        None => ListLocationsOutcome::Refused {
            reason: HistoryRefusal::OutsideVault,
        },
    })
    .await
}

#[tauri::command]
pub async fn read_page_version(
    vault_path: String,
    id: String,
    sha256: String,
) -> Result<ReadVersionOutcome, String> {
    run_blocking(move || match history_roots(&vault_path) {
        Some(roots) => history::read_version(&roots, &id, &sha256),
        None => ReadVersionOutcome::Refused {
            reason: HistoryRefusal::OutsideVault,
        },
    })
    .await
}

#[tauri::command]
pub async fn save_page_version_as_copy(
    vault_path: String,
    id: String,
    sha256: String,
    folder: Option<String>,
    operation_id: String,
) -> Result<VersionCopyOutcome, String> {
    run_blocking(move || match history_roots(&vault_path) {
        Some(roots) => {
            history::copy_version(&id, &sha256, folder.as_deref(), &operation_id, &roots)
        }
        None => VersionCopyOutcome::Refused {
            reason: VersionCopyRefusal::OutsideVault,
        },
    })
    .await
}

/// A vault that cannot be checked now answers `unknown`, which neither raises nor clears.
#[tauri::command]
pub async fn page_history_health(vault_path: String) -> Result<HistoryHealth, String> {
    run_blocking(move || match history_roots(&vault_path) {
        Some(roots) => history::history_health(&roots),
        None => HistoryHealth {
            state: HealthState::Unknown,
            reason: None,
            used_bytes: None,
            budget_bytes: 0,
            unreadable: 0,
            attention: Vec::new(),
        },
    })
    .await
}

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
