//! E1 extension commands (`EXTENSION_COMMANDS` and `PROPOSAL_COMMANDS` in the frozen contract).
//! Each runs off the main thread and answers its expected cases as data; `Err` only means the
//! arguments could not be read or the local store could not be located. The calling window's
//! label is the owner of every session, run and operation; no command trusts an id alone.

use tauri::{State, WebviewWindow};

use super::blocking::run_blocking;
use super::vault::VaultBoundary;
use crate::leadinglight_extensions::wire::{
    ActivationReply, CloseSessionReply, DeactivationReply, DocumentHandleReply, EndRunReply,
    FolderHandleReply, GuardedProposal, ImportReply, ListReply, OpenSessionReply, ProposalReceipt,
    QueryReply, ReadReply, RunAdmission,
};
use crate::leadinglight_extensions::{BeginRequest, ExtensionsState};
use crate::leadinglight_history::VaultRoots;

/// A registered vault, resolved now; `None` answers `vaultUnavailable`.
fn vault_roots(vault_path: &str) -> Option<VaultRoots> {
    VaultBoundary::from_request(Some(vault_path))
        .ok()
        .map(|boundary| boundary.roots())
}

#[tauri::command]
pub async fn import_extension_candidate(
    state: State<'_, ExtensionsState>,
    package_text: String,
) -> Result<ImportReply, String> {
    let extensions = state.get()?;
    run_blocking(move || extensions.import(&package_text)).await
}

#[tauri::command]
pub async fn list_extensions(
    state: State<'_, ExtensionsState>,
    vault_path: String,
) -> Result<ListReply, String> {
    let extensions = state.get()?;
    run_blocking(move || extensions.list(vault_roots(&vault_path).as_ref())).await
}

#[tauri::command]
pub async fn read_extension_package(
    state: State<'_, ExtensionsState>,
    package_sha256: String,
) -> Result<ReadReply, String> {
    let extensions = state.get()?;
    run_blocking(move || extensions.read(&package_sha256)).await
}

#[tauri::command]
pub async fn activate_extension_version(
    state: State<'_, ExtensionsState>,
    vault_path: String,
    package_id: String,
    package_sha256: String,
    expected_active_sha256: Option<String>,
) -> Result<ActivationReply, String> {
    let extensions = state.get()?;
    run_blocking(move || {
        extensions.activate(
            vault_roots(&vault_path).as_ref(),
            &package_id,
            &package_sha256,
            expected_active_sha256.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn deactivate_extension(
    state: State<'_, ExtensionsState>,
    vault_path: String,
    package_id: String,
    expected_active_sha256: String,
) -> Result<DeactivationReply, String> {
    let extensions = state.get()?;
    run_blocking(move || {
        extensions.deactivate(
            vault_roots(&vault_path).as_ref(),
            &package_id,
            &expected_active_sha256,
        )
    })
    .await
}

#[tauri::command]
pub async fn open_extension_session(
    window: WebviewWindow,
    state: State<'_, ExtensionsState>,
    vault_path: String,
) -> Result<OpenSessionReply, String> {
    let extensions = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || extensions.open_session(&owner, vault_roots(&vault_path).as_ref())).await
}

#[tauri::command]
pub async fn close_extension_session(
    window: WebviewWindow,
    state: State<'_, ExtensionsState>,
    session_id: String,
) -> Result<CloseSessionReply, String> {
    let extensions = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || extensions.close_session(&owner, &session_id)).await
}

#[tauri::command]
pub async fn begin_extension_run(
    window: WebviewWindow,
    state: State<'_, ExtensionsState>,
    session_id: String,
    package_sha256: String,
    command_id: String,
    invocation_id: String,
) -> Result<RunAdmission, String> {
    let extensions = state.get()?;
    let owner = window.label().to_string();
    let request = BeginRequest {
        session_id,
        package_sha256,
        command_id,
        invocation_id,
    };
    run_blocking(move || extensions.begin_run(&owner, &request)).await
}

#[tauri::command]
pub async fn end_extension_run(
    window: WebviewWindow,
    state: State<'_, ExtensionsState>,
    session_id: String,
    invocation_id: String,
) -> Result<EndRunReply, String> {
    let extensions = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || extensions.end_run(&owner, &session_id, &invocation_id)).await
}

#[tauri::command]
pub async fn bind_extension_folder(
    window: WebviewWindow,
    state: State<'_, ExtensionsState>,
    run_id: String,
    folder: String,
) -> Result<FolderHandleReply, String> {
    let extensions = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || extensions.bind_folder(&owner, &run_id, &folder)).await
}

/// E1 binds no documents: always `unsupported`, reading nothing.
#[tauri::command]
pub async fn bind_extension_document(
    state: State<'_, ExtensionsState>,
    run_id: String,
    path: String,
) -> Result<DocumentHandleReply, String> {
    let _ = (run_id, path);
    Ok(state.get()?.bind_document())
}

/// Takes `{ proposal }`: the frozen `GuardedProposal`, read strictly.
#[tauri::command]
pub async fn submit_document_proposal(
    window: WebviewWindow,
    state: State<'_, ExtensionsState>,
    proposal: GuardedProposal,
) -> Result<ProposalReceipt, String> {
    let extensions = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || extensions.submit(&owner, &proposal)).await
}

/// Never applies or retries anything.
#[tauri::command]
pub async fn query_document_proposal(
    window: WebviewWindow,
    state: State<'_, ExtensionsState>,
    operation_id: String,
) -> Result<QueryReply, String> {
    let extensions = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || extensions.query(&owner, &operation_id)).await
}
