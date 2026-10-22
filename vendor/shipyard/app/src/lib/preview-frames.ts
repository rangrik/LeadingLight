// The Preview tab shows a worktree's page at several sizes at once: Tailwind's
// breakpoints, phones and a tablet, each in an iframe at its real CSS width,
// scaled to fit. These are its pure parts, the sizes, settings, layout and
// the messages its frames send, so they are easy to check
// (preview-frames.test.ts). The frames' own script is the laptop proxy's
// (internal/proxy/preview.js), which only Preview frames get.

export type FrameKind = "breakpoint" | "phone" | "tablet" | "custom";
export type Theme = "auto" | "light" | "dark";
export type Strategy = "auto" | "media" | "class" | "data-theme";
export type Layout = "row" | "grid" | "fit";
export type ScrollSync = "proportional" | "anchor";

export interface Preset {
  id: string;
  label: string;
  // What it is, for a tooltip: "Tailwind md and up", "iPhone 15".
  detail: string;
  kind: FrameKind;
  w: number;
  // Phones and tablets have their own height; breakpoints take the
  // settings' height.
  h?: number;
}

export const PRESETS: Preset[] = [
  { id: "phone", label: "Phone", detail: "iPhone 15 / 16", kind: "phone", w: 390, h: 844 },
  { id: "phone-max", label: "Phone Max", detail: "iPhone 15 / 16 Pro Max", kind: "phone", w: 430, h: 932 },
  { id: "tablet", label: "Tablet", detail: "iPad Air", kind: "tablet", w: 820, h: 1180 },
  { id: "sm", label: "sm", detail: "Tailwind sm: 640px and up", kind: "breakpoint", w: 640 },
  { id: "md", label: "md", detail: "Tailwind md: 768px and up", kind: "breakpoint", w: 768 },
  { id: "lg", label: "lg", detail: "Tailwind lg: 1024px and up", kind: "breakpoint", w: 1024 },
  { id: "xl", label: "xl", detail: "Tailwind xl: 1280px and up", kind: "breakpoint", w: 1280 },
  { id: "2xl", label: "2xl", detail: "Tailwind 2xl: 1536px and up", kind: "breakpoint", w: 1536 },
];

// The most frames a Preview tab shows at once: each is a whole page.
export const MAX_FRAMES = 10;
export const MIN_WIDTH = 240;
export const MAX_WIDTH = 3840;
export const HEIGHTS = [720, 800, 900, 1080] as const;

export interface PreviewSettings {
  // The sizes shown, in order: preset ids and custom widths ("w500").
  sizes: string[];
  // Custom widths offered alongside the presets.
  custom: number[];
  layout: Layout;
  // Synced: navigation, scrolling (and, when mirror is on, clicks and
  // typing) in one frame happen in all. Isolated: each frame on its own.
  sync: boolean;
  scroll: ScrollSync;
  mirror: boolean;
  // Light or dark for all frames, and per frame (an override by frame id).
  theme: Theme;
  themes: Record<string, Theme>;
  // How a theme is forced: the page's prefers-color-scheme rules, a .dark
  // class, or data-theme; auto uses what the page's own styles key on.
  strategy: Strategy;
  // Phones and tablets turned sideways.
  rotated: string[];
  // A breakpoint frame's height.
  height: number;
}

export const DEFAULT_SETTINGS: PreviewSettings = {
  sizes: ["phone", "md", "lg", "xl"],
  custom: [],
  layout: "fit",
  sync: true,
  scroll: "proportional",
  mirror: false,
  theme: "auto",
  themes: {},
  strategy: "auto",
  rotated: [],
  height: 900,
};

const THEMES: Theme[] = ["auto", "light", "dark"];
const STRATEGIES: Strategy[] = ["auto", "media", "class", "data-theme"];
const LAYOUTS: Layout[] = ["row", "grid", "fit"];

export const customId = (w: number) => `w${w}`;
const customWidth = (id: string) => (/^w\d+$/.test(id) ? Number(id.slice(1)) : undefined);

