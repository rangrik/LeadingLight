fn main() {
    tauri_plugin::Builder::new(&["asset_preview", "asset_capture", "asset_text", "voice_transcribe", "paper_edit", "document_ink"]).ios_path("ios").build();
}
