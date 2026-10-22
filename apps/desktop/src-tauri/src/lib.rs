use tauri_plugin_sql::{Migration, MigrationKind};

// Must match DB_URL in src/lib/objects.ts.
const DB_URL: &str = "sqlite:leadinglight.db";

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "objects and object types",
        sql: include_str!("../migrations/001_objects.sql"),
        kind: MigrationKind::Up,
    }]
}

// The stock Quit ends the app at once, losing edits still in the 500 ms save delay. Ours
// closes the windows, so each saves first; the app quits when the last one is gone.
#[cfg(target_os = "macos")]
fn quit_through_close(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    use tauri::Manager;

    let menu = Menu::default(app.handle())?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        // Quit is the app menu's last item.
        app_menu.remove_at(app_menu.items()?.len() - 1)?;
        let label = format!("Quit {}", app.package_info().name);
        app_menu.append(&MenuItem::with_id(app, "quit", label, true, Some("CmdOrCtrl+Q"))?)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == "quit" {
            for window in app.webview_windows().values() {
                let _ = window.close();
            }
        }
    });
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
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            quit_through_close(_app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