export function clampWidth(w: number): number | undefined {
  if (!Number.isFinite(w)) return undefined;
  const n = Math.round(w);
  return n >= MIN_WIDTH && n <= MAX_WIDTH ? n : undefined;
}

// normalizeSettings reads settings as they were saved, by an older version
// or by hand, keeping what still makes sense.
export function normalizeSettings(raw: unknown): PreviewSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof PreviewSettings, unknown>>;
  const d = DEFAULT_SETTINGS;
  const custom = Array.isArray(r.custom) ? [...new Set(r.custom.map(Number).map(clampWidth).filter((n): n is number => n !== undefined))].sort((a, b) => a - b) : [];
  const known = (id: string) => PRESETS.some((p) => p.id === id) || (customWidth(id) !== undefined && custom.includes(customWidth(id)!));
  const sizes = Array.isArray(r.sizes) ? [...new Set(r.sizes.filter((s): s is string => typeof s === "string" && known(s)))].slice(0, MAX_FRAMES) : d.sizes;
  const themes: Record<string, Theme> = {};
  if (r.themes && typeof r.themes === "object") for (const [k, v] of Object.entries(r.themes)) if (THEMES.includes(v as Theme) && v !== "auto") themes[k] = v as Theme;
  return {
    sizes: sizes.length ? sizes : d.sizes,
    custom,
    layout: LAYOUTS.includes(r.layout as Layout) ? (r.layout as Layout) : d.layout,
    sync: typeof r.sync === "boolean" ? r.sync : d.sync,
    scroll: r.scroll === "anchor" ? "anchor" : "proportional",
    mirror: typeof r.mirror === "boolean" ? r.mirror : d.mirror,
    theme: THEMES.includes(r.theme as Theme) ? (r.theme as Theme) : d.theme,
    themes,
    strategy: STRATEGIES.includes(r.strategy as Strategy) ? (r.strategy as Strategy) : d.strategy,
    rotated: Array.isArray(r.rotated) ? r.rotated.filter((s): s is string => typeof s === "string") : [],
    height: typeof r.height === "number" && r.height >= 320 && r.height <= 2400 ? Math.round(r.height) : d.height,
  };
}

export interface Frame {
  id: string;
  label: string;
  detail: string;
  kind: FrameKind;
  w: number;
  h: number;
  rotated: boolean;
  theme: Theme;
}

// framesOf is the frames the settings show, in the order of the sizes they
// list, narrowest first within each kind as listed.
export function framesOf(s: PreviewSettings): Frame[] {
  const out: Frame[] = [];
  for (const id of s.sizes) {
    const p = PRESETS.find((x) => x.id === id);
    const cw = customWidth(id);
    if (!p && cw === undefined) continue;
    const base = p ?? { id, label: `${cw}`, detail: `${cw}px wide`, kind: "custom" as const, w: cw!, h: undefined };
    const device = base.kind === "phone" || base.kind === "tablet";
    const rotated = device && s.rotated.includes(id);
    const w = base.w;
    const h = base.h ?? s.height;
    out.push({ id, label: base.label, detail: base.detail, kind: base.kind, w: rotated ? h : w, h: rotated ? w : h, rotated, theme: s.themes[id] ?? s.theme });
  }
  return out;
}

// sortSizes keeps the shown sizes in a sensible order: devices first, then
// breakpoints and custom widths by width.
export function sortSizes(ids: string[]): string[] {
  const rank = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (p && p.kind !== "breakpoint") return PRESETS.indexOf(p);
    return 100 + (p?.w ?? customWidth(id) ?? 0);
  };
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

// The space around frames, in CSS pixels of the pane.
export const GAP = 16;
export const PAD = 16;
export const LABEL = 28;

export interface Placed {
  scale: number;
}

