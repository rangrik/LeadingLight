// Shipyard's Appearance section (vendor/shipyard/app/src/views/settings/appearance-section.tsx),
// made ours. Changes: the first theme group is "LeadingLight" and nothing points at ~/.berth;
// the card draws a sidebar beside a page, as our shell looks, not a terminal; the header
// picture, chat, sidebar layout and density rows are gone; macOS wording only.
import { CheckIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { SimpleSelect } from "@/components/simple-select";
import { Input } from "@/components/ui/input";
import { SYSTEM_THEME, useActiveTheme, useThemes } from "@/hooks/use-theme";
import type { Theme } from "@/lib/api";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { keysFor } from "@/lib/shortcuts";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { berthThemes } from "@/themes/builtin";
import { Segmented } from "@/views/settings/controls";
import { SettingsGroup, SettingsPage, SettingsRow } from "@/views/settings/rows";
import { Dots } from "@/views/settings/theme-preview";
import { closeSettings } from "@/views/settings/open";
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from "@leadinglight/ui/components/number-field";
import { Switch } from "@leadinglight/ui/components/switch";
import { contentWidth, setPageLayout, usePageLayout } from "~/lib/page-layout";

const OWN = new Set(berthThemes.map((t) => t.id));

export function AppearanceSection() {
  const themes = useThemes();
  const themeId = useStore((s) => s.themeId);
  const uiFontSize = usePrefs((p) => p.uiFontSize);
  const layout = usePageLayout();
  const [width, setWidth] = useState<number | null>(() => contentWidth(layout.width));
  const [query, setQuery] = useState("");

  const [all, setAll] = useState(false);
  const system = themeId === SYSTEM_THEME;
  const active = useActiveTheme();
  const selectedId = system ? active.id : themeId;

  // Our own, then the ports by appearance, the best-known first; a search narrows
  // them by name. Unsearched, each group shows a row of four, plus the chosen
  // theme, until Show more.
  const q = query.trim().toLowerCase();
  const shown = q ? themes.filter((t) => t.name.toLowerCase().includes(q) || t.id.includes(q)) : themes;
  const groups = [
    { title: "LeadingLight", themes: byFirst(shown.filter((t) => OWN.has(t.id)), OWN_FIRST) },
    { title: "Light", themes: byFirst(shown.filter((t) => !OWN.has(t.id) && t.appearance !== "dark"), LIGHT_FIRST) },
    { title: "Dark", themes: byFirst(shown.filter((t) => !OWN.has(t.id) && t.appearance === "dark"), DARK_FIRST) },
  ]
    .filter((g) => g.themes.length)
    .map((g) => {
      if (q || all || g.title === "LeadingLight") return { ...g, hidden: [] as Theme[] };
      const keep = g.themes.filter((t, i) => i < ROW || t.id === selectedId);
      return { ...g, themes: keep, hidden: g.themes.filter((t) => !keep.includes(t)) };
    });
  const hidden = groups.flatMap((g) => g.hidden);
  const picks = usePrefs((p) => p.systemThemes);
  const mode = system ? "system" : active.appearance === "dark" ? "dark" : "light";
  // Light or Dark keeps the theme when it already is one, else takes the one
  // Match system would use for it.
  const pickMode = (m: "light" | "dark" | "system") => {
    const set = useStore.getState().setTheme;
    if (m === "system") return set(SYSTEM_THEME);
    if (!system && (active.appearance === "dark") === (m === "dark")) return;
    const want = m === "dark" ? picks.dark : picks.light;
    set(themes.some((t) => t.id === want) ? want : m === "dark" ? "berth-dark" : "berth-light");
  };

  return (
    <SettingsPage title="Appearance" description="How LeadingLight looks.">
      <SettingsGroup title="Theme" actions={<span className="text-desc text-muted-foreground">{themes.length} themes</span>}>
        <SettingsRow label="Light or dark" description={system ? <SystemNote themes={themes} /> : "Pick a theme below, or follow the Mac."}>
          <Segmented
            value={mode}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "Match system" },
            ]}
            onChange={pickMode}
          />
        </SettingsRow>
        {system && <SystemPicks themes={themes} />}
      </SettingsGroup>
      <section className="-mt-[27px]">
        {groups.map((g, i) => (
          <div key={g.title} className="mt-5 first:mt-0">
            <div className="mb-1 flex h-6 items-center gap-3">
              <h3 className="flex-1 text-desc text-muted-foreground">{g.title}</h3>
              {i === 0 && (
                <div className="relative w-44 shrink-0">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input size="sm" type="search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Find a theme" aria-label="Find a theme" className="[&_input]:h-6 [&_input]:pl-7.5 [&_input]:text-meta" />
                </div>
              )}
            </div>
            <div className="grid grid-cols-4 gap-x-3 gap-y-3.5 max-[1100px]:grid-cols-3 max-[800px]:grid-cols-2">
              {g.themes.map((t) => (
                <ThemeCard key={t.id} theme={t} selected={t.id === selectedId} following={system} onSelect={() => useStore.getState().setTheme(t.id)} />
              ))}
            </div>
          </div>
        ))}
        {!groups.length && <p className="text-muted-foreground text-meta">No theme is called “{query.trim()}”.</p>}
        {(hidden.length > 0 || all) && !q && (
          <button type="button" onClick={() => setAll((v) => !v)} className="mt-4 flex max-w-full items-baseline gap-2 text-left text-desc">
            <span className="shrink-0 font-medium">{all ? "Show fewer" : `Show ${hidden.length} more`}</span>
            {!all && <span className="truncate text-muted-foreground">{hidden.map((t) => t.name).join(", ")}</span>}
          </button>
        )}
      </section>

      <SettingsGroup title="Interface">
        <SettingsRow label="Full width" description="Let page content fill the available space.">
          <Switch checked={layout.fullWidth} onCheckedChange={(fullWidth) => setPageLayout({ fullWidth })} />
        </SettingsRow>
        <SettingsRow label="Content width" description="Maximum text width in pixels. Narrow panes always fit their content.">
          <NumberField className="w-36" size="sm" min={320} max={1600} step={8} value={width} disabled={layout.fullWidth} onValueChange={setWidth} onValueCommitted={(value) => {
            const width = contentWidth(value ?? layout.width);
            setWidth(width);
            setPageLayout({ width });
          }}>
            <NumberFieldGroup>
              <NumberFieldDecrement aria-label="Narrower content" />
              <NumberFieldInput aria-label="Content width" onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !["Enter", "Escape"].includes(event.key)) return;
                event.preventDefault();
                event.currentTarget.blur();
                if (event.key === "Escape") closeSettings();
              }} />
              <NumberFieldIncrement aria-label="Wider content" />
            </NumberFieldGroup>
          </NumberField>
        </SettingsRow>
        <SettingsRow label="Text size" description={`${keysFor("zoom-in")} and ${keysFor("zoom-out")} step it from 11 to 20 px.`}>
          <Segmented
            value={String(uiFontSize)}
            options={[
              { value: "12", label: "Small" },
              { value: "13", label: "Default" },
              { value: "14", label: "Large" },
              // A size zoomed to (⌘+, ⌘−) that none of these is.
              ...(uiFontSize < 12 || uiFontSize > 14 ? [{ value: String(uiFontSize), label: `${uiFontSize}px` }] : []),
            ]}
            onChange={(v) => setPrefs({ uiFontSize: Number(v) })}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}

