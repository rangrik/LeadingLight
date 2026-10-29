import { Globe } from "lucide-react";
import { type RefObject, useState } from "react";
import { Combobox, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup } from "@leadinglight/ui/components/combobox";
import { browserSuggestions, type BrowserEntry } from "~/lib/browser-data";

type Props = { value: string; history: BrowserEntry[]; inputRef: RefObject<HTMLInputElement | null>; onChange(value: string): void; onNavigate(value: string): void; onFocus(): void; onEdit(): void };

// COSS's single-select combobox keeps address suggestions keyboard accessible.
export function BrowserAddress({ value, history, inputRef, onChange, onNavigate, onFocus, onEdit }: Props) {
  const [open, setOpen] = useState(false);
  const entries = browserSuggestions(history, value);
  return <form className="-order-1 mx-1 min-w-0 basis-full flex-1 @min-[420px]/browser:order-none @min-[420px]/browser:basis-0" onSubmit={(event) => { event.preventDefault(); setOpen(false); onNavigate(value); }}>
    <Combobox<BrowserEntry> autoHighlight={false} filter={null} inputValue={value} items={entries} itemToStringLabel={(entry) => entry.url} modal={false} openOnInputClick={false} onInputValueChange={(next, event) => { if (event.reason === "input-change") { onChange(next); setOpen(true); } }} onOpenChange={setOpen} onValueChange={(entry) => { if (entry) { setOpen(false); onNavigate(entry.url); } }} open={open && entries.length > 0} value={null}>
      <ComboboxInput aria-label="Address" autoCapitalize="off" autoComplete="off" autoCorrect="off" onInput={onEdit} onFocus={(event) => { onFocus(); event.currentTarget.select(); }} onKeyDown={(event) => {
        if (event.key === "Escape" && open && entries.length) event.stopPropagation();
        if (event.key === "Enter" && !event.nativeEvent.isComposing && !event.currentTarget.getAttribute("aria-activedescendant")) {
          event.preventDefault(); event.stopPropagation(); setOpen(false); onNavigate(event.currentTarget.value);
        }
      }} placeholder="Search or enter address" ref={inputRef} showTrigger={false} size="sm" spellCheck={false} startAddon={<Globe className="size-4 text-muted-foreground" />} />
      <ComboboxPopup data-browser-address-popup="true"><ComboboxList>{(entry: BrowserEntry) => <ComboboxItem key={entry.url} value={entry}><span className="min-w-0"><span className="block truncate">{entry.title || entry.url}</span><span className="block truncate text-xs text-muted-foreground">{entry.url}</span></span></ComboboxItem>}</ComboboxList></ComboboxPopup>
    </Combobox>
  </form>;
}