// scales is each frame's scale for a layout in a pane of avail size:
//   row  - a filmstrip: each frame as tall as the pane, scrolling sideways;
//   grid - one scale for all, so sizes compare honestly: the widest frame
//          fills the pane's width, and the rest wrap below;
//   fit  - one scale for all, the largest at which every frame fits in the
//          pane without scrolling.
// Never above 1: a frame is never shown bigger than its real size.
export function scales(frames: Pick<Frame, "w" | "h">[], layout: Layout, avail: { w: number; h: number }): number[] {
  if (!frames.length) return [];
  const W = Math.max(1, avail.w - 2 * PAD);
  const H = Math.max(1, avail.h - 2 * PAD - LABEL);
  if (layout === "row") return frames.map((f) => Math.min(1, H / f.h));
  if (layout === "grid") {
    const s = Math.min(1, W / Math.max(...frames.map((f) => f.w)));
    return frames.map(() => s);
  }
  const s = fitScale(frames, W, avail.h - 2 * PAD);
  return frames.map(() => s);
}

// fitScale is the largest scale at which frames, wrapped into rows left to
// right as the pane lays them out, fit in w by h (labels included).
export function fitScale(frames: Pick<Frame, "w" | "h">[], w: number, h: number): number {
  const fits = (s: number) => packedHeight(frames, s, w) <= h;
  let lo = 0.02;
  let hi = 1;
  if (fits(hi)) return 1;
  if (!fits(lo)) return lo;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 1000) / 1000;
}

// packedHeight is how tall frames wrapped into rows at scale s are, in a
// width w, or Infinity when one is wider than w.
export function packedHeight(frames: Pick<Frame, "w" | "h">[], s: number, w: number): number {
  let total = 0;
  let rowW = 0;
  let rowH = 0;
  for (const f of frames) {
    const fw = f.w * s;
    const fh = f.h * s + LABEL;
    if (fw > w) return Infinity;
    if (rowW > 0 && rowW + GAP + fw > w) {
      total += rowH + GAP;
      rowW = 0;
      rowH = 0;
    }
    rowW += (rowW > 0 ? GAP : 0) + fw;
    rowH = Math.max(rowH, fh);
  }
  return total + rowH;
}

export const percent = (s: number) => `${Math.round(s * 100)}%`;

// ---- Addresses -----------------------------------------------------------

// PREVIEW_PARAM marks a Preview frame's first request; the laptop's proxy
// gives such a page the preview script and takes the flag off.
export const PREVIEW_PARAM = "__berth_preview";
// A frame's name tells the script it is a Preview frame, and how to start.
export const FRAME_NAME = "berth-preview:";

export function flagged(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(PREVIEW_PARAM, "1");
    return u.toString();
  } catch {
    return url;
  }
}

export function unflagged(url: string): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has(PREVIEW_PARAM)) return url;
    u.searchParams.delete(PREVIEW_PARAM);
    return u.toString();
  } catch {
    return url;
  }
}

export function frameName(id: string, theme: Theme, strategy: Strategy): string {
  return FRAME_NAME + JSON.stringify({ id, theme, strategy });
}

// proxied is a page through the laptop's proxy (any *.localhost), which can
// be framed and synced. Other sites mostly refuse to be framed.
export function proxied(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && (u.hostname === "localhost" || u.hostname.endsWith(".localhost"));
  } catch {
    return false;
  }
}

export function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

// sameOrigin says a frame's reported address can be shown in the others: a
// Preview tab's frames all show one site.
export function sameOrigin(a: string, b: string): boolean {
  const x = originOf(a);
  return !!x && x === originOf(b);
}

// ---- Messages ------------------------------------------------------------

// What a frame's script tells the app (preview.js).
export type FrameMessage =
  | { type: "hello"; url: string; title?: string; detected?: string; dark?: boolean }
  | { type: "nav"; url: string; title?: string }
  | { type: "detected"; detected: string }
  | { type: "scroll"; sel: string; x: number; y: number; anchor?: string; frac?: number }
  | { type: "click"; sel: string }
  | { type: "input"; sel: string; value: string; checked?: boolean; kind?: string }
  | { type: "submit"; sel: string }
  // data: the frame as a PNG; svg: as an SVG to draw here, when the page's
  // policy kept the frame from drawing it.
  | { type: "shot"; req: string; data?: string; svg?: string; width?: number; height?: number; error?: string };

