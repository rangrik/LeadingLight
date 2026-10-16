//! Native close/quit waits for every affected renderer to persist its editors.
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::DialogExt;

const REQUEST_EVENT: &str = "leadinglight:save-before-close";
const CANCEL_EVENT: &str = "leadinglight:close-cancelled";
const SAVE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, PartialEq)]
enum ShutdownAction {
    Close(String),
    Exit(i32),
}

#[derive(Debug)]
struct PendingShutdown {
    id: u64,
    action: ShutdownAction,
    participants: HashSet<String>,
    waiting: HashSet<String>,
}

#[derive(Default, Debug)]
struct Coordinator {
    sequence: u64,
    pending: Option<PendingShutdown>,
    approved_close: HashSet<String>,
    approved_exit: bool,
}

#[derive(Default, Debug)]
pub(crate) struct ShutdownSaveState(Mutex<Coordinator>);

#[derive(Clone, Serialize)]
struct SaveRequest {
    id: u64,
}

#[derive(Clone, Serialize)]
struct CancelledRequest {
    id: u64,
    reason: &'static str,
}

impl Coordinator {
    fn begin(&mut self, action: ShutdownAction, labels: HashSet<String>) -> Option<SaveRequest> {
        // A second close/quit does not bypass or restart the current save deadline.
        if let Some(pending) = &mut self.pending {
            if matches!(action, ShutdownAction::Exit(_)) {
                pending.action = action;
                for label in labels {
                    if pending.participants.insert(label.clone()) {
                        pending.waiting.insert(label);
                    }
                }
                return Some(SaveRequest { id: pending.id });
            }
            return None;
        }
        self.sequence += 1;
        self.pending = Some(PendingShutdown {
            id: self.sequence,
            action,
            participants: labels.clone(),
            waiting: labels,
        });
        Some(SaveRequest { id: self.sequence })
    }

    fn acknowledge(&mut self, id: u64, label: &str) -> Option<ShutdownAction> {
        let pending = self.pending.as_mut()?;
        if pending.id != id || !pending.waiting.remove(label) || !pending.waiting.is_empty() {
            return None;
        }
        let action = self.pending.take()?.action;
        match &action {
            ShutdownAction::Close(label) => {
                self.approved_close.insert(label.clone());
            }
            ShutdownAction::Exit(_) => {
                self.approved_exit = true;
            }
        }
        Some(action)
    }

    fn cancel(&mut self, id: u64) -> Option<PendingShutdown> {
        if self.pending.as_ref()?.id != id {
            return None;
        }
        self.pending.take()
    }
}

pub(crate) fn is_saving(app: &AppHandle) -> bool {
    app.state::<ShutdownSaveState>()
        .0
        .lock()
        .unwrap()
        .pending
        .is_some()
}

fn cancel_request(app: &AppHandle, id: u64, reason: &'static str) {
    let pending = app
        .state::<ShutdownSaveState>()
        .0
        .lock()
        .unwrap()
        .cancel(id);
    let Some(pending) = pending else {
        return;
    };
    log::info!(target: "leadinglight::shutdown", "Save request cancelled id={id} reason={reason}");
    if let Err(error) = crate::macos_shutdown::reply(app, false) {
        log::error!(target: "leadinglight::shutdown", "Could not cancel AppKit quit: {error}");
    }
    for label in pending.participants {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.emit(CANCEL_EVENT, CancelledRequest { id, reason });
        }
    }
    // This native fallback remains visible if the renderer is stalled or failed to load.
    let message = if reason == "timeout" {
        "Saving took too long. Your window is still open; retry saving, then close again."
    } else {
        "Could not save before closing. Your window is still open; retry saving, then close again."
    };
    app.dialog()
        .message(message)
        .title("LeadingLight")
        .show(|_| {});
}

fn request_save(app: &AppHandle, action: ShutdownAction, labels: HashSet<String>) {
    let (request, start_timer) = {
        let state = app.state::<ShutdownSaveState>();
        let mut coordinator = state.0.lock().unwrap();
        let start_timer = coordinator.pending.is_none();
        (coordinator.begin(action, labels), start_timer)
    };
    let Some(request) = request else {
        return;
    };
    let waiting = app
        .state::<ShutdownSaveState>()
        .0
        .lock()
        .unwrap()
        .pending
        .as_ref()
        .map(|pending| pending.waiting.clone())
        .unwrap_or_default();
    log::info!(target: "leadinglight::shutdown", "Save request emitted id={} renderers={}", request.id, waiting.len());
    for label in waiting {
        if let Some(window) = app.get_webview_window(&label) {
            if window.emit(REQUEST_EVENT, request.clone()).is_err() {
                cancel_request(app, request.id, "failed");
                return;
            }
        }
    }
    if !start_timer {
        return;
    }
    let app = app.clone();
    // A deadline never authorizes data loss; it cancels the close and leaves the app open.
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_TIMEOUT);
        cancel_request(&app, request.id, "timeout");
    });
}

#[cfg(target_os = "macos")]
pub(crate) fn request_appkit_quit(app: &AppHandle) {
    request_save(
        app,
        ShutdownAction::Exit(0),
        app.webview_windows().into_keys().collect(),
    );
}

