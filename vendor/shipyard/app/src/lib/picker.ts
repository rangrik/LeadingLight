// The element picker: in the human's browser tab, hover highlights an
// element and a click picks it. The pick says what the agent needs to find
// the same element in its own browser (same URL, same origin): its role and
// name, a unique selector (data-testid, then id, then a path), a little of
// its HTML, its box and a few styles. It is sent to the worktree's agent as
// a short prompt.

export interface Pick {
  url: string;
  role: string;
  name: string;
  selector: string;
  html: string;
  bbox: { x: number; y: number; w: number; h: number };
  styles: Record<string, string>;
}

// PICKER_SCRIPT runs in the page. It reports by navigating to
// berth-pick://pick?d=<json>, which the app cancels and reads (in an
// iframe it calls window.parent.__berthPick instead). Esc cancels.
export const PICKER_SCRIPT = `(() => {
  if (window.__berthPicker) return;
  window.__berthPicker = true;
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #6366f1;background:rgba(99,102,241,.12);border-radius:3px;transition:all 40ms";
  const tip = document.createElement("div");
  tip.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;font:12px system-ui;background:#111827;color:#fff;padding:2px 6px;border-radius:4px";
  document.documentElement.append(box, tip);
  const esc = (s) => String(s).replace(/["\\\\]/g, "\\\\$&");
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };
  const selectorOf = (el) => {
    const tid = el.closest("[data-testid]");
    if (tid === el) { const s = '[data-testid="' + esc(el.getAttribute("data-testid")) + '"]'; if (unique(s)) return s; }
    if (el.id) { const s = "#" + CSS.escape(el.id); if (unique(s)) return s; }
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 6; e = e.parentElement) {
      if (e.id && unique("#" + CSS.escape(e.id))) { parts.unshift("#" + CSS.escape(e.id)); break; }
      const tag = e.tagName.toLowerCase();
      const sib = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      parts.unshift(sib.length > 1 ? tag + ":nth-of-type(" + (sib.indexOf(e) + 1) + ")" : tag);
      if (unique(parts.join(" > "))) break;
    }
    return parts.join(" > ");
  };
  const roleOf = (el) => el.getAttribute("role") || ({ A: "link", BUTTON: "button", INPUT: el.type === "checkbox" ? "checkbox" : "textbox", TEXTAREA: "textbox", SELECT: "combobox", IMG: "img", H1: "heading", H2: "heading", H3: "heading" })[el.tagName] || el.tagName.toLowerCase();
  const nameOf = (el) => (el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("placeholder") || el.innerText || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 80);
  const move = (e) => {
    const el = e.target; if (!el || el === box) return;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    tip.textContent = roleOf(el) + (nameOf(el) ? ' "' + nameOf(el).slice(0, 40) + '"' : "");
    Object.assign(tip.style, { left: r.left + "px", top: Math.max(0, r.top - 22) + "px" });
  };
  const done = () => { removeEventListener("mousemove", move, true); removeEventListener("click", click, true); removeEventListener("keydown", key, true); box.remove(); tip.remove(); window.__berthPicker = false; };
  const click = (e) => {
    e.preventDefault(); e.stopPropagation();
    const el = e.target; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    const pick = { url: location.href, role: roleOf(el), name: nameOf(el), selector: selectorOf(el), html: el.outerHTML.slice(0, 1024),
      bbox: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      styles: { color: cs.color, background: cs.backgroundColor, font: cs.fontSize + " " + cs.fontWeight, display: cs.display } };
    done();
    if (window.parent !== window && window.parent.__berthPick) window.parent.__berthPick(pick);
    else location.href = "berth-pick://pick?d=" + encodeURIComponent(JSON.stringify(pick));
  };
  const key = (e) => { if (e.key === "Escape") done(); };
  addEventListener("mousemove", move, true); addEventListener("click", click, true); addEventListener("keydown", key, true);
})();`;

// parsePick reads a pick from the berth-pick:// URL the page navigated to.
export function parsePick(url: string): Pick | undefined {
  try {
    const d = new URL(url).searchParams.get("d");
    if (!d) return undefined;
    const p = JSON.parse(d) as Pick;
    if (typeof p.selector !== "string" || typeof p.url !== "string") return undefined;
    return { ...p, html: String(p.html ?? "").slice(0, 1024), name: String(p.name ?? "").slice(0, 80) };
  } catch {
    return undefined;
  }
}

// pickMessage is the prompt a pick sends the agent: about 1.5 KB at most.
export function pickMessage(p: Pick, note: string): string {
  const lines = [
    `I picked an element in the page at ${p.url} (open the same URL in your browser: berthd browser open ${new URL(p.url).pathname}).`,
    `- ${p.role}${p.name ? ` "${p.name}"` : ""}`,
    `- selector: ${p.selector}`,
    `- box: ${p.bbox.w}x${p.bbox.h} at ${p.bbox.x},${p.bbox.y}; ${Object.entries(p.styles)
      .map(([k, v]) => `${k} ${v}`)
      .join("; ")}`,
    `- html: ${p.html.replace(/\s+/g, " ").slice(0, 600)}`,
  ];
  if (note.trim()) lines.push("", note.trim().slice(0, 500));
  return lines.join("\n");
}
