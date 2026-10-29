use std::path::{Path, PathBuf};

fn asset_path(folder: &Path, filename: &str) -> Result<PathBuf, String> {
    if filename.is_empty() || filename.starts_with('.') || filename.contains(['/', '\\']) {
        return Err("Invalid attachment filename.".into());
    }
    let folder = folder.canonicalize().map_err(|_| "The saved attachment is missing.")?;
    let path = folder.join(filename).canonicalize().map_err(|_| "The saved attachment is missing.")?;
    if !path.starts_with(&folder) || !path.is_file() {
        return Err("The saved attachment is unavailable.".into());
    }
    Ok(path)
}

#[cfg(target_os = "ios")]
mod ios {
    use tauri::{AppHandle, Manager, Runtime, State, plugin::{PluginHandle, TauriPlugin}};

    tauri::ios_plugin_binding!(init_plugin_leadinglight_preview);
    struct Preview<R: Runtime>(PluginHandle<R>);

    #[tauri::command]
    async fn asset_preview<R: Runtime>(app: AppHandle<R>, preview: State<'_, Preview<R>>, filename: String) -> Result<(), String> {
        let folder = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assets");
        let path = super::asset_path(&folder, &filename)?;
        preview.0.run_mobile_plugin_async::<serde_json::Value>("preview", serde_json::json!({ "path": path }))
            .await.map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        tauri::plugin::Builder::new("leadinglight-preview")
            .setup(|app, api| {
                app.manage(Preview(api.register_ios_plugin(init_plugin_leadinglight_preview)?));
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![asset_preview])
            .build()
    }
}

#[cfg(target_os = "ios")]
pub use ios::init;

#[cfg(test)]
mod tests {
    use super::*;

    // Native preview must never turn an attachment filename into access outside its folder.
    #[test]
    fn refuses_paths_and_symlinks_outside_assets() {
        let root = std::env::temp_dir().join(format!("ll-preview-{}", std::process::id()));
        let assets = root.join("assets");
        std::fs::create_dir_all(&assets).unwrap();
        std::fs::write(root.join("private.txt"), "private").unwrap();
        std::fs::write(assets.join("note.txt"), "note").unwrap();
        std::os::unix::fs::symlink(root.join("private.txt"), assets.join("escape.txt")).unwrap();
        assert!(asset_path(&assets, "note.txt").is_ok());
        for name in ["", "../private.txt", "/private.txt", "..\\private.txt", "escape.txt", "missing.txt"] {
            assert!(asset_path(&assets, name).is_err(), "{name}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
