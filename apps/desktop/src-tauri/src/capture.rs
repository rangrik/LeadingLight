// The idea capture box: a small window ⌃⌥I shows over whatever app is in front. It is an
// NSPanel that never activates this app (tauri-nspanel), so the app the person was in keeps
// its menu bar and its windows in front, and gets the keyboard back when the box closes.
// The box itself is the capture.html webview; saving runs in the main window
// (lib/capture.ts). See docs/DECISIONS.md, 14.

use std::error::Error;

use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewWindow};
use tauri_nspanel::{tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const LABEL: &str = "capture";
pub const MAIN: &str = "main";

tauri_panel! {
    panel!(CapturePanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true,
        }
    })
    panel_event!(CaptureEvents {
        window_did_resign_key(notification: &NSNotification) -> (),
    })
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    let window = app.get_webview_window(LABEL).ok_or("no capture window")?;
    let panel = window.to_panel::<CapturePanel>()?;
    panel.set_level(PanelLevel::Floating.value());
    // Shows over full-screen apps, on whatever space is in front.
    panel.set_collection_behavior(CollectionBehavior::new().full_screen_auxiliary().move_to_active_space().into());
    panel.add_style_mask(StyleMask::empty().nonactivating_panel().into())?;
    // A click anywhere else closes the box, as Spotlight does.
    let events = CaptureEvents::new();
    let weak = std::sync::Arc::downgrade(&panel);
    events.window_did_resign_key(move |_| {
        if let Some(panel) = weak.upgrade() {
            if panel.is_visible() {
                panel.hide();
            }
        }
    });
    panel.set_event_handler(Some(events.as_ref()));
    let key = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyI);
    app.global_shortcut().on_shortcut(key, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            toggle(app);
        }
    })?;
    Ok(())
}

// Panels are AppKit objects: touched on the main thread only.
fn on_main(app: &AppHandle, f: impl FnOnce(&AppHandle) + Send + 'static) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || f(&handle));
}

pub fn show(app: &AppHandle) {
    on_main(app, |app| {
        let Ok(panel) = app.get_webview_panel(LABEL) else { return };
        let window = app.get_webview_window(LABEL);
        if let Some(window) = &window {
            let _ = place(window);
        }
        panel.show_and_make_key();
        // The keys go to the webview itself, so the first one typed lands in the box.
        if let Some(window) = window {
            let _ = window.with_webview(move |webview| {
                let view = webview.inner() as *const tauri_nspanel::NSResponder;
                panel.make_first_responder(Some(unsafe { &*view }));
            });
        }
        let _ = app.emit_to(LABEL, "capture://show", ());
    });
}

pub fn hide(app: &AppHandle) {
    on_main(app, |app| {
        if let Ok(panel) = app.get_webview_panel(LABEL) {
            if panel.is_visible() {
                panel.hide();
            }
        }
    });
}

fn toggle(app: &AppHandle) {
    match app.get_webview_panel(LABEL) {
        Ok(panel) if panel.is_visible() => hide(app),
        _ => show(app),
    }
}

// Spotlight's place: centred on the screen with the pointer, a fifth of the way down.
fn place(window: &WebviewWindow) -> tauri::Result<()> {
    let primary = window.primary_monitor()?;
    let scale = primary.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let cursor = window.cursor_position()?.to_logical::<f64>(scale);
    let Some(monitor) = window.monitor_from_point(cursor.x, cursor.y)?.or(window.current_monitor()?).or(primary) else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);
    let width = window.outer_size()?.to_logical::<f64>(scale).width;
    window.set_position(LogicalPosition::new(origin.x + (size.width - width) / 2.0, origin.y + size.height * 0.2))
}

// Before quitting, the panel becomes a plain window again, so Tauri closes it as its own.
pub fn release(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel(LABEL) {
        panel.to_window();
    }
}

#[tauri::command]
pub fn capture_show(app: AppHandle) {
    show(&app);
}

#[tauri::command]
pub fn capture_hide(app: AppHandle) {
    hide(&app);
}

// ⌘↩: the idea opens in the main window, which comes forward.
#[tauri::command]
pub fn capture_open(app: AppHandle, id: String) {
    hide(&app);
    if let Some(main) = app.get_webview_window(MAIN) {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit_to(MAIN, "ll:open-page", id);
}