// The themes each group leads with, the rest after them in the list's order.
const ROW = 4;
const OWN_FIRST = ["berth-light", "berth-dark", "midnight", "paper"];
const LIGHT_FIRST = ["github-light", "one-light", "catppuccin-latte", "solarized-light"];
const DARK_FIRST = ["dracula", "tokyo-night", "catppuccin-mocha", "nord"];

function byFirst(list: Theme[], first: string[]): Theme[] {
  const rank = (t: Theme) => {
    const i = first.indexOf(t.id);
    return i < 0 ? first.length : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

// Match system follows the Mac: one theme by day, another when it is dark
// (LeadingLight Light and Dark unless picked here).
function useSystemPair(themes: Theme[]) {
  const picks = usePrefs((p) => p.systemThemes);
  const light = themes.find((t) => t.id === picks.light) ?? themes.find((t) => t.id === "berth-light");
  const dark = themes.find((t) => t.id === picks.dark) ?? themes.find((t) => t.id === "berth-dark");
  return { picks, light, dark };
}

function SystemNote({ themes }: { themes: Theme[] }) {
  const { light, dark } = useSystemPair(themes);
  return (
    <>
      {light?.name ?? "A light theme"} by day, {dark?.name ?? "a dark one"} when the Mac is dark.
    </>
  );
}

// SystemPicks chooses the pair Match system switches between.
function SystemPicks({ themes }: { themes: Theme[] }) {
  const { picks, light, dark } = useSystemPair(themes);
  if (!light || !dark) return null;
  const pick = (side: "light" | "dark", id: string) => {
    setPrefs({ systemThemes: { ...picks, [side]: id } });
    useStore.getState().setTheme(SYSTEM_THEME);
  };
  const options = (appearance: "light" | "dark") => themes.filter((t) => (t.appearance === "dark") === (appearance === "dark")).map((t) => ({ value: t.id, label: t.name }));
  return (
    <SettingsRow label="By day, and when it's dark" description="Follows the Mac.">
      <SimpleSelect size="sm" className="w-40" aria-label="Theme by day" value={light.id} options={options("light")} onChange={(id) => id && pick("light", id)} />
      <SimpleSelect size="sm" className="w-40" aria-label="Theme when the Mac is dark" value={dark.id} options={options("dark")} onChange={(id) => id && pick("dark", id)} />
    </SettingsRow>
  );
}

// ThemeCard previews a theme with its own colors, whatever theme the app itself is
// in. Under Match system the theme showing now is ringed more quietly, since it
// isn't picked itself.
function ThemeCard({ theme, selected, following, onSelect }: { theme: Theme; selected: boolean; following?: boolean; onSelect(): void }) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected && !following} data-testid="theme-option" data-theme-id={theme.id} className="group flex flex-col gap-2 text-left outline-none">
      <div
        aria-hidden
        className={cn(
          "relative h-[76px] w-full overflow-hidden rounded-xl border transition-[box-shadow,border-color] group-focus-visible:ring-2 group-focus-visible:ring-ring",
          selected ? "border-transparent ring-2 ring-offset-2 ring-offset-background" : "group-hover:border-foreground/25",
          selected && (following ? "ring-foreground/30" : "ring-foreground"),
        )}
      >
        <Preview theme={theme} />
        <Dots theme={theme} />
      </div>
      <div className="flex items-center gap-2 px-0.5 text-desc">
        <span className={cn("min-w-0 flex-1 truncate", selected && "font-medium")}>{theme.name}</span>
        {selected && (following ? <span className="shrink-0 text-muted-foreground text-meta">Now</span> : <CheckIcon className="size-3.5 shrink-0" />)}
      </div>
    </button>
  );
}

