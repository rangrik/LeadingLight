#[cfg(target_os = "ios")]
mod ios {
    use tauri::{Emitter, Manager, Runtime, ipc::{Channel, InvokeResponseBody}, plugin::{PluginHandle, TauriPlugin}};

    tauri::ios_plugin_binding!(init_plugin_leadinglight_notifications);
    unsafe extern "C" { fn leadinglight_notifications_bootstrap(); }
    struct Notifications<R: Runtime>(PluginHandle<R>);

    pub fn bootstrap() {
        // Install before UIApplicationMain so a cold-start tap is retained.
        unsafe { leadinglight_notifications_bootstrap(); }
    }

    pub async fn call<R: Runtime>(app: &tauri::AppHandle<R>, command: &str, payload: serde_json::Value) -> Result<serde_json::Value, String> {
        app.state::<Notifications<R>>().0.run_mobile_plugin_async(command, payload)
            .await.map_err(|error| error.to_string())
    }

    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        tauri::plugin::Builder::new("leadinglight-notifications")
            .setup(|app, api| {
                let handle = api.register_ios_plugin(init_plugin_leadinglight_notifications)?;
                app.manage(Notifications(handle.clone()));
                let app = app.clone();
                let channel = Channel::<serde_json::Value>::new(move |response| {
                    if let InvokeResponseBody::Json(json) = response {
                        let value: serde_json::Value = serde_json::from_str(&json)?;
                        if value.get("channel").and_then(|v| v.as_str()).is_some() {
                            app.emit("leadinglight:mobile-notification", value)?;
                        } else {
                            app.emit("leadinglight:mobile-notification-registration", ())?;
                        }
                    }
                    Ok(())
                });
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = handle.run_mobile_plugin_async::<serde_json::Value>("observe", serde_json::json!({ "channel": channel })).await {
                        eprintln!("Unable to observe mobile notifications: {error}");
                    }
                });
                Ok(())
            }).build()
    }
}

#[cfg(target_os = "ios")]
pub use ios::{bootstrap, call, init};
