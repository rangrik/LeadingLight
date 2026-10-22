// Worktrees side by side (Labs): the pure part. Each worktree on screen
// wears one colour wherever it shows (its group in the strip, its panes'
// chips and focus lines, its sidebar row), and a name that tells it apart
// from the others there. No imports: pnpm test runs this file as it is.

// The tones, kept clear of the colours that mean an agent's state: amber
// waits, blue runs, green is done, red failed. index.css defines each as
// --wt-<tone>, for light and dark. Listed so that neighbours differ most;
// the last, copper, sits nearest amber, so only a sixth worktree on screen
// wears it.
export const TONES = ["violet", "cyan", "magenta", "slate", "pink", "copper"] as const;
export type Tone = (typeof TONES)[number];
const OWN = TONES.length - 1;

// Tones close enough in hue to be confused side by side.
const NEAR: Partial<Record<Tone, Tone[]>> = { violet: ["magenta"], magenta: ["violet", "pink"], pink: ["magenta"] };

export const isTone = (t: unknown): t is Tone => typeof t === "string" && (TONES as readonly string[]).includes(t);

export const toneVar = (t: Tone) => `var(--wt-${t})`;

// Each tone as OKLCH (lightness, chroma, hue), for light and dark themes.
// themes/tones.ts moves the lightness, never the hue, until it reads on a
// theme's own surfaces; index.css holds the same as a fallback.
export const TONE_LCH: Record<Tone, { light: [number, number, number]; dark: [number, number, number] }> = {
  violet: { light: [0.53, 0.2, 293], dark: [0.74, 0.14, 293] },
  cyan: { light: [0.55, 0.11, 212], dark: [0.77, 0.1, 212] },
  magenta: { light: [0.53, 0.22, 328], dark: [0.73, 0.17, 328] },
  slate: { light: [0.5, 0.02, 265], dark: [0.74, 0.025, 260] },
  pink: { light: [0.6, 0.18, 2], dark: [0.8, 0.11, 2] },
  copper: { light: [0.55, 0.11, 50], dark: [0.76, 0.09, 55] },
};

// hashTone is a worktree's own tone, the same every time.
export function hashTone(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % OWN;
}

// assignTones gives each of keys (in the strip's order) a tone: the one the
// person picked, else its hash's, moved along when an earlier worktree has
// it or one close to it, so worktrees on screen never look alike while
// there are tones enough.
export function assignTones(keys: string[], picked: Record<string, string> = {}): Record<string, Tone> {
  const out: Record<string, Tone> = {};
  const taken = new Set<Tone>();
  for (const k of keys) {
    const p = picked[k];
    if (isTone(p)) {
      out[k] = p;
      taken.add(p);
    }
  }
  const clash = (t: Tone) => taken.has(t) || (NEAR[t] ?? []).some((n) => taken.has(n));
  for (const k of keys) {
    if (out[k]) continue;
    const from = hashTone(k);
    const walk = [...TONES.slice(0, OWN).map((_, n) => TONES[(from + n) % OWN]), ...TONES.slice(OWN)];
    const t = walk.find((x) => !clash(x)) ?? walk.find((x) => !taken.has(x)) ?? walk[0];
    out[k] = t;
    taken.add(t);
  }
  return out;
}

export interface Named {
  key: string;
  name: string;
  box: string;
}

// labelsFor names worktrees as the sidebar does, adding the box when two
// on screen share a name (the same repository on two boxes).
export function labelsFor(list: Named[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of list) out[w.key] = list.some((o) => o.key !== w.key && o.name === w.name) ? `${w.name} · ${w.box}` : w.name;
  return out;
}

// nameFromKey is a worktree's name when nothing lists it any more: the last
// part of its path.
export const nameFromKey = (key: string) => key.slice(key.indexOf(":") + 1).split("/").filter(Boolean).pop() ?? key;

// Below this window width the strip folds every group but the one in front,
// and pane chips shrink to their dot.
export const NARROW = "(max-width: 1099px)";
// Below this, only the group in front shows its tabs; the others wait as
// chips at the strip's end.
export const TINY = "(max-width: 799px)";

// Tab groups: the strip can hold several worktrees' tabs, each run of them a
// group. shown is the groups in order, current the one in front (its
// active tab is the one showing). These keep the two consistent.

export interface Groups {
  shown: string[];
  current?: string;
}

// groupsOf is the groups the strip holds: shown, less what is gone, always
// with current. A current outside shown means the person picked a worktree
// on its own, so it is alone.
export function groupsOf(shown: string[] | undefined, current: string | undefined, exists: (k: string) => boolean = () => true): string[] {
  if (!current) return [];
  const list = (shown ?? []).filter((k, i, all) => exists(k) && all.indexOf(k) === i);
  return list.includes(current) ? list : [current];
}

// withGroup adds key to the strip, after the others or at index at, and
// puts it in front. One already there stays where it is.
export function withGroup(g: Groups, key: string, at?: number): Groups {
  const shown = groupsOf(g.shown, g.current);
  if (shown.includes(key)) return { shown, current: key };
  const i = at === undefined ? shown.length : Math.max(0, Math.min(at, shown.length));
  return { shown: [...shown.slice(0, i), key, ...shown.slice(i)], current: key };
}

// withoutGroup takes key out of the strip; when it was in front, the group
// after it comes forward (else the one before).
export function withoutGroup(g: Groups, key: string): Groups {
  const shown = groupsOf(g.shown, g.current);
  const i = shown.indexOf(key);
  if (i < 0) return { shown, current: g.current };
  const rest = shown.filter((k) => k !== key);
  return { shown: rest, current: g.current === key ? (rest[i] ?? rest[i - 1]) : g.current };
}

// stepGroup is the group after (1) or before (-1) the one in front, round
// the end, skipping none.
export function stepGroup(g: Groups, dir: 1 | -1): string | undefined {
  const shown = groupsOf(g.shown, g.current);
  if (shown.length < 2 || !g.current) return g.current;
  const i = shown.indexOf(g.current);
  return shown[(i + dir + shown.length) % shown.length];
}

// foldedOf is the groups that show only their label: those folded by hand,
// and in a narrow window every group but the one in front. The one in front
// never folds.
export function foldedOf(g: Groups, folded: string[] | undefined, narrow: boolean): string[] {
  const shown = groupsOf(g.shown, g.current);
  if (shown.length < 2) return [];
  return shown.filter((k) => k !== g.current && (narrow || (folded ?? []).includes(k)));
}

// stripTabs lists the tabs ⌘1–9 count: every unfolded group's, in order.
export function stripTabs<T extends { id: string }>(groups: { key: string; tabs: T[]; folded: boolean }[]): { key: string; tab: T }[] {
  return groups.flatMap((g) => (g.folded ? [] : g.tabs.map((tab) => ({ key: g.key, tab }))));
}
