//! M6 workspace backup, inspection and restore. Starts answer at once; the work runs on its
//! own thread and the UI polls `get_backup_operation`. `Err` only means bad arguments.

use super::blocking::run_blocking;
use super::vault::{registered_workspace_roots, VaultBoundary};
use crate::leadinglight_backup::{
    self as backup, CancelAnswer, OperationState, StartAnswer, StartRefusal,
};

#[tauri::command]
pub async fn start_workspace_backup(
    operation_id: String,
    vault_path: String,
    destination: String,
) -> Result<StartAnswer, String> {
    run_blocking(move || {
        backup::start_backup(&operation_id, &[&vault_path, &destination], || {
            let roots = VaultBoundary::from_request(Some(&vault_path))
                .map_err(|_| StartRefusal::NotWorkspace)?
                .roots();
            let known = registered_workspace_roots().map_err(|_| StartRefusal::Unavailable)?;
            backup::prepare_backup(roots, &destination, known)
        })
    })
    .await
}

#[tauri::command]
pub async fn start_backup_inspection(
    operation_id: String,
    backup_path: String,
) -> Result<StartAnswer, String> {
    run_blocking(move || backup::start_inspect(&operation_id, &backup_path)).await
}

#[tauri::command]
pub async fn start_backup_restore(
    operation_id: String,
    backup_path: String,
    manifest_sha256: String,
    parent: String,
    name: String,
) -> Result<StartAnswer, String> {
    run_blocking(move || {
        let args = [
            backup_path.as_str(),
            manifest_sha256.as_str(),
            parent.as_str(),
            name.as_str(),
        ];
        backup::start_restore(&operation_id, &args, || {
            let known = registered_workspace_roots().map_err(|_| StartRefusal::Unavailable)?;
            backup::prepare_restore(&backup_path, &manifest_sha256, &parent, &name, &known)
        })
    })
    .await
}

#[tauri::command]
pub async fn get_backup_operation(operation_id: String) -> Result<OperationState, String> {
    run_blocking(move || backup::state(&operation_id)).await
}

#[tauri::command]
pub async fn cancel_backup_operation(operation_id: String) -> Result<CancelAnswer, String> {
    run_blocking(move || backup::cancel(&operation_id)).await
}
