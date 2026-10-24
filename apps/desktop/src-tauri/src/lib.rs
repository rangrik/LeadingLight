use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

// Claude through the installed Claude Code (agent.rs), the menu bar, built from
// src/lib/shortcuts.json (Shipyard's, see vendor/shipyard/README.md); each item tells
// the webview as berth://menu, and the idea capture box (capture.rs).
mod agent;
mod capture;
mod menu;

const DB_URL: &str = "sqlite:leadinglight.db";

// Closing the main window hides it, so ⌃⌥I keeps working; only Quit lets it close.
static QUITTING: AtomicBool = AtomicBool::new(false);

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "objects and object types",
            sql: include_str!("../migrations/001_objects.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "property definitions and type settings",
            sql: include_str!("../migrations/002_properties.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

// ⌘Q closes the windows instead of quitting at once, so the webview saves first
// (App.tsx, onCloseRequested). The app menu's last item is the predefined Quit;
// it is swapped for ours.
#[cfg(target_os = "macos")]
fn menu_bar(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuItem, MenuItemKind};

    let menu = menu::build(app.handle())?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        app_menu.remove_at(app_menu.items()?.len() - 1)?;
        let label = format!("Quit {}", app.package_info().name);
        app_menu.append(&MenuItem::with_id(app, "quit", label, true, Some("CmdOrCtrl+Q"))?)?;
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(agent::Agents::default())
        .invoke_handler(tauri::generate_handler![
            agent::agent_status,
            agent::agent_ask,
            agent::agent_cancel,
            agent::agent_list,
            agent::agent_folder,
            capture::capture_show,
            capture::capture_hide,
            capture::capture_open
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            menu_bar(app)?;
            capture::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == capture::MAIN && !QUITTING.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                QUITTING.store(true, Ordering::Relaxed);
                capture::release(app);
                for window in app.webview_windows().values() {
                    let _ = window.close();
                }
            } else {
                menu::on_event(app, event.id().as_ref());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // The Dock icon brings the hidden main window back.
            if let RunEvent::Reopen { has_visible_windows: false, .. } = event {
                if let Some(main) = app.get_webview_window(capture::MAIN) {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
        });
}
