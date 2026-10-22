// The keyboard's way to a right-click menu: Shift-F10 or the menu key on a
// focused element opens its context menu (base-ui's ContextMenu listens
// for the contextmenu event, which WebKit doesn't send for these keys).

export function isContextMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
}

// openContextMenu sends the element the event a right-click would, at its
// bottom-left corner, so the menu opens under it.
export function openContextMenu(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.bottom - 2, button: 2 }));
}
