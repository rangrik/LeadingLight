import { ArrowLeft, Info, Keyboard, Palette } from "lucide-react";
import { type ComponentType, useEffect } from "react";
import { useStore } from "@/lib/store";
import { closeSettings, openSettings, type SettingsSectionId } from "@/views/settings/open";
import { ShortcutsSection } from "@/views/settings/shortcuts-section";
import { Kbd } from "@leadinglight/ui/components/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@leadinglight/ui/components/sidebar";
import { PanelHeader } from "~/components/panel-header";
import { AboutSection } from "~/components/settings/about-section";
import { AppearanceSection } from "~/components/settings/appearance-section";
import { AppSidebarHeader } from "~/components/sidebar/app-sidebar";

// Settings in the app's own shell: our sidebar lists the sections, the inset panel shows
// one. Appearance and About are ours; Shortcuts is Shipyard's (vendor/shipyard); the ones
// about agents, machines and Shipyard's own General stay out until there is ours behind them.
const SECTIONS: { id: SettingsSectionId; title: string; icon: ComponentType<{ className?: string }>; Component: ComponentType }[] = [
  { id: "appearance", title: "Appearance", icon: Palette, Component: AppearanceSection },
  { id: "shortcuts", title: "Shortcuts", icon: Keyboard, Component: ShortcutsSection },
  { id: "about", title: "About", icon: Info, Component: AboutSection },
];

export function SettingsView({ open, onOpenChange, style }: { open: boolean; onOpenChange: (open: boolean) => void; style?: React.CSSProperties }) {
  const view = useStore((s) => s.view);
  const id = (view.kind === "settings" && SECTIONS.some((s) => s.id === view.section) ? view.section : "appearance") as SettingsSectionId;
  const current = SECTIONS.find((s) => s.id === id)!;

  // Esc goes back to the app, unless something in the page has it (a field, a menu or a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox]")) return;
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      closeSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <SidebarProvider className="isolate h-svh overflow-hidden" onOpenChange={onOpenChange} open={open} style={style}>
      <SettingsSidebar current={id} />
      <SidebarInset className="h-svh overflow-hidden md:h-[calc(100svh_-_1rem)]">
        <PanelHeader current={current.title} root="Settings" sidebarOpen={open} />
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid={`settings-${id}`}>
          <current.Component key={id} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function SettingsSidebar({ current }: { current: SettingsSectionId }) {
  const { isMobile, state } = useSidebar();
  return (
    <Sidebar inert={!isMobile && state === "collapsed"} variant="inset">
      <AppSidebarHeader subtitle="Settings" />
      <SidebarContent>
        <nav aria-label="Settings sections">
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={closeSettings}>
                  <ArrowLeft />
                  <span>Back to app</span>
                  <Kbd className="ml-auto">esc</Kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Settings</SidebarGroupLabel>
            <SidebarMenu>
              {SECTIONS.map((s) => (
                <SidebarMenuItem key={s.id}>
                  <SidebarMenuButton
                    aria-current={s.id === current ? "page" : undefined}
                    data-testid={`settings-nav-${s.id}`}
                    isActive={s.id === current}
                    onClick={() => openSettings(s.id)}
                  >
                    <s.icon />
                    <span>{s.title}</span>
                    {/* The build beside About, so a glance says which app this is. */}
                    {s.id === "about" && <span className="ml-auto text-xs tabular-nums opacity-60">{__LL_COMMIT__}</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
