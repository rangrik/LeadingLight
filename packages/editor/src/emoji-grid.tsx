import { type Ref, useEffect, useState } from "react";
import { Input } from "@leadinglight/ui/components/input";

type Emoji = { emoji: string; name: string; words: string[] };
type Group = { name: string; emojis: Emoji[] };

// The full set with search words, loaded on first use so it stays out of the main bundle.
let data: Promise<Group[]> | undefined;
function load() {
  data ??= Promise.all([import("unicode-emoji-json/data-by-group.json"), import("emojilib")]).then(([groups, lib]) =>
    groups.default.map((g) => ({
      name: g.name,
      emojis: g.emojis.map((e) => ({
        emoji: e.emoji,
        name: e.name,
        words: (lib.default[e.emoji] ?? []).join(" ").replaceAll("_", " ").toLowerCase().split(" "),
      })),
    })),
  );
  return data;
}

// Best first: a whole word of the name, a name word ending in it ("airplane" for "plane"), a
// search word, then partial matches. Search words match from their start: "happy" isn't "unhappy".
function search(groups: Group[], q: string): Emoji[] {
  const rank = (e: Emoji) => {
    const name = e.name.toLowerCase();
    const words = name.split(" ");
    if (words.includes(q)) return 0;
    if (words.some((w) => w.endsWith(q))) return 1;
    if (e.words.includes(q)) return 2;
    if (words.some((w) => w.startsWith(q))) return 3;
    if (name.includes(q)) return 4;
    return e.words.some((w) => w.startsWith(q)) ? 5 : 6;
  };
  return groups
    .flatMap((g) => g.emojis)
    .map((e) => ({ e, r: rank(e) }))
    .filter(({ r }) => r < 6)
    .sort((a, b) => a.r - b.r)
    .map(({ e }) => e);
}

// Flags and keycaps aren't pictographs, so they are named here.
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;

// Search plus every emoji in groups. Typing or pasting an emoji picks it straight away.
export function EmojiGrid({ onPick, inputRef }: { onPick: (emoji: string) => void; inputRef?: Ref<HTMLInputElement> }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    void load().then((g) => live && setGroups(g));
    return () => {
      live = false;
    };
  }, []);

  const onInput = (value: string) => {
    const first = [...new Intl.Segmenter().segment(value)][0]?.segment;
    if (first && EMOJI.test(first)) return onPick(first);
    setQuery(value);
  };
  const q = query.trim().toLowerCase();
  const shown = q && groups ? [{ name: "Results", emojis: search(groups, q) }] : (groups ?? []);

  return (
    <>
      <Input
        aria-label="Search emoji"
        onChange={(e) => onInput(e.currentTarget.value)}
        placeholder="Search, or type an emoji"
        ref={inputRef}
        size="sm"
        type="search"
        value={query}
      />
      <div className="-mx-1 mt-2 h-56 overflow-y-auto">
        {shown.map(
          (g) =>
            g.emojis.length > 0 && (
              <div aria-label={g.name} key={g.name} role="group">
                {!q && <div className="px-1 pt-2 pb-1 font-medium text-muted-foreground text-xs">{g.name}</div>}
                <div className="grid grid-cols-8">
                  {g.emojis.map((e) => (
                    // Plain buttons with COSS's ghost look: about 1,900 COSS Buttons open too slowly.
                    <button
                      aria-label={e.name}
                      className="flex h-8 items-center justify-center rounded-md text-xl hover:bg-accent"
                      key={e.emoji}
                      onClick={() => onPick(e.emoji)}
                      type="button"
                    >
                      {e.emoji}
                    </button>
                  ))}
                </div>
              </div>
            ),
        )}
        {groups && q && shown[0]?.emojis.length === 0 && <p className="px-1 py-2 text-muted-foreground text-sm">No results</p>}
      </div>
    </>
  );
}
