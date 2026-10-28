use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

const PREFIX: &str = "ll-browser-edit:";
const LIMIT: usize = 64 * 1024;
const ACTIONS: [(&str, &str, &str); 6] = [
    ("undo", "Undo", "CmdOrCtrl+Z"),
    ("redo", "Redo", "CmdOrCtrl+Shift+Z"),
    ("cut", "Cut", "CmdOrCtrl+X"),
    ("copy", "Copy", "CmdOrCtrl+C"),
    ("paste", "Paste", "CmdOrCtrl+V"),
    ("selectAll", "Select All", "CmdOrCtrl+A"),
];

struct Menus {
    normal: Submenu<tauri::Wry>,
    remote: Option<Submenu<tauri::Wry>>,
    index: usize,
    owner: Option<String>,
}

#[derive(Default)]
pub struct BrowserMenu(Mutex<Option<Menus>>);

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    for (index, item) in menu.items()?.into_iter().enumerate() {
        if let MenuItemKind::Submenu(sub) = item {
            if sub.text()? == "Edit" {
                *app.state::<BrowserMenu>().0.lock().unwrap() = Some(Menus {
                    normal: sub,
                    remote: None,
                    index,
                    owner: None,
                });
                break;
            }
        }
    }
    Ok(())
}

fn replace(app: &AppHandle, menus: &mut Menus, owner: Option<String>) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let next = if let Some(token) = &owner {
        let sub = Submenu::new(app, "Edit", true)?;
        for (index, (action, label, accel)) in ACTIONS.into_iter().enumerate() {
            if index == 2 {
                sub.append(&PredefinedMenuItem::separator(app)?)?;
            }
            sub.append(&MenuItem::with_id(
                app,
                format!("{PREFIX}{token}:{action}"),
                label,
                true,
                Some(accel),
            )?)?;
        }
        Some(sub)
    } else {
        None
    };
    let before = menus.remote.as_ref().unwrap_or(&menus.normal);
    let after = next.as_ref().unwrap_or(&menus.normal);
    menu.remove(before)?;
    if let Err(error) = menu.insert(after, menus.index) {
        let _ = menu.insert(before, menus.index);
        return Err(error);
    }
    menus.remote = next;
    menus.owner = owner;
    Ok(())
}

// Focus tokens keep a late blur or menu click from reaching a different tab.
#[tauri::command]
pub fn browser_menu_focus(
    window: WebviewWindow,
    owner: String,
    focused: bool,
) -> Result<(), String> {
    if window.label() != "main"
        || owner.len() > 80
        || owner.is_empty()
        || !owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid browser menu owner".into());
    }
    let app = window.app_handle();
    let state = app.state::<BrowserMenu>();
    let mut held = state.0.lock().unwrap();
    let Some(menus) = held.as_mut() else {
        return Ok(());
    };
    if focused {
        if !window.is_focused().unwrap_or(false) || menus.owner.as_deref() == Some(&owner) {
            return Ok(());
        }
        replace(app, menus, Some(owner)).map_err(|e| e.to_string())
    } else if menus.owner.as_deref() == Some(&owner) {
        replace(app, menus, None).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

pub fn restore(app: &AppHandle) {
    let state = app.state::<BrowserMenu>();
    let mut held = state.0.lock().unwrap();
    if let Some(menus) = held.as_mut() {
        if menus.owner.is_some() {
            let _ = replace(app, menus, None);
        }
    }
}

pub fn on_event(app: &AppHandle, id: &str) -> bool {
    let Some(rest) = id.strip_prefix(PREFIX) else {
        return false;
    };
    let Some((owner, action)) = rest.split_once(':') else {
        return true;
    };
    if !ACTIONS.iter().any(|(name, _, _)| *name == action) {
        return true;
    }
    if !app
        .get_webview_window("main")
        .is_some_and(|w| w.is_focused().unwrap_or(false))
    {
        return true;
    }
    let state = app.state::<BrowserMenu>();
    let held = state.0.lock().unwrap();
    if held.as_ref().and_then(|m| m.owner.as_deref()) == Some(owner) {
        let _ = app.emit_to(
            "main",
            "ll:browser-edit",
            serde_json::json!({ "owner": owner, "action": action }),
        );
    }
    true
}

// Native menu events have no WebKit clipboard gesture; the focused page uses the system tools.
#[tauri::command]
pub async fn browser_clipboard(
    window: WebviewWindow,
    owner: String,
    text: Option<String>,
) -> Result<String, String> {
    if window.label() != "main" || !window.is_focused().unwrap_or(false) {
        return Err("Focus the browser page first".into());
    }
    {
        let state = window.app_handle().state::<BrowserMenu>();
        let held = state.0.lock().unwrap();
        if held.as_ref().and_then(|m| m.owner.as_deref()) != Some(owner.as_str()) {
            return Err("The browser page lost focus".into());
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(text) = text {
            if text.len() > LIMIT {
                return Err("Clipboard text is larger than 64 KiB".into());
            }
            let mut child = Command::new("/usr/bin/pbcopy")
                .env("LC_CTYPE", "en_US.UTF-8")
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| e.to_string())?;
            if let Err(error) = child.stdin.take().unwrap().write_all(text.as_bytes()) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.to_string());
            }
            if !child.wait().map_err(|e| e.to_string())?.success() {
                return Err("Could not copy the selected text".into());
            }
            Ok(String::new())
        } else {
            let mut child = Command::new("/usr/bin/pbpaste")
                .env("LC_CTYPE", "en_US.UTF-8")
                .args(["-Prefer", "txt"])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            let read = child
                .stdout
                .take()
                .unwrap()
                .take((LIMIT + 1) as u64)
                .read_to_end(&mut bytes);
            if read.is_err() || bytes.len() > LIMIT {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Clipboard text could not be read or is larger than 64 KiB".into());
            }
            if !child.wait().map_err(|e| e.to_string())?.success() {
                return Err("Could not read clipboard text".into());
            }
            String::from_utf8(bytes).map_err(|_| "Clipboard text is not UTF-8".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
