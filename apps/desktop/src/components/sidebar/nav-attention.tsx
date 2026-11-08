import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@leadinglight/ui/components/sidebar";
import { ICONS, toggleView } from "~/components/bar";
import { type InboxView, NAMES, useShowing, waiting } from "~/lib/bar";
import { useMobile } from "~/lib/platform";
import { projectPrefs } from "~/lib/project-runtime/prefs";

// What wants the person, where they read (features/bar.feature). A row opens its panel as the
// strip's buttons did, and is marked while the panel shows.
function Row({ view, onSelect }: { view: InboxView; onSelect: () => void }) {
  const on = useShowing(view);
  const n = waiting.use()[view];
  const Icon = ICONS[view];
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-pressed={on}
        isActive={on}
        onClick={() => {
          toggleView(view);
          onSelect();
        }}
      >
        <Icon />
        <span>{NAMES[view]}</span>
      </SidebarMenuButton>
      {/* Half a pixel down puts its 12 px figures on the name's baseline. */}
      {n > 0 && <SidebarMenuBadge className="mt-[0.5px] text-muted-foreground">{n}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

export function NavAttention({ onSelect }: { onSelect: () => void }) {
  const mobile = useMobile();
  const { enabled } = projectPrefs.use();
  // Off the Mac only Captures opens (toggleView); the Feed is the projects' agents.
  const rows: InboxView[] = mobile ? ["captures"] : enabled ? ["feed", "suggestions", "captures"] : ["suggestions", "captures"];
  return (
    <SidebarGroup className="pb-0">
      <SidebarGroupLabel>Attention</SidebarGroupLabel>
      <SidebarMenu>
        {rows.map((v) => (
          <Row key={v} onSelect={onSelect} view={v} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
