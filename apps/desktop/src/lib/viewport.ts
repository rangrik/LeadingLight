// iPad's onscreen keyboard changes the visual viewport without resizing the webview.
export function watchViewport() {
  const view = window.visualViewport;
  const root = document.documentElement;
  let frame = 0;
  let settled = 0;
  const size = () => {
    if (view && view.scale !== 1) return;
    root.style.setProperty("--ll-viewport-height", `${view?.height ?? window.innerHeight}px`);
    root.style.setProperty("--ll-viewport-top", `${view?.offsetTop ?? 0}px`);
  };
  const reveal = () => {
    const editor = document.activeElement;
    const selection = window.getSelection();
    if (!(editor instanceof HTMLElement) || !editor.matches(".ProseMirror") || !selection?.focusNode || !editor.contains(selection.focusNode)) return;
    const scroller = editor.closest<HTMLElement>("[data-page-scroller], .ll-capture");
    if (!scroller || (view && view.scale !== 1)) return;
    const range = document.createRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    range.collapse(true);
    const node = selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode.parentElement;
    const caret = range.getClientRects()[0] ?? node?.getBoundingClientRect();
    if (!caret?.height) return;
    const box = scroller.getBoundingClientRect();
    const top = box.top + 12;
    const bottom = box.bottom - 12;
    const delta = caret.bottom > bottom ? caret.bottom - bottom : caret.top < top ? caret.top - top : 0;
    if (delta) scroller.scrollTop += delta;
  };
  const cancelReveal = () => {
    cancelAnimationFrame(frame);
    clearTimeout(settled);
  };
  // Pane heights settle in a ResizeObserver after layout; scrolling waits for the next frame.
  const resize = () => {
    size();
    cancelReveal();
    frame = requestAnimationFrame(() => {
      size();
      frame = requestAnimationFrame(reveal);
    });
    // WebKit may restore its old scroll after layout. One final check yields to any user input.
    settled = window.setTimeout(reveal, 300);
  };
  const resume = () => document.visibilityState === "visible" && resize();
  const inputEvents = ["pointerdown", "touchstart", "wheel", "keydown", "beforeinput", "focusin"];
  resize();
  inputEvents.forEach((event) => document.addEventListener(event, cancelReveal, { capture: true, passive: true }));
  view?.addEventListener("resize", resize);
  view?.addEventListener("scroll", size);
  window.addEventListener("resize", resize);
  window.addEventListener("pageshow", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    cancelReveal();
    inputEvents.forEach((event) => document.removeEventListener(event, cancelReveal, true));
    view?.removeEventListener("resize", resize);
    view?.removeEventListener("scroll", size);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pageshow", resume);
    document.removeEventListener("visibilitychange", resume);
    root.style.removeProperty("--ll-viewport-height");
    root.style.removeProperty("--ll-viewport-top");
  };
}
