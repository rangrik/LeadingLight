import { keysFor, SHORTCUTS } from "@/lib/shortcuts";
import { localPrefs } from "~/lib/local-prefs";
import { isNative } from "~/lib/platform";

// The keys changed in Settings › Shortcuts (features/shortcuts.feature), by id; the rest keep
// lib/shortcuts.json's. They are written into the table itself, so Shipyard's sheet shows them too.
const prefs = localPrefs<{ keys: Record<string, string> }>("ll.shortcuts", { keys: {} });
// Damaged storage is dropped, not trusted: a bad key would stop the app from starting.
const ACCEL = /^(?=.*Ctrl\+)(Ctrl\+)?(CmdOrCtrl\+)?(Alt\+)?(Shift\+)?[A-Z0-9/\\,.=\-[\];']$/;
const stored: unknown = prefs.get().keys;
if (!stored || typeof stored !== "object" || !Object.values(stored).every((v) => ACCEL.test(v))) prefs.set({ keys: {} });
const DEFAULTS = new Map(SHORTCUTS.map((s) => [s.id, { accel: s.accel, keys: s.keys }]));

const SIGNS: [string, string][] = [["Ctrl", "⌃"], ["Alt", "⌥"], ["Shift", "⇧"], ["CmdOrCtrl", "⌘"]];
// An accelerator as a Mac menu writes it.
export const keysOf = (accel: string) => {
  const parts = accel.split("+");
  return SIGNS.filter(([m]) => parts.includes(m)).map(([, sign]) => sign).join("") + parts[parts.length - 1];
};

function apply(keys: Record<string, string>) {
  for (const s of SHORTCUTS) {
    const mine = keys[s.id];
    const d = DEFAULTS.get(s.id)!;
    s.accel = mine ?? d.accel;
    s.keys = mine ? keysOf(mine) : d.keys;
  }
}
apply(prefs.get().keys);

// Punctuation keys as accelerators name them; keys not here can't be a shortcut.
const CODES: Record<string, string | undefined> = {
  Slash: "/", Backslash: "\\", Comma: ",", Period: ".", Equal: "=", Minus: "-", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'",
};

// The accelerator a key press spells, by physical key so Option and Shift (which change e.key) still match.
export function accelOf(e: KeyboardEvent): string | undefined {
  const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : CODES[e.code];
  if (!key || !(e.metaKey || e.ctrlKey)) return;
  return [e.ctrlKey && "Ctrl", e.metaKey && "CmdOrCtrl", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join("+");
}

// What macOS and the editor do with a key. In the Mac app a menu key beats the editor's, so these stay theirs.
const TAKEN: Record<string, string> = {
  "⌘C": "Copy", "⌘V": "Paste", "⌘X": "Cut", "⌘A": "Select all", "⌘Z": "Undo", "⇧⌘Z": "Redo", "⌘Y": "Redo", "⌘F": "Find",
  "⌘Q": "Quit", "⌘H": "Hide", "⌥⌘H": "Hide others", "⌘M": "Minimize", "⌘W": "Close", "⌃⌘F": "Full screen",
  "⌘B": "Bold", "⌘I": "Italic", "⌘U": "Underline", "⇧⌘S": "Strikethrough", "⌘E": "Code", "⇧⌘H": "Highlight", "⇧⌘M": "Add sidenote",
  "⌘D": "Duplicate", "⌘G": "Group", "⌘/": "Block menu", "⇧⌘B": "Quote", "⇧⌘7": "Numbered list", "⇧⌘8": "Bulleted list", "⇧⌘9": "To-do list",
  "⌥⌘C": "Code block", "⌥⌘0": "Text", ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`⌥⌘${n}`, `Heading ${n}`])),
};

// Why id can't have these keys, or nothing when it can. ⌃ and a letter move the cursor in text.
export function refuse(id: string, accel: string): string | undefined {
  const other = SHORTCUTS.find((s) => s.id !== id && s.accel === accel);
  const keys = other?.keys ?? keysOf(accel);
  const what = other ? other.label.replace(/…$/, "") : (TAKEN[keys] ?? (/^Ctrl\+[A-Z]$/.test(accel) ? "editing text" : undefined));
  return what && `${keys} is already used for ${what}.`;
}

// The Mac app's menu bar and its global ⌃⌥I take keys before the page (lib.rs); hold lets every key through.
async function toNative(hold = false) {
  if (!(await isNative)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("shortcuts_set", { keys: Object.fromEntries(SHORTCUTS.map((s) => [s.id, hold ? null : (s.accel ?? null)])) });
}
export const holdKeys = (hold: boolean) => void toNative(hold).catch(console.error);

// At launch the menu bar has the table's keys; changed ones are sent once the page is up.
export function sendKeys() {
  if (Object.keys(prefs.get().keys).length) holdKeys(false);
}

// Gives an error to show, or nothing once id has the keys. No accel puts the default back.
export async function setKeys(id: string, accel?: string): Promise<string | undefined> {
  const before = prefs.get().keys;
  const { [id]: _, ...keys } = before;
  const want = accel ?? DEFAULTS.get(id)?.accel ?? "";
  // A reset is refused too when another shortcut has taken the default since.
  const why = refuse(id, want);
  if (why) return why;
  if (want !== DEFAULTS.get(id)?.accel) keys[id] = want;
  const save = (k: Record<string, string>) => {
    apply(k);
    prefs.set({ keys: k });
  };
  save(keys);
  try {
    await toNative();
  } catch {
    // Only the global ⌃⌥I can be refused: another app holds the keys.
    save(before);
    holdKeys(false);
    return `macOS would not give ${keysOf(want)} to LeadingLight. Another app may have it.`;
  }
}

export const defaultKeys = (id: string) => DEFAULTS.get(id)?.keys;

// keysFor, for a component that shows a change at once.
export function useKeysFor() {
  prefs.use();
  return keysFor;
}