// parseMessage reads a message from a frame, or undefined for anything that
// isn't one (the page's own messages, a malformed one).
export function parseMessage(data: unknown): (FrameMessage & { id: string }) | undefined {
  if (!data || typeof data !== "object") return undefined;
  const m = data as Record<string, unknown>;
  if (m.berth !== "preview" || typeof m.id !== "string" || typeof m.type !== "string") return undefined;
  const str = (k: string) => typeof m[k] === "string";
  switch (m.type) {
    case "hello":
    case "nav":
      return str("url") ? (m as unknown as FrameMessage & { id: string }) : undefined;
    case "detected":
      return str("detected") ? (m as unknown as FrameMessage & { id: string }) : undefined;
    case "scroll":
      return typeof m.x === "number" && typeof m.y === "number" ? (m as unknown as FrameMessage & { id: string }) : undefined;
    case "click":
    case "submit":
      return str("sel") ? (m as unknown as FrameMessage & { id: string }) : undefined;
    case "input":
      return str("sel") && str("value") ? (m as unknown as FrameMessage & { id: string }) : undefined;
    case "shot":
      return str("req") ? (m as unknown as FrameMessage & { id: string }) : undefined;
  }
  return undefined;
}

// relay is what the other frames are told when one reports something, in
// synced mode: navigation always, scrolling, and clicks and typing when
// mirrored. Nothing in isolated mode.
export function relay(m: FrameMessage, s: Pick<PreviewSettings, "sync" | "mirror" | "scroll">): Record<string, unknown> | undefined {
  if (!s.sync) return undefined;
  switch (m.type) {
    case "nav":
      return { type: "navigate", url: m.url };
    case "scroll":
      return { type: "scroll", sel: m.sel, x: m.x, y: m.y, anchor: m.anchor, frac: m.frac, mode: s.scroll };
    case "click":
      return s.mirror ? { type: "click", sel: m.sel } : undefined;
    case "input":
      return s.mirror ? { type: "input", sel: m.sel, value: m.value, checked: m.checked, kind: m.kind } : undefined;
    case "submit":
      return s.mirror ? { type: "submit", sel: m.sel } : undefined;
  }
  return undefined;
}

// strategyLabel names what auto found the page keys its theme on.
export function strategyLabel(s: Strategy | string | undefined): string {
  switch (s) {
    case "media":
      return "prefers-color-scheme";
    case "class":
      return ".dark class";
    case "data-theme":
      return "data-theme";
    case "none":
      return "no dark styles found";
    default:
      return "auto";
  }
}

// ---- Screenshot ------------------------------------------------------------

export interface SheetTile {
  x: number;
  y: number;
  w: number;
  h: number;
}

// sheetLayout places frames for one picture of them all: side by side at a
// common scale, wrapping to stay under maxWidth, with a label above each.
export function sheetLayout(frames: Pick<Frame, "w" | "h">[], opts: { scale: number; gap: number; label: number; pad: number; maxWidth: number }): { tiles: SheetTile[]; width: number; height: number } {
  const tiles: SheetTile[] = [];
  let x = opts.pad;
  let y = opts.pad;
  let rowH = 0;
  let width = 0;
  for (const f of frames) {
    const w = Math.round(f.w * opts.scale);
    const h = Math.round(f.h * opts.scale);
    if (x > opts.pad && x + w + opts.pad > opts.maxWidth) {
      x = opts.pad;
      y += rowH + opts.gap;
      rowH = 0;
    }
    tiles.push({ x, y: y + opts.label, w, h });
    x += w + opts.gap;
    rowH = Math.max(rowH, h + opts.label);
    width = Math.max(width, x - opts.gap + opts.pad);
  }
  return { tiles, width, height: y + rowH + opts.pad };
}
