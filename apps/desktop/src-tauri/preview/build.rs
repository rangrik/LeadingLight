fn main() {
    tauri_plugin::Builder::new(&["asset_preview"]).ios_path("ios").build();
}
