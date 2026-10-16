# Saving before close and quit

LeadingLight intercepts native window close and application quit before the webview is destroyed. Normal closing never relies on the editor's autosave debounce.

`src-tauri/src/shutdown_save.rs` coordinates a numbered request. Closing a window asks that renderer to save; quitting asks every open renderer. A later quit upgrades an in-progress window close to include the other windows. Repeated requests do not reset the deadline. The native command checks both the request number and the calling window before accepting its acknowledgment.

On macOS, AppKit's standard Quit action bypasses Tauri's `ExitRequested` event. `src-tauri/src/macos_shutdown.rs` adds `applicationShouldTerminate:` to the existing Tao delegate without replacing it. Cmd+Q, menu Quit, Dock Quit and system termination requests receive `NSTerminateLater`; the delegate replies only after the save coordinator succeeds or cancels. Programmatic Tauri exits retain the `ExitRequested` gate. The bridge deliberately refuses to overwrite a future upstream implementation of that optional delegate method.

`src/leadinglight/useNativeSaveBeforeClose.ts` receives the request and commits an input guard before flushing. `App.tsx` flushes rich and Markdown buffers in both panes, waits for per-document saves and pending renames, then drains the remaining save queue. The app shell becomes inert and displays a saving message. Renderer shortcuts and custom native menu commands are suspended during the operation.

Native close or quit proceeds only after all affected windows report success. A failed write, unmounted renderer or 15-second native deadline cancels the operation and keeps windows open. Cancellation releases input guards and displays an error. A native dialog covers a stalled renderer, and a 16-second renderer deadline covers a lost cancellation event. Late results from cancelled requests cannot authorize closing. Users can retry saving and close again.

Rich editor composition is also a save boundary. Each editor registers its own readiness check in `src/hooks/editorCompositionBoundary.ts`. Active IME composition and committed input awaiting ProseMirror reconciliation block closing; the existing change event or reconciliation fallback releases the boundary, after which the user can retry. This avoids serializing an incomplete composition. A serialization exception also rejects explicit saving and retains the pending editor change for retry. Background timers and unrelated renders retain the current document and log the failure instead of throwing through React.

The command pair `shutdown_frontend_ready` and `complete_shutdown_save` is an additive desktop integration in `src-tauri/src/lib.rs`. The ready command replays requests made while a renderer was still loading. Existing window-frame persistence remains in `window_state.rs`.

This protects graceful close and quit. Force termination, operating-system crashes and power loss remain outside this handshake; it is not a recovery journal.

## Verification

The native coordinator tests cover acknowledgments from multiple windows, stale or unknown acknowledgments, cancellation and retries, and quit during a pending close. Hook tests cover successful and failed flushes, stalled saves, late success after cancellation, cancellation caused by another window, duplicate requests, current callbacks, listener cleanup and the browser preview.

Editor/shutdown integration tests use the real composition, rich-buffer and native-close hooks to verify that active or unreconciled composition and serialization errors cannot acknowledge success, and that retry publishes the retained text. Additional tests cover autosave deadlines during composition, unrelated metadata renders, per-editor barrier isolation and safe timer/cleanup failures.

Native acceptance uses synthetic notes: type into each pane and close immediately, relaunch and verify both files; repeat with Cmd+Q. A simulated save failure or stalled renderer must keep the window open and report the error.

## Local Trash barrier

Moving a page to Trash first holds ordinary writes for that document. The transaction waits
for tracked editor imports, flushes rich-text buffers, drains held saves, and settles any initial
name change before calling the native move. The move records confirmed IDs before checking for
late editor changes. A changed or uncertain page remains editable; its older saved copy remains
recoverable in Trash. Only an unchanged, confirmed move discards the held write and closes its page.
Other panes and the split layout remain intact.

Quit and workspace switching synchronously stop new Trash requests, wait for the queue to settle,
and then flush the current pane owners. A canceled or failed transition permits editing again.
Queued requests and Undo retain their original vault session; leaving and returning to the same
folder does not reactivate an old Undo action. These barriers complement the native transaction
contract in [ADR 003](ADR-003-local-trash.md).
