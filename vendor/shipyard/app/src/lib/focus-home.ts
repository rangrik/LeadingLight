import { type RefObject, useEffect } from "react";

import { OVERLAYS } from "@/lib/overlays";

// Focus is designed: when what had the keyboard goes away (a dialog, sheet
// or popover closes and its opener is gone, a pane closes, a step of a page
// changes), the keyboard lands somewhere sensible, never on <body>. Only the
// DOM is read here, so the ui primitives can use it without importing the
// stores.
//
// Home is, in order: the focused pane of the shown tab (its terminal, or its
// panel's first field or control), the launcher's first row, something a
// view marked with data-focus-home, and else the main area itself.

const FIELD = "[contenteditable=true], textarea:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled])";
const CONTROL = "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

// Shown and reachable: not under an inert region (a chat's terminal, say).
const shown = (el: Element): el is HTMLElement => el instanceof HTMLElement && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[inert]");

// firstFocusable is where the keyboard starts inside a region: what a view
// marked data-autofocus, else its first field, else its first control.
export function firstFocusable(root: ParentNode | null | undefined, keep: (el: HTMLElement) => boolean = () => true): HTMLElement | undefined {
  if (!root) return undefined;
  for (const sel of ["[data-autofocus]", FIELD, CONTROL]) {
    // data-focus-skip: a way back, or a toolbar's refresh, which is never
    // where a step starts.
    const hit = [...root.querySelectorAll(sel)].find((el): el is HTMLElement => shown(el) && keep(el) && !el.closest("[data-focus-skip]"));
    if (hit) return hit;
  }
  return undefined;
}

export function homeTarget(): HTMLElement | undefined {
  const main = document.querySelector("main");
  if (!main) return undefined;
  const pane = [...main.querySelectorAll("[data-pane-focused]")].find(shown);
  if (pane) {
    // The pane's own content, past a split pane's header buttons.
    const t = firstFocusable(pane, (el) => !el.closest(".group\\/header"));
    if (t) return t;
  }
  const marked = [...main.querySelectorAll("[data-focus-home], [data-row]")].find(shown);
  if (marked) return marked;
  if (main instanceof HTMLElement) {
    if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
    main.style.outline = "none";
    return main;
  }
  return undefined;
}

const lost = () => {
  const a = document.activeElement;
  return !a || a === document.body || !a.isConnected;
};

// focusHome moves the keyboard home now, unless an overlay has it.
export function focusHome(): boolean {
  if (document.querySelector(OVERLAYS)) return false;
  const t = homeTarget();
  t?.focus({ preventScroll: true });
  return !!t && document.activeElement === t;
}

// rescueFocus waits for whatever is about to take the keyboard (a primitive
// returning focus to its trigger, a view's own autofocus), then sends it
// home if nothing did. Safe to call from anywhere and more than once.
let pending = 0;
export function rescueFocus(delay = 60) {
  window.clearTimeout(pending);
  pending = window.setTimeout(() => {
    if (lost()) focusHome();
  }, delay);
}

// focusWithin puts the keyboard on a region's first field or control once
// it has rendered: a page's new step, a pane that just opened.
export function focusWithin(get: () => ParentNode | null | undefined, delay = 0) {
  window.setTimeout(() => {
    if (document.querySelector(OVERLAYS)) return;
    firstFocusable(get())?.focus({ preventScroll: true });
  }, delay);
}

// FocusRescue goes inside a dialog, sheet or popover popup: when the popup
// unmounts and its opener is gone (a menu item, a closed pane, a confirm
// opened by a shortcut), the keyboard goes home instead of to <body>.
export function FocusRescue(): null {
  useEffect(() => () => rescueFocus(), []);
  return null;
}

// useKeepFocusIn keeps the keyboard inside a region that swaps its content
// in place (a page that goes a step at a time): whenever what had focus is
// replaced and the keyboard falls to <body>, it goes to the region's first
// field or control. Fields that autofocus themselves win.
export function useKeepFocusIn(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer = 0;
    const check = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (lost() && !document.querySelector(OVERLAYS)) firstFocusable(el)?.focus({ preventScroll: true });
      }, 30);
    };
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    check();
    return () => {
      mo.disconnect();
      window.clearTimeout(timer);
    };
  }, [ref]);
}

// focusNewPane gives the keyboard to the pane that just opened (a panel
// from the New tab menu): once the menu is gone and the pane has something
// to focus, its first field or control. Gives up after three seconds.
export function focusNewPane() {
  // A pane can take a while to draw its content (a file read from the box),
  // and the pane in front until then is the old one: wait for another.
  const until = Date.now() + 3000;
  const before = document.querySelector("main [data-pane-focused]");
  // Its field (a file's editor, a reply box) once drawn, over a toolbar's
  // button; a pane with none gets its first control after a moment.
  const fieldsFirst = Date.now() + 1500;
  const tick = () => {
    const now = document.querySelector("main [data-pane-focused]");
    const pane = now !== before ? now : null;
    const keep = (el: HTMLElement) => !el.closest(".group\\/header") && (Date.now() > fieldsFirst || el.matches(`[data-autofocus], ${FIELD}`));
    const t = !document.querySelector(OVERLAYS) && pane ? firstFocusable(pane, keep) : undefined;
    if (t) {
      t.focus({ preventScroll: true });
      // Writing carries on from the end, not above what is there.
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) {
        try {
          t.setSelectionRange(t.value.length, t.value.length);
        } catch {
          // Some inputs (number, email) have no selection.
        }
      }
    } else if (Date.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// useRescueRemovedFocus is the window's net: when what had the keyboard is
// taken out of the page (a permission answered, a form submitted, a row
// that redraws), the keyboard goes home rather than to <body>. Only then:
// a click on the page's background, which leaves the last control in
// place, is left alone, so a selection being made isn't disturbed.
export function useRescueRemovedFocus() {
  useEffect(() => {
    let last: Element | null = null;
    const onIn = (e: FocusEvent) => {
      last = e.target instanceof Element ? e.target : null;
    };
    const mo = new MutationObserver(() => {
      if (!last || !lost()) return;
      // Looked at once per loss: gone, or hidden with its tab, it is
      // rescued; still there, the person clicked away from it.
      const gone = !last.isConnected || last.getClientRects().length === 0;
      last = null;
      if (gone) rescueFocus();
    });
    document.addEventListener("focusin", onIn);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("focusin", onIn);
      mo.disconnect();
    };
  }, []);
}