pub(crate) fn handle_run_event(app: &AppHandle, event: &RunEvent) {
    match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            log::info!(target: "leadinglight::shutdown", "Window close requested");
            if app
                .state::<ShutdownSaveState>()
                .0
                .lock()
                .unwrap()
                .approved_close
                .remove(label)
            {
                return;
            }
            api.prevent_close();
            request_save(
                app,
                ShutdownAction::Close(label.clone()),
                HashSet::from([label.clone()]),
            );
        }
        RunEvent::ExitRequested { api, code, .. } => {
            log::info!(target: "leadinglight::shutdown", "Tauri exit requested");
            if app
                .state::<ShutdownSaveState>()
                .0
                .lock()
                .unwrap()
                .approved_exit
            {
                return;
            }
            let labels: HashSet<_> = app.webview_windows().into_keys().collect();
            if labels.is_empty() {
                return;
            }
            api.prevent_exit();
            request_save(app, ShutdownAction::Exit(code.unwrap_or(0)), labels);
        }
        RunEvent::Exit => log::info!(target: "leadinglight::shutdown", "Application exited"),
        _ => {}
    }
}

/// Replay a request made while this window was still loading its event listeners.
#[tauri::command]
pub(crate) fn shutdown_frontend_ready(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    log::info!(target: "leadinglight::shutdown", "Renderer save listener ready");
    let request = app
        .state::<ShutdownSaveState>()
        .0
        .lock()
        .unwrap()
        .pending
        .as_ref()
        .filter(|pending| pending.waiting.contains(window.label()))
        .map(|pending| SaveRequest { id: pending.id });
    if let Some(request) = request {
        window
            .emit(REQUEST_EVENT, request)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn complete_shutdown_save(
    window: WebviewWindow,
    app: AppHandle,
    request_id: u64,
    saved: bool,
) -> Result<(), String> {
    log::info!(target: "leadinglight::shutdown", "Renderer save acknowledgment id={request_id} saved={saved}");
    let valid = app
        .state::<ShutdownSaveState>()
        .0
        .lock()
        .unwrap()
        .pending
        .as_ref()
        .is_some_and(|pending| {
            pending.id == request_id && pending.participants.contains(window.label())
        });
    if !valid {
        return Ok(());
    }
    if !saved {
        cancel_request(&app, request_id, "failed");
        return Ok(());
    }
    let action = app
        .state::<ShutdownSaveState>()
        .0
        .lock()
        .unwrap()
        .acknowledge(request_id, window.label());
    match action {
        Some(ShutdownAction::Close(label)) => {
            if let Some(target) = app.get_webview_window(&label) {
                if let Err(err) = target.close() {
                    app.state::<ShutdownSaveState>()
                        .0
                        .lock()
                        .unwrap()
                        .approved_close
                        .remove(&label);
                    return Err(err.to_string());
                }
            }
        }
        Some(ShutdownAction::Exit(code)) if !crate::macos_shutdown::reply(&app, true)? => {
            app.exit(code);
        }
        // A sent AppKit terminate reply already ends the app.
        Some(ShutdownAction::Exit(_)) | None => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn labels(names: &[&str]) -> HashSet<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn quit_requires_each_window_and_rejects_stale_or_unknown_acknowledgments() {
        let mut state = Coordinator::default();
        let request = state
            .begin(ShutdownAction::Exit(0), labels(&["main", "note-1"]))
            .unwrap();
        assert_eq!(state.acknowledge(request.id + 1, "main"), None);
        assert_eq!(state.acknowledge(request.id, "other"), None);
        assert_eq!(state.acknowledge(request.id, "main"), None);
        assert!(!state.approved_exit);
        assert_eq!(
            state.acknowledge(request.id, "note-1"),
            Some(ShutdownAction::Exit(0))
        );
        assert!(state.approved_exit);
    }

    #[test]
    fn timeout_or_error_keeps_window_open_and_late_success_cannot_close_it() {
        let mut state = Coordinator::default();
        let request = state
            .begin(ShutdownAction::Close("main".into()), labels(&["main"]))
            .unwrap();
        assert!(state.cancel(request.id).is_some());
        assert_eq!(state.acknowledge(request.id, "main"), None);
        assert!(state.approved_close.is_empty());
        assert!(!state.approved_exit);
        let retry = state
            .begin(ShutdownAction::Close("main".into()), labels(&["main"]))
            .unwrap();
        assert!(retry.id > request.id);
        assert!(state.cancel(request.id).is_none());
        assert_eq!(
            state.acknowledge(retry.id, "main"),
            Some(ShutdownAction::Close("main".into()))
        );
    }

    #[test]
    fn quit_during_close_extends_same_request_to_other_windows() {
        let mut state = Coordinator::default();
        let request = state
            .begin(ShutdownAction::Close("main".into()), labels(&["main"]))
            .unwrap();
        assert!(state
            .begin(ShutdownAction::Close("main".into()), labels(&["main"]))
            .is_none());
        let quit = state
            .begin(ShutdownAction::Exit(0), labels(&["main", "note-1"]))
            .unwrap();
        assert_eq!(request.id, quit.id);
        assert_eq!(state.acknowledge(request.id, "main"), None);
        assert_eq!(
            state.acknowledge(request.id, "note-1"),
            Some(ShutdownAction::Exit(0))
        );
    }
}
