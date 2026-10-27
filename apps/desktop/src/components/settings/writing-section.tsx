import { keysFor } from "@/lib/shortcuts";
import { Segmented } from "@/views/settings/controls";
import { SettingsGroup, SettingsPage, SettingsRow, useSettingsRow } from "@/views/settings/rows";
import { type Check, CHECKS, type Part, PARTS } from "@leadinglight/editor/writing";
import { Button } from "@leadinglight/ui/components/button";
import { Checkbox } from "@leadinglight/ui/components/checkbox";
import { CheckboxGroup } from "@leadinglight/ui/components/checkbox-group";
import { Field, FieldItem, FieldLabel } from "@leadinglight/ui/components/field";
import { Fieldset } from "@leadinglight/ui/components/fieldset";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Switch } from "@leadinglight/ui/components/switch";
import { cn } from "@leadinglight/ui/lib/utils";
import { RowIcon } from "~/components/page-icon";
import type { TypeDef } from "~/lib/catalog";
import { space } from "~/lib/space";
import { type Tool, setWritingPrefs, suggested, toolsOn, useWritingPrefs } from "~/lib/writing";

const PART_LABEL: Record<Part, string> = { noun: "Nouns", verb: "Verbs", adjective: "Adjectives", adverb: "Adverbs", conjunction: "Conjunctions" };
const CHECK_LABEL: Record<Check, string> = { filler: "Fillers", redundancy: "Redundancies", cliche: "Clichés" };
// Only a switch sits beside its label; any other control goes on its own line below it.
const STACK = "flex-col items-stretch gap-3";
// A tool and the choice under it read as one block: no line between them, the choice indented
// and close.
const HAS_CHOICE = "border-b-0";
const UNDER = `ps-6 pt-0 ${STACK}`;

// A tool's shortcut beside its switch, in COSS's Kbd.
function ToolSwitch({ tool, on }: { tool: Tool; on: boolean }) {
  return (
    <>
      <Kbd>{keysFor(tool)}</Kbd>
      <Switch checked={on} onCheckedChange={(v) => setWritingPrefs({ [tool]: v })} />
    </>
  );
}

// Settings › Writing: iA Writer's editor aids (features/writing.feature). A switch turns each on,
// checkboxes choose any of a tool's kinds, and the pages they work on are chosen by type.
export function WritingSection() {
  const p = useWritingPrefs();
  const { types } = space.use();
  const usedOn = types.filter((t) => toolsOn(p, t.id)).map((t) => t.id);
  // Only what differs from the suggestion is kept, so a later suggestion still reaches the rest.
  const useOn = (ids: string[]) =>
    setWritingPrefs({ types: Object.fromEntries(types.filter((t) => ids.includes(t.id) !== suggested(t.id)).map((t) => [t.id, ids.includes(t.id)])) });

  return (
    <SettingsPage title="Writing" description="Aids for writing, after iA Writer. They change how a page looks to you, never what it says.">
      <SettingsGroup title="Tools">
        <SettingsRow className={HAS_CHOICE} label="Focus mode" description="Keeps the line you are writing in the middle of the page.">
          <ToolSwitch on={p.focus} tool="focus" />
        </SettingsRow>
        <SettingsRow className={UNDER} label="Focus on" description="Sentence and Paragraph dim the rest of the page. Typewriter dims nothing.">
          {/* Greyed and out of reach while Focus mode is off, as COSS's disabled controls are. */}
          <div className={cn("transition-opacity duration-150", !p.focus && "pointer-events-none opacity-64")} inert={!p.focus}>
            <Segmented
              value={p.focusOn}
              options={[
                { value: "sentence", label: "Sentence" },
                { value: "paragraph", label: "Paragraph" },
                { value: "typewriter", label: "Typewriter" },
              ]}
              onChange={(focusOn) => setWritingPrefs({ focusOn })}
            />
          </div>
        </SettingsRow>
        <SettingsRow className={HAS_CHOICE} label="Syntax highlight" description="Colours parts of speech, in English, so you can see how each sentence is built.">
          <ToolSwitch on={p.syntax} tool="syntax" />
        </SettingsRow>
        <SettingsRow className={UNDER} label="Parts of speech">
          <Choices
            all={PARTS}
            disabled={!p.syntax}
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
        <SettingsRow className={HAS_CHOICE} label="Style check" description="Strikes through words that add nothing, in English. Nothing is deleted.">
          <ToolSwitch on={p.style} tool="style" />
        </SettingsRow>
        <SettingsRow className={UNDER} label="Strike through">
          <Choices all={CHECKS} disabled={!p.style} label={(check) => CHECK_LABEL[check]} onChange={(checks) => setWritingPrefs({ checks })} value={p.checks} />
        </SettingsRow>
        <SettingsRow label="Grammar check" description="Underlines misspellings in red and grammar in green, found on this Mac by Harper.">
          <ToolSwitch on={p.grammar} tool="grammar" />
        </SettingsRow>
        <SettingsRow label="Counts" description="Words, reading time, parts of speech, style and grammar beside the page's name.">
          <ToolSwitch on={p.count} tool="count" />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Types of pages">
        <SettingsRow
          className={STACK}
          description={
            <>
              Suggested: on for pages you write in, off for records such as people and books.{" "}
              {Object.keys(p.types).length > 0 && (
                <Button className="h-auto p-0 text-desc" onClick={() => setWritingPrefs({ types: {} })} size="sm" variant="link">
                  Use suggestions
                </Button>
              )}
            </>
          }
          label="Use the tools on"
        >
          <TypeChoices onChange={useOn} types={types} value={usedOn} />
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}

// Pages chosen by their type, here and in Settings › AI › Tail's Reads on.
export function TypeChoices({ types, value, onChange }: { types: TypeDef[]; value: string[]; onChange(ids: string[]): void }) {
  return (
    <Choices
      all={types.map((t) => t.id)}
      columns={3}
      label={(id) => {
        const t = types.find((x) => x.id === id)!;
        return (
          <>
            <RowIcon icon={t.icon} />
            {t.plural}
          </>
        );
      }}
      onChange={onChange}
      value={value}
    />
  );
}

// Any of a few: COSS's checkbox group field (coss.com/ui/r/p-field-13.json), whose labels grey out
// with the field. A short list runs on one line; a longer one sits in even columns.
function Choices<T extends string>({ all, value, onChange, label, disabled, columns }: { all: T[]; value: T[]; onChange(v: T[]): void; label(v: T): React.ReactNode; disabled?: boolean; columns?: number }) {
  const row = useSettingsRow();
  return (
    <Field disabled={disabled} render={(props) => <Fieldset {...props} aria-describedby={row?.describedBy} aria-labelledby={row?.labelledBy} />}>
      <CheckboxGroup
        aria-labelledby={row?.labelledBy}
        className={columns ? "grid gap-x-6 gap-y-3" : "flex-row flex-wrap gap-x-6 gap-y-3"}
        disabled={disabled}
        onValueChange={(v) => onChange(all.filter((x) => v.includes(x)))}
        style={columns ? { gridTemplateColumns: `repeat(${columns}, 10rem)` } : undefined}
        value={value}
      >
        {all.map((v) => (
          <FieldItem key={v}>
            <FieldLabel>
              <Checkbox value={v} />
              {label(v)}
            </FieldLabel>
          </FieldItem>
        ))}
      </CheckboxGroup>
    </Field>
  );
}
