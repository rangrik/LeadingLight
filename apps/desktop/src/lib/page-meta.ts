// A page's icon and cover, stored in its properties under "icon" and "cover".

// Full class names, so Tailwind finds them. Covers are soft bands; icons use the strong shade.
export const COLORS = {
  gray: { name: "Gray", text: "text-neutral-500 dark:text-neutral-400", dot: "bg-neutral-500", band: "bg-neutral-200 dark:bg-neutral-800" },
  red: { name: "Red", text: "text-red-500 dark:text-red-400", dot: "bg-red-500", band: "bg-red-200 dark:bg-red-900" },
  orange: { name: "Orange", text: "text-orange-500 dark:text-orange-400", dot: "bg-orange-500", band: "bg-orange-200 dark:bg-orange-900" },
  yellow: { name: "Yellow", text: "text-amber-500 dark:text-amber-400", dot: "bg-amber-500", band: "bg-yellow-200 dark:bg-yellow-800" },
  green: { name: "Green", text: "text-green-600 dark:text-green-400", dot: "bg-green-600", band: "bg-green-200 dark:bg-green-900" },
  teal: { name: "Teal", text: "text-teal-600 dark:text-teal-400", dot: "bg-teal-600", band: "bg-teal-200 dark:bg-teal-900" },
  blue: { name: "Blue", text: "text-blue-500 dark:text-blue-400", dot: "bg-blue-500", band: "bg-blue-200 dark:bg-blue-900" },
  purple: { name: "Purple", text: "text-violet-500 dark:text-violet-400", dot: "bg-violet-500", band: "bg-violet-200 dark:bg-violet-900" },
  pink: { name: "Pink", text: "text-pink-500 dark:text-pink-400", dot: "bg-pink-500", band: "bg-pink-200 dark:bg-pink-900" },
};

export type Color = keyof typeof COLORS;
export type PageIcon = { kind: "emoji"; emoji: string } | { kind: "icon"; name: string; color: Color } | { kind: "image"; url: string };
export type Credit = { name: string; profile: string };
export type PageCover = { kind: "color"; color: Color } | { kind: "image"; url: string; y: number; unsplash?: Credit };

const isColor = (c: unknown): c is Color => typeof c === "string" && c in COLORS;
const asRecord = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

// Anything else stored there (a later version's kind, say) reads as no icon and is left alone.
export function readIcon(value: unknown): PageIcon | undefined {
  const v = asRecord(value);
  if (v.kind === "emoji" && typeof v.emoji === "string") return { kind: "emoji", emoji: v.emoji };
  if (v.kind === "icon" && typeof v.name === "string") return { kind: "icon", name: v.name, color: isColor(v.color) ? v.color : "gray" };
  if (v.kind === "image" && typeof v.url === "string") return { kind: "image", url: v.url };
  return undefined;
}

export function readCover(value: unknown): PageCover | undefined {
  const v = asRecord(value);
  if (v.kind === "color" && isColor(v.color)) return { kind: "color", color: v.color };
  if (v.kind === "image" && typeof v.url === "string") {
    const c = asRecord(v.unsplash);
    const unsplash = typeof c.name === "string" && typeof c.profile === "string" ? { name: c.name, profile: c.profile } : undefined;
    return { kind: "image", url: v.url, y: typeof v.y === "number" ? v.y : 50, ...(unsplash && { unsplash }) };
  }
  return undefined;
}