// Preview draws the app in miniature in the theme's colours: the sidebar with a
// selected row, and the inset page with a heading, two lines and a link.
function Preview({ theme }: { theme: Theme }) {
  const c = theme.colors;
  return (
    <div className="flex h-full" style={{ background: c.sidebar }}>
      <div className="flex w-[34%] flex-col gap-1.5 px-2.5 py-2.5">
        <div className="h-1.5 w-4/5 rounded-full" style={{ background: c.sidebarForeground, opacity: 0.55 }} />
        <div className="h-1.5 w-3/5 rounded-full" style={{ background: c.sidebarForeground, opacity: 0.3 }} />
        <div className="h-2 w-full rounded-sm" style={{ background: c.accent }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: c.sidebarForeground, opacity: 0.3 }} />
      </div>
      <div className="my-1.5 mr-1.5 flex flex-1 flex-col gap-1.5 rounded-md border px-2.5 py-2.5" style={{ background: c.background, borderColor: c.border }}>
        <div className="h-2 w-1/2 rounded-full" style={{ background: c.foreground }} />
        <div className="h-1.5 w-full rounded-full" style={{ background: c.mutedForeground, opacity: 0.6 }} />
        <div className="h-1.5 w-4/5 rounded-full" style={{ background: c.mutedForeground, opacity: 0.6 }} />
        <div className="h-1.5 w-2/5 rounded-full" style={{ background: c.primary }} />
      </div>
    </div>
  );
}
