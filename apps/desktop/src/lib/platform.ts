// True only inside the LeadingLight app itself. Other Tauri hosts (Shipyard's preview pane)
// expose Tauri's internals too, so check the app's identifier, not just for Tauri.
export const isNative: Promise<boolean> = (async () => {
  if (!("__TAURI_INTERNALS__" in window)) return false;
  try {
    const { getIdentifier } = await import("@tauri-apps/api/app");
    // The real app or a worktree's dev app (scripts/install-dev-app.sh).
    return (await getIdentifier()).startsWith("com.leadinglight.");
  } catch {
    return false;
  }
})();
