import { CircleSlashIcon } from "lucide-react";

import { AgentIcon } from "@/components/agent-glyph";
import { PickOne } from "@/components/pick-one";
import type { AgentPreset } from "@/lib/api";

// AgentPicker chooses one agent with PickOne, the one pick-one control the
// app shares. "No agent" is offered when allowNone is set.
export function AgentPicker({
  presets,
  value,
  onChange,
  allowNone = false,
  className,
}: {
  presets: Pick<AgentPreset, "id" | "name">[];
  value: string;
  onChange(id: string): void;
  allowNone?: boolean;
  className?: string;
}) {
  const options = allowNone ? [{ id: "", name: "No agent" }, ...presets] : presets;
  return (
    <PickOne
      label="Agent"
      value={value}
      onChange={onChange}
      className={className}
      options={options.map((p) => ({
        value: p.id,
        label: p.name,
        icon: p.id ? <AgentIcon agent={p.id} className="size-3.5" /> : <CircleSlashIcon className="size-3.5" />,
      }))}
    />
  );
}
