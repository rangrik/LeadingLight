use serde_json::{Value, json};

async fn call(app: tauri::AppHandle, command: &str, payload: Value) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    { tauri_plugin_leadinglight_notifications::call(&app, command, payload).await }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, command, payload);
        Err("Agent push notifications are available in the iPhone and iPad apps.".into())
    }
}

#[tauri::command]
pub async fn mobile_notifications_status(app: tauri::AppHandle) -> Result<Value, String> { call(app, "status", json!({})).await }

#[tauri::command]
pub async fn mobile_notifications_request(app: tauri::AppHandle) -> Result<Value, String> { call(app, "request", json!({})).await }

#[tauri::command]
pub async fn mobile_notifications_take_pending(app: tauri::AppHandle) -> Result<Value, String> { call(app, "takePending", json!({})).await }

#[tauri::command]
pub async fn mobile_notifications_ack_pending(app: tauri::AppHandle, channel: String, id: String) -> Result<Value, String> {
    call(app, "acknowledgePending", json!({"channel": channel, "id": id})).await
}
