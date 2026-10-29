#[cfg(target_os = "macos")]
use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
};
#[cfg(target_os = "macos")]
use tauri::menu::MenuItemKind;
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg(target_os = "macos")]
mod agent;
#[cfg(target_os = "macos")]
mod agent_guard;
#[cfg(target_os = "macos")]
mod browser_menu;
#[cfg(target_os = "macos")]
mod capture;
#[cfg(target_os = "macos")]
mod clis;
#[cfg(target_os = "macos")]
mod menu;
#[cfg(target_os = "macos")]
mod runtime;
#[cfg(target_os = "macos")]
mod relay;
#[cfg(target_os = "macos")]
mod voice;
mod web;
mod native_cloud;

const DB_URL: &str = "sqlite:leadinglight.db";

// Closing the main window hides it, so ⌃⌥I keeps working; only Quit lets it close.
#[cfg(target_os = "macos")]
static QUITTING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn native_platform() -> &'static str {
    std::env::consts::OS
}

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
        Migration {
            version: 3,
            description: "pages linked to folders",
            sql: include_str!("../migrations/003_project_folders.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "atomic page history",
            sql: include_str!("../migrations/004_history.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

// ⌘Q closes the windows instead of quitting at once, so the webview saves first
// (App.tsx, onCloseRequested). The app menu's last item is the predefined Quit;
// it is swapped for ours.
#[cfg(target_os = "macos")]
fn menu_bar(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::MenuItem;

    let menu = menu::build(app.handle())?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        app_menu.remove_at(app_menu.items()?.len() - 1)?;
        let label = format!("Quit {}", app.package_info().name);
        app_menu.append(&MenuItem::with_id(app, "quit", label, true, Some("CmdOrCtrl+Q"))?)?;
    }
    app.set_menu(menu)?;
    Ok(())
}

// Settings › Shortcuts (lib/keymap.ts): each menu item gets its keys, or none while Settings
// records new ones. New idea's are also the capture box's global keys.
#[cfg(target_os = "macos")]
#[tauri::command]
fn shortcuts_set(app: AppHandle, keys: HashMap<String, Option<String>>) -> Result<(), String> {
    if let Some(menu) = app.menu() {
        for item in menu.items().map_err(|e| e.to_string())? {
            let MenuItemKind::Submenu(sub) = item else { continue };
            for (id, accel) in &keys {
                if let Some(MenuItemKind::MenuItem(i)) = sub.get(id.as_str()) {
                    i.set_accelerator(accel.as_deref()).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    capture::set_key(&app, keys.get("new-idea").and_then(|a| a.as_deref()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(native_cloud::NativeCloud::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        );
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_leadinglight_preview::init());
    #[cfg(not(target_os = "macos"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        native_platform,
        native_cloud::cloud_request,
        web::web_fetch,
        web::web_save_media
    ]);
    #[cfg(target_os = "macos")]
    let builder = builder
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(agent::Agents::default())
        .manage(browser_menu::BrowserMenu::default())
        .manage(runtime::Runtime::default())
        .manage(relay::Relay::default())
        .invoke_handler(tauri::generate_handler![
            native_platform,
            native_cloud::cloud_request,
            agent::agent_status,
            agent::agent_ask,
            agent::agent_reply,
            agent::agent_usage,
            agent::agent_cancel,
            agent::agent_list,
            agent::agent_folder,
            relay::relay_list,
            relay::relay_preview,
            relay::relay_approve,
            relay::relay_revoke,
            clis::cli_info,
            clis::cli_update,
            clis::codex_usage,
            clis::codex_status,
            capture::capture_show,
            capture::capture_hide,
            capture::capture_open,
            runtime::runtime_status,
            runtime::runtime_call,
            runtime::runtime_stream,
            runtime::runtime_stream_stop,
            web::web_fetch,
            web::web_save_media,
            voice::voice_transcribe,
            browser_menu::browser_menu_focus,
            browser_menu::browser_clipboard,
            shortcuts_set
        ])
        .setup(|app| {
            menu_bar(app)?;
            browser_menu::setup(app.handle())?;
            capture::setup(app.handle())?;
            runtime::setup(app.handle());
            relay::setup(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == capture::MAIN && matches!(event, WindowEvent::Focused(false)) {
                browser_menu::restore(window.app_handle());
            }
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
                agent::stop_all(app);
                for window in app.webview_windows().values() {
                    let _ = window.close();
                }
            } else if !browser_menu::on_event(app, event.id().as_ref()) {
                menu::on_event(app, event.id().as_ref());
            }
        });
    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            {
                let (app, event) = (_app, _event);
                // The Dock icon brings the hidden main window back.
                if let RunEvent::Reopen { has_visible_windows: false, .. } = event {
                    if let Some(main) = app.get_webview_window(capture::MAIN) {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
                // Every way of quitting (⌘Q, the Dock) ends here, after the windows have closed.
                if matches!(event, RunEvent::Exit) {
                    agent::stop_all(app);
                    runtime::quit(app);
                }
            }
        });
}
