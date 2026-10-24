// Shipyard's Shortcuts section (vendor/shipyard/app/src/views/settings/shortcuts-section.tsx),
// made ours. Changes: each key is a button that records new keys (ShortcutRow); no Labs badge;
// macOS wording only.
import { RotateCcw, SearchIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { describe, SHORTCUT_GROUPS, SHORTCUTS } from "@/lib/shortcuts";
import { SettingsGroup, SettingsPage, SettingsRow } from "@/views/settings/rows";
import { Button } from "@leadinglight/ui/components/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { accelOf, defaultKeys, holdKeys, refuse, setKeys, useKeysFor } from "~/lib/keymap";

const MODIFIERS = new Set(["Meta", "Control", "Alt", "Shift"]);

// A shortcut's keys as a button: click it, then press the new keys (features/shortcuts.feature).
export function ShortcutRow({ id, label, description, className }: { id: string; label: string; description?: ReactNode; className?: string }) {
  const keys = useKeysFor()(id);
  const fallback = defaultKeys(id);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string>();
  // The Mac menu bar would take keys such as ⌘N before this button sees them.
  useEffect(() => {
    if (!recording) return;
    holdKeys(true);
    return () => holdKeys(false);
  }, [recording]);
  const hint = error ?? (recording ? `Esc keeps ${keys}` : undefined);
  // The last hint stays in the tip while it fades out.
  const tip = useRef({ text: "", error: false });
  if (hint) tip.current = { text: hint, error: Boolean(error) };
  const stop = () => {
    setRecording(false);
    setError(undefined);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!recording || e.key === "Tab" || MODIFIERS.has(e.key)) return;
    e.preventDefault();
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) return stop();
    const accel = accelOf(e.nativeEvent);
    const why = accel ? refuse(id, accel) : "Hold ⌘ or ⌃ with a letter, number or symbol.";
    if (why) return setError(why);
    stop();
    void setKeys(id, accel).then(setError);
  };
  // Nothing beside the label changes size, so the row never reflows: the reset button keeps its
  // place while hidden, and the hint floats over the key button.
  return (
    <SettingsRow className={className} description={description} label={label}>
      <Tooltip>
        <TooltipTrigger
          className={cn((keys === fallback || recording) && "invisible")}
          render={
            <Button
              aria-label={`Use ${fallback} again`}
              // Focused, so a refusal's tip goes once the focus does (WebKit won't focus on click).
              onBlur={() => setError(undefined)}
              onClick={(e) => (e.currentTarget.focus(), void setKeys(id).then(setError))}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <RotateCcw />
        </TooltipTrigger>
        <TooltipPopup>Use {fallback} again</TooltipPopup>
      </Tooltip>
      <Tooltip open={hint !== undefined}>
        <TooltipTrigger
          render={
            <Button
              aria-label={`Keys for ${describe(SHORTCUTS.find((s) => s.id === id)!)}`}
              aria-pressed={recording}
              className="min-w-24 font-normal"
              onBlur={stop}
              // WebKit doesn't focus a button on click, and the keys come to the focused one.
              onClick={(e) => (recording ? stop() : (e.currentTarget.focus(), setError(undefined), setRecording(true)))}
              onKeyDown={onKeyDown}
              size="sm"
              variant="outline"
            />
          }
        >
          {recording ? <span className="text-muted-foreground">Type keys</span> : keys}
        </TooltipTrigger>
        {/* A new text is a new tip: Base UI keeps the first text's width otherwise. */}
        <TooltipPopup className={cn(tip.current.error && "text-destructive-foreground")} key={tip.current.text}>
          <span role={tip.current.error ? "alert" : undefined}>{tip.current.text}</span>
        </TooltipPopup>
      </Tooltip>
    </SettingsRow>
  );
}

export function ShortcutsSection() {
  const [query, setQuery] = useState("");
  const keysFor = useKeysFor();
  const q = query.trim().toLowerCase();
  const grouped = SHORTCUT_GROUPS.map((title) => ({
    title,
    items: SHORTCUTS.filter((s) => s.group === title && (!q || describe(s).toLowerCase().includes(q) || keysFor(s.id)?.toLowerCase().includes(q))),
  })).filter((g) => g.items.length > 0);

  return (
    <SettingsPage title="Shortcuts" description="Click a shortcut's keys to change them. In the Mac app they're in the menu bar too.">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input size="sm" className="ps-7" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search shortcuts" aria-label="Search shortcuts" />
      </div>
      {grouped.length === 0 && <p className="text-muted-foreground text-body">No shortcut matches “{query}”.</p>}
      {grouped.map((g) => (
        <SettingsGroup key={g.title} title={g.title}>
          {g.items.map((s) => (
            <ShortcutRow className="min-h-10 py-2" id={s.id} key={s.id} label={describe(s)} />
          ))}
        </SettingsGroup>
      ))}
    </SettingsPage>
  );
}
