use crate::leadinglight_history::lease;
use crate::leadinglight_trash::{
    self, LocalTrashItem, LocalTrashMoveReport, LocalTrashRestoreReport,
};
use crate::vault;
use std::path::PathBuf;

use super::vault::VaultBoundary;

#[tauri::command]
pub async fn batch_delete_notes_async(
    paths: Vec<String>,
    vault_path: Option<String>,
) -> Result<Vec<String>, String> {
    let boundary = VaultBoundary::from_request(vault_path.as_deref())?;
    let validated_paths = boundary.validate_existing_paths(&paths)?;
    crate::commands::blocking::run_blocking(move || {
        let _lease = lease(&validated_paths)?;
        vault::batch_delete_notes(&validated_paths)
    })
    .await?
}

/// Trash is per vault, so the vault is required rather than inferred.
fn local_trash_root(vault_path: &str) -> Result<PathBuf, String> {
    if vault_path.trim().is_empty() {
        return Err("Vault path is required".to_string());
    }
    let boundary = VaultBoundary::from_request(Some(vault_path))?;
    Ok(boundary.requested_root().to_path_buf())
}

#[tauri::command]
pub async fn move_to_local_trash(
    vault_path: String,
    paths: Vec<String>,
) -> Result<LocalTrashMoveReport, String> {
    let root = local_trash_root(&vault_path)?;
    crate::commands::blocking::run_blocking(move || {
        let targets: Vec<PathBuf> = paths.iter().map(|path| root.join(path)).collect();
        let _lease = lease(&targets)?;
        leadinglight_trash::move_to_trash(&root, &paths)
    })
    .await?
}

#[tauri::command]
pub async fn list_local_trash(vault_path: String) -> Result<Vec<LocalTrashItem>, String> {
    let root = local_trash_root(&vault_path)?;
    crate::commands::blocking::run_blocking(move || leadinglight_trash::list_trash(&root)).await?
}

#[tauri::command]
pub async fn restore_from_local_trash(
    vault_path: String,
    ids: Vec<String>,
) -> Result<LocalTrashRestoreReport, String> {
    let root = local_trash_root(&vault_path)?;
    crate::commands::blocking::run_blocking(move || {
        leadinglight_trash::restore_from_trash(&root, &ids)
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn batch_delete_notes_async_validates_and_deletes_inside_vault() {
        let dir = tempfile::TempDir::new().unwrap();
        let first = dir.path().join("first.md");
        let second = dir.path().join("nested/second.md");
        std::fs::create_dir_all(second.parent().unwrap()).unwrap();
        std::fs::write(&first, "# First\n").unwrap();
        std::fs::write(&second, "# Second\n").unwrap();

        let deleted = batch_delete_notes_async(
            vec![
                first.to_string_lossy().to_string(),
                "nested/second.md".to_string(),
            ],
            Some(dir.path().to_string_lossy().to_string()),
        )
        .await
        .unwrap();

        assert_eq!(deleted.len(), 2);
        assert!(!first.exists());
        assert!(!second.exists());
    }
}

#[cfg(test)]
mod leadinglight_trash_commands {
    use super::*;

    #[tokio::test]
    async fn commands_round_trip_and_serialize_the_published_contract() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_path = dir.path().to_string_lossy().to_string();
        let page = dir.path().join("Projects/plan.md");
        std::fs::create_dir_all(page.parent().unwrap()).unwrap();
        std::fs::write(&page, "# Plan\n").unwrap();

        let moved = move_to_local_trash(
            vault_path.clone(),
            vec![
                page.to_string_lossy().to_string(),
                "../outside.md".to_string(),
            ],
        )
        .await
        .unwrap();
        let moved = serde_json::to_value(moved).unwrap();
        assert_eq!(moved["moved"][0]["originalPath"], "Projects/plan.md");
        assert_eq!(moved["failed"][0]["code"], "outsideVault");

        let listed =
            serde_json::to_value(list_local_trash(vault_path.clone()).await.unwrap()).unwrap();
        assert_eq!(listed[0]["state"], "ready");
        assert_eq!(listed[0]["fileKind"], "markdown");
        assert!(listed[0]["restoredPath"].is_null());
        let id = listed[0]["id"].as_str().unwrap().to_string();

        let restored = restore_from_local_trash(vault_path, vec![id])
            .await
            .unwrap();
        let restored = serde_json::to_value(restored).unwrap();
        assert_eq!(restored["restored"][0]["relativePath"], "Projects/plan.md");
        assert_eq!(restored["restored"][0]["relocated"], false);
        assert_eq!(restored["restored"][0]["cleanupPending"], false);
        assert_eq!(std::fs::read_to_string(&page).unwrap(), "# Plan\n");
    }

    #[tokio::test]
    async fn commands_require_a_vault_path() {
        let error = list_local_trash("  ".to_string()).await.unwrap_err();
        assert_eq!(error, "Vault path is required");
    }
}
