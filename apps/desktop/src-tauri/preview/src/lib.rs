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

    #[tauri::command]
    async fn asset_capture<R: Runtime>(app: AppHandle<R>, preview: State<'_, Preview<R>>, kind: String, filename: Option<String>) -> Result<serde_json::Value, String> {
        if kind != "photo" && kind != "drawing" { return Err("Unknown capture kind.".into()); }
        let folder = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assets");
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let path = filename.map(|name| super::asset_path(&folder, &name)).transpose()?;
        preview.0.run_mobile_plugin_async("capture", serde_json::json!({ "folder": folder, "kind": kind, "path": path }))
            .await.map_err(|e| e.to_string())
    }

    #[tauri::command]
    async fn paper_edit<R: Runtime>(app: AppHandle<R>, preview: State<'_, Preview<R>>, id: String, title: String, action: String, paper: serde_json::Value, appearance: Option<serde_json::Value>, on_change: tauri::ipc::Channel<serde_json::Value>) -> Result<serde_json::Value, String> {
        if id.is_empty() || id.len() > 80 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') { return Err("Invalid page.".into()); }
        let folder = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assets");
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        preview.0.run_mobile_plugin_async("editPaper", serde_json::json!({ "folder": folder, "id": id, "title": title, "action": action, "paper": paper, "appearance": appearance, "onChange": on_change }))
            .await.map_err(|e| e.to_string())
    }

    #[tauri::command]
    async fn document_ink<R: Runtime>(_app: AppHandle<R>, preview: State<'_, Preview<R>>, enabled: bool, bounds: Option<serde_json::Value>, on_event: tauri::ipc::Channel<serde_json::Value>) -> Result<(), String> {
        preview.0.run_mobile_plugin_async::<serde_json::Value>("documentInk", serde_json::json!({ "enabled": enabled, "bounds": bounds, "onEvent": on_event }))
            .await.map(|_| ()).map_err(|e| e.to_string())
    }

    async fn recognize<R: Runtime>(app: AppHandle<R>, preview: State<'_, Preview<R>>, filename: String, language: String, method: &str) -> Result<serde_json::Value, String> {
        let folder = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assets");
        let path = super::asset_path(&folder, &filename)?;
        if path.metadata().map_err(|e| e.to_string())?.len() > 32 * 1024 * 1024 { return Err("This attachment exceeds 32 MiB.".into()); }
        preview.0.run_mobile_plugin_async(method, serde_json::json!({ "path": path, "language": language }))
            .await.map_err(|e| e.to_string())
    }

    #[tauri::command]
    async fn asset_text<R: Runtime>(app: AppHandle<R>, preview: State<'_, Preview<R>>, filename: String) -> Result<serde_json::Value, String> {
        recognize(app, preview, filename, String::new(), "recognizeText").await
    }

    #[tauri::command]
    async fn voice_transcribe<R: Runtime>(app: AppHandle<R>, preview: State<'_, Preview<R>>, filename: String, language: String) -> Result<serde_json::Value, String> {
        recognize(app, preview, filename, language, "transcribe").await
    }

    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        tauri::plugin::Builder::new("leadinglight-preview")
            .setup(|app, api| {
                app.manage(Preview(api.register_ios_plugin(init_plugin_leadinglight_preview)?));
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![asset_preview, asset_capture, asset_text, voice_transcribe, paper_edit, document_ink])
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
