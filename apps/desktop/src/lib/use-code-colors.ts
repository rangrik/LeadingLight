import { useEffect } from "react";
import { useActiveTheme } from "@/hooks/use-theme";
import { over, readable } from "@/themes/color";

// The editor's code blocks take their token colours from the theme's terminal
// palette (packages/editor/src/editor.css reads --code-*), each moved in
// lightness until it reads on the code block's background.
export function useCodeColors() {
  const theme = useActiveTheme();
  useEffect(() => {
    const t = theme.terminal;
    const bg = over(theme.colors.muted, theme.colors.background);
    const root = document.documentElement.style;
    const set = (name: string, colour: string) => root.setProperty(`--code-${name}`, readable(colour, bg));
    // Comments take the theme's muted text: a terminal's bright black can be
    // darker than its text (Solarized Light's is near black).
    set("comment", theme.colors.mutedForeground);
    set("keyword", t.magenta);
    set("string", t.green);
    set("number", t.yellow);
    set("title", t.blue);
    set("type", t.cyan);
    // Syntax highlight's parts of speech, in iA Writer's hues, readable on the page itself.
    const page = theme.colors.background;
    const parts = { noun: t.red, verb: t.blue, adjective: t.yellow, adverb: t.magenta, conjunction: t.green };
    for (const [part, colour] of Object.entries(parts)) root.setProperty(`--syntax-${part}`, readable(colour, page));
  }, [theme]);
}
