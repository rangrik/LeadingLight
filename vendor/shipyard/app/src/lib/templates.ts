import type { TaskTemplate, TemplateVariable } from "@/lib/api";

const placeholder = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

// templateVariables lists the inputs a template needs: its declared
// variables, then any other {{var}} in its prompt or branch. {{name}} is the
// task's own name and is never asked for separately.
export function templateVariables(t?: TaskTemplate): TemplateVariable[] {
  if (!t) return [];
  const vars = [...(t.variables ?? [])];
  for (const text of [t.prompt, t.branch]) {
    for (const m of (text ?? "").matchAll(placeholder)) {
      if (m[1] !== "name" && !vars.some((v) => v.id === m[1])) vars.push({ id: m[1] });
    }
  }
  return vars.filter((v) => v.id !== "name");
}

// fill replaces {{var}} placeholders; unknown ones become empty.
export function fill(text: string | undefined, values: Record<string, string>): string | undefined {
  if (text === undefined) return undefined;
  return text.replace(placeholder, (_, id: string) => values[id] ?? "");
}

export const labelFor = (v: TemplateVariable) => v.label ?? v.id.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
