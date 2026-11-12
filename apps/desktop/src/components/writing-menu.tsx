import { Focus } from "lucide-react";
import { useStore } from "@/lib/store";
import { Button } from "@leadinglight/ui/components/button";
import { Menu, MenuCheckboxItem, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger, MenuSub, MenuSubTrigger, MenuSubPopup } from "@leadinglight/ui/components/menu";
import { cn } from "@leadinglight/ui/lib/utils";
import { liveEditor } from "~/lib/live";
import { useKeysFor } from "~/lib/keymap";
import { type Tool, toggleTool, useBackToPage, useWritingPrefs } from "~/lib/writing";

const TOOLS: { id: Tool; label: string }[] = [
  { id: "focus", label: "Focus mode" },
  { id: "syntax", label: "Syntax highlight" },
  { id: "style", label: "Style check" },
  { id: "grammar", label: "Grammar check" },
  { id: "count", label: "Counts" },
];

// The writing tools at the page panel's top right, like iA Writer's Focus menu in its title bar.
export function WritingMenu({ className, pageId, submenu = false }: { className?: string; pageId: string; submenu?: boolean }) {
  const prefs = useWritingPrefs();
  const back = useBackToPage();
  const keysFor = useKeysFor();
  const Root = submenu ? MenuSub : Menu;
  const Popup = submenu ? MenuSubPopup : MenuPopup;
  return (
    <Root>
      {submenu ? <MenuSubTrigger><Focus className="size-4" />Writing tools</MenuSubTrigger> : <MenuTrigger onPointerDown={back.onPointerDown} render={<Button aria-label="Writing" className={cn("size-7", className)} size="icon" variant="ghost" />}>
        <Focus />
      </MenuTrigger>}
      <Popup align="end" className="w-60" finalFocus={back.finalFocus}>
        <MenuItem onClick={() => liveEditor(pageId)?.reviewWriting()}>Review writing</MenuItem>
        <MenuSeparator />
        {TOOLS.map((t) => (
          <MenuCheckboxItem checked={prefs[t.id]} closeOnClick key={t.id} onCheckedChange={() => toggleTool(t.id)}>
            <span className="flex items-center">
              {t.label}
              <MenuShortcut>{keysFor(t.id)}</MenuShortcut>
            </span>
          </MenuCheckboxItem>
        ))}
        <MenuSeparator />
        <MenuItem className="ps-7" onClick={() => useStore.getState().setView({ kind: "settings", section: "writing" })}>
          Writing settings…
        </MenuItem>
      </Popup>
    </Root>
  );
}
