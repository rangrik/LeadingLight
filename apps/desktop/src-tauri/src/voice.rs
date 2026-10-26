use std::{
    fs,
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

static TRANSCRIBING: Mutex<()> = Mutex::new(());

#[tauri::command]
pub async fn voice_transcribe(
    app: tauri::AppHandle,
    filename: String,
    language: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run(app, filename, language))
        .await
        .map_err(|e| e.to_string())?
}

fn run(app: tauri::AppHandle, filename: String, language: String) -> Result<String, String> {
    let _busy = TRANSCRIBING
        .try_lock()
        .map_err(|_| "Another recording is being transcribed. Retry when it finishes.")?;
    if !cfg!(target_os = "macos") {
        return Err(
            "Transcription requires the Mac app on macOS 26 or newer. Your audio is saved.".into(),
        );
    }
    if filename.is_empty() || filename.contains(['/', '\\']) || filename.starts_with('.') {
        return Err("Invalid audio file.".into());
    }
    let assets = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("assets")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let path = assets
        .join(&filename)
        .canonicalize()
        .map_err(|_| "The saved recording could not be found.")?;
    if !path.starts_with(&assets)
        || !path.is_file()
        || path.metadata().map_err(|e| e.to_string())?.len() > 256 * 1024 * 1024
    {
        return Err("The recording is unavailable or larger than 256 MB.".into());
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let helper = executable
        .parent()
        .ok_or("Cannot find the app's folder.")?
        .join("leadinglight-transcribe");
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let output = cache.join(format!("voice-{id}.json"));
    let result = (|| {
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output)
            .map_err(|e| e.to_string())?;
        let mut child = Command::new(helper)
            .arg(&path)
            .arg(&language)
            .stdin(Stdio::null())
            .stdout(file)
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Could not start transcription: {e}. Your audio is saved."))?;
        let started = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        return Err("Transcription stopped unexpectedly. Your audio is saved; retry transcription.".into());
                    }
                    break;
                }
                Ok(None) if started.elapsed() < Duration::from_secs(600) => {
                    std::thread::sleep(Duration::from_millis(100))
                }
                state => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(match state {
                        Err(error) => error.to_string(),
                        _ => {
                            "Transcription took too long. Your audio is saved; retry transcription."
                                .into()
                        }
                    });
                }
            }
        }
        let response: serde_json::Value =
            serde_json::from_slice(&fs::read(&output).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if let Some(error) = response["error"].as_str() {
            return Err(error.to_owned());
        }
        response["text"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| "Transcription returned no result. Your audio is saved.".into())
    })();
    let _ = fs::remove_file(output);
    result
}
