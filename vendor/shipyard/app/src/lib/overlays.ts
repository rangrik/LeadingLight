// OVERLAYS matches what keeps the keyboard over any pane: open dialogs,
// menus, listboxes and popovers. A pane takes focus only when none is open.
// Toasts are role=dialog too, but never hold the keyboard, so a "keeps
// running" toast must not stop the next pane taking it.
export const OVERLAYS = "[role=dialog]:not([data-slot^=toast-viewport] *), [role=alertdialog]:not([data-slot^=toast-viewport] *), [role=menu], [role=listbox], [data-slot=popover-popup], [data-berth-overlay]";

export function overlayOpen(): boolean {
  return !!document.querySelector(OVERLAYS);
}
