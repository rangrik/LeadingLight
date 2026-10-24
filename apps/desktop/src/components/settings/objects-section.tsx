import { closeSettings } from "@/views/settings/open";
import { SettingsGroup, SettingsPage } from "@/views/settings/rows";
import { Button } from "@leadinglight/ui/components/button";
import { RowIcon } from "~/components/page-icon";
import { kinds } from "~/lib/kinds";
import { openPage } from "~/lib/panes";
import { space, typeView } from "~/lib/space";

// Settings › Objects (features/objects.feature): what LeadingLight keeps and shows, in one list.
export function ObjectsSection() {
  const s = space.use();
  const list = kinds(s);
  const show = (typeId: string) => {
    closeSettings();
    openPage(typeView(typeId));
  };
  const group = (widget: boolean) =>
    list
      .filter((k) => !!k.widget === widget)
      .map((k) => {
        const n = k.type ? s.pages.filter((p) => p.typeId === k.type!.id && !p.properties.templateOf).length : 0;
        return (
          <div className="flex items-start gap-3 py-4" data-kind={k.id} key={k.id}>
            <span className="mt-0.5">
              <RowIcon icon={k.icon ?? { kind: "icon", name: k.lucide ?? "box", color: "gray" }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-row">{k.name}</div>
              <p className="mt-[3px] text-desc text-muted-foreground">{k.purpose}</p>
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-desc">
                <dt className="text-muted-foreground">Made by</dt>
                <dd>{k.made}</dd>
                <dt className="text-muted-foreground">Changes</dt>
                <dd>{k.changes}</dd>
                <dt className="text-muted-foreground">Shows in</dt>
                <dd>{k.shows}</dd>
              </dl>
            </div>
            {k.type && (
              <Button onClick={() => show(k.type!.id)} size="sm" variant="outline">
                {n ? `Show ${n}` : "Show"}
              </Button>
            )}
          </div>
        );
      });
  const widgets = group(true);
  return (
    <SettingsPage description="Everything LeadingLight keeps for you and its agents: what each is for, who makes it, what can change, and where it shows." title="Objects">
      <SettingsGroup>{group(false)}</SettingsGroup>
      {widgets.length > 0 && <SettingsGroup title="On a task and in the Feed">{widgets}</SettingsGroup>}
    </SettingsPage>
  );
}
