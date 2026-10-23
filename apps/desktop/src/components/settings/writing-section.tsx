import { Segmented } from "@/views/settings/controls";
import { SettingsGroup, SettingsPage, SettingsRow, useSettingsRow } from "@/views/settings/rows";
import { type Check, CHECKS, type Part, PARTS } from "@leadinglight/editor/writing";
import { Switch } from "@leadinglight/ui/components/switch";
import { ToggleGroup, ToggleGroupItem } from "@leadinglight/ui/components/toggle-group";
import { setWritingPrefs, useWritingPrefs } from "~/lib/writing";

const PART_LABEL: Record<Part, string> = { noun: "Nouns", verb: "Verbs", adjective: "Adjectives", adverb: "Adverbs", conjunction: "Conjunctions" };
const CHECK_LABEL: Record<Check, string> = { filler: "Fillers", redundancy: "Redundancies", cliche: "Clichés" };

// Settings › Writing: iA Writer's editor aids (features/writing.feature).
export function WritingSection() {
  const p = useWritingPrefs();
  return (
    <SettingsPage title="Writing" description="Aids for writing, after iA Writer. They change how a page looks to you, never what it says.">
      <SettingsGroup>
        <SettingsRow label="Focus mode" description="⇧⌘F. Keeps the line you are writing in the middle of the page.">
          <Switch checked={p.focus} onCheckedChange={(focus) => setWritingPrefs({ focus })} />
        </SettingsRow>
        <SettingsRow label="Focus on" description="Sentence and Paragraph dim the rest of the page. Typewriter dims nothing.">
          <Segmented
            value={p.focusOn}
            options={[
              { value: "sentence", label: "Sentence" },
              { value: "paragraph", label: "Paragraph" },
              { value: "typewriter", label: "Typewriter" },
            ]}
            onChange={(focusOn) => setWritingPrefs({ focusOn })}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow label="Syntax highlight" description="⇧⌘D. Colours parts of speech, in English, so you can see how each sentence is built.">
          <Switch checked={p.syntax} onCheckedChange={(syntax) => setWritingPrefs({ syntax })} />
        </SettingsRow>
        <SettingsRow label="Colour" description="The parts of speech that get a colour.">
          <PickSome
            all={PARTS}
            label={(part) => (
              <>
                <span className="size-2 rounded-full" style={{ background: `var(--syntax-${part})` }} />
                {PART_LABEL[part]}
              </>
            )}
            onChange={(parts) => setWritingPrefs({ parts })}
            value={p.parts}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow label="Style check" description="⌥⇧⌘D. Strikes through words that add nothing, in English. Nothing is deleted.">
          <Switch checked={p.style} onCheckedChange={(style) => setWritingPrefs({ style })} />
        </SettingsRow>
        <SettingsRow label="Strike through" description="The kinds of words that are struck through.">
          <PickSome all={CHECKS} label={(check) => CHECK_LABEL[check]} onChange={(checks) => setWritingPrefs({ checks })} value={p.checks} />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow label="Grammar check" description="⇧⌘G. Underlines misspellings in red and grammar in green, found on this Mac by Harper. Point at one to see why.">
          <Switch checked={p.grammar} onCheckedChange={(grammar) => setWritingPrefs({ grammar })} />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow label="Counts" description="⇧⌘W. Words, reading time, parts of speech, style and grammar beside the page's name. Select text to count just that.">
          <Switch checked={p.count} onCheckedChange={(count) => setWritingPrefs({ count })} />
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}

// Shipyard's PickOne look (vendor/shipyard/app/src/components/pick-one.tsx), for any number at once.
function PickSome<T extends string>({ all, value, onChange, label }: { all: T[]; value: T[]; onChange(v: T[]): void; label(v: T): React.ReactNode }) {
  const row = useSettingsRow();
  return (
    <ToggleGroup
      aria-describedby={row?.describedBy}
      aria-labelledby={row?.labelledBy}
      className="w-fit max-w-full shrink-0 flex-wrap rounded-lg bg-muted p-0.5"
      multiple
      onValueChange={(v) => onChange(all.filter((x) => v.includes(x)))}
      size="sm"
      value={value}
    >
      {all.map((v) => (
        <ToggleGroupItem
          className="gap-1.5 rounded-md px-2.5 font-normal text-desc text-foreground/80 hover:bg-background/60 hover:text-foreground data-pressed:bg-background data-pressed:font-medium data-pressed:text-foreground data-pressed:shadow-xs/5 dark:hover:bg-input/32 dark:data-pressed:bg-input"
          key={v}
          value={v}
        >
          {label(v)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
