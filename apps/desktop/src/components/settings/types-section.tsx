import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { SettingsGroup, SettingsPage } from "@/views/settings/rows";
import { Button } from "@leadinglight/ui/components/button";
import { RowIcon } from "~/components/page-icon";
import { TypeSettings } from "~/components/type-view";
import type { TypeDef } from "~/lib/catalog";
import { space } from "~/lib/space";

// Settings › Types (features/settings-types-properties.feature): every type, in the sidebar's order.
export function TypesSection() {
  const { types, pages } = space.use();
  const [editing, setEditing] = useState<TypeDef | "new" | null>(null);
  const count = (id: string) => pages.filter((p) => p.typeId === id && !p.properties.templateOf).length;
  return (
    <SettingsPage
      actions={<NewButton label="New type" onClick={() => setEditing("new")} />}
      description="Every page has a type, which gives it an icon and a set of properties."
      title="Types"
    >
      <SettingsGroup>
        {types.map((t) => {
          const n = count(t.id);
          return <ListRow detail={`${n} ${n === 1 ? "page" : "pages"}`} icon={<RowIcon icon={t.icon} />} key={t.id} name={t.plural} onEdit={() => setEditing(t)} />;
        })}
      </SettingsGroup>
      {editing && <TypeSettings onClose={() => setEditing(null)} type={editing === "new" ? undefined : editing} />}
    </SettingsPage>
  );
}

export const NewButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Button onClick={onClick} size="sm" variant="outline">
    <Plus />
    {label}
  </Button>
);

// A row in a Settings list: icon, name, a muted line, and Edit. Both lines cut rather than wrap,
// so every row keeps one height.
export function ListRow({ icon, name, detail, onEdit }: { icon: ReactNode; name: string; detail: string; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-3 py-4">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-row">{name}</div>
        <div className="mt-[3px] truncate text-desc text-muted-foreground">{detail}</div>
      </div>
      <Button aria-label={`Edit ${name}`} onClick={onEdit} size="sm" variant="outline">
        Edit
      </Button>
    </div>
  );
}
