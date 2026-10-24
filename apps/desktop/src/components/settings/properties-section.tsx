import { useState } from "react";
import { SettingsGroup, SettingsPage } from "@/views/settings/rows";
import { PropertyEditor } from "~/components/property-editor";
import { KIND_ICONS } from "~/components/property-value";
import { ListRow, NewButton } from "~/components/settings/types-section";
import { KINDS, type PropDef } from "~/lib/catalog";
import { space } from "~/lib/space";

// Settings › Properties (features/settings-types-properties.feature): every property, oldest first,
// with the types that use it.
export function PropertiesSection() {
  const { props, types } = space.use();
  const [editing, setEditing] = useState<PropDef | "new" | null>(null);
  const usedBy = (id: string) =>
    types
      .filter((t) => t.props.includes(id))
      .map((t) => t.plural)
      .join(", ");
  return (
    <SettingsPage
      actions={<NewButton label="New property" onClick={() => setEditing("new")} />}
      description="Shared by the whole space. A type shows some on all its pages, and any page can add more."
      title="Properties"
    >
      <SettingsGroup>
        {props.map((p) => {
          const Icon = KIND_ICONS[p.kind];
          return (
            <ListRow
              detail={`${KINDS[p.kind]} · ${usedBy(p.id) || "Not in a type"}`}
              icon={<Icon className="size-4 shrink-0 text-muted-foreground" />}
              key={p.id}
              name={p.name}
              onEdit={() => setEditing(p)}
            />
          );
        })}
      </SettingsGroup>
      {editing && <PropertyEditor onClose={() => setEditing(null)} prop={editing === "new" ? undefined : editing} />}
    </SettingsPage>
  );
}
