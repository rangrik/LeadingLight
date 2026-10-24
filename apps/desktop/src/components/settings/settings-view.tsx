import { ArrowLeft, Info, Keyboard, Lightbulb, Palette, PenLine, Shapes, SlidersHorizontal, Sparkles } from "lucide-react";
import { type ComponentType, useEffect } from "react";
import { useStore } from "@/lib/store";
import { closeSettings } from "@/views/settings/open";
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
  SidebarTrigger,
  useSidebar,
} from "@leadinglight/ui/components/sidebar";
import { PanelHeader } from "~/components/panel-header";
import { AboutSection } from "~/components/settings/about-section";
import { AiSection } from "~/components/settings/ai-section";
import { AppearanceSection } from "~/components/settings/appearance-section";
import { CaptureSection } from "~/components/settings/capture-section";
import { PropertiesSection } from "~/components/settings/properties-section";
import { TypesSection } from "~/components/settings/types-section";
import { WritingSection } from "~/components/settings/writing-section";
import { AppSidebarHeader } from "~/components/sidebar/app-sidebar";

// Settings in the app's own shell: our sidebar lists the sections, the inset panel shows
// one. Shortcuts is Shipyard's (vendor/shipyard), the rest are ours; the ones about agents,
// machines and Shipyard's own General stay out until there is ours.
export type SectionId = "appearance" | "writing" | "types" | "properties" | "capture" | "ai" | "shortcuts" | "about";

const SECTIONS: { id: SectionId; title: string; icon: ComponentType<{ className?: string }>; Component: ComponentType }[] = [
  { id: "appearance", title: "Appearance", icon: Palette, Component: AppearanceSection },
  { id: "writing", title: "Writing", icon: PenLine, Component: WritingSection },
  { id: "types", title: "Types", icon: Shapes, Component: TypesSection },
  { id: "properties", title: "Properties", icon: SlidersHorizontal, Component: PropertiesSection },
  { id: "capture", title: "Capture", icon: Lightbulb, Component: CaptureSection },
  { id: "ai", title: "AI", icon: Sparkles, Component: AiSection },
  { id: "shortcuts", title: "Shortcuts", icon: Keyboard, Component: ShortcutsSection },
  { id: "about", title: "About", icon: Info, Component: AboutSection },
];

export const openSection = (id: SectionId) => useStore.getState().setView({ kind: "settings", section: id });

type Props = { open: boolean; onOpenChange: (open: boolean) => void; style?: React.CSSProperties; windowToggle?: boolean };

export function SettingsView({ open, onOpenChange, style, windowToggle }: Props) {
  const view = useStore((s) => s.view);
  const id = (view.kind === "settings" && SECTIONS.some((s) => s.id === view.section) ? view.section : "appearance") as SectionId;
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
      {/* Where the app's shell has it, beside the traffic lights (App.tsx). */}
      {windowToggle && <SidebarTrigger className="fixed top-2.5 left-[86px] z-20" />}
      <SettingsSidebar current={id} />
      <SidebarInset className="h-svh overflow-hidden md:h-[calc(100svh_-_1rem)]">
        <PanelHeader current={current.title} root="Settings" sidebarOpen={open} toggle={!windowToggle} />
        {/* Keyed here, so each section opens at its top. */}
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid={`settings-${id}`} key={id}>
          <current.Component />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function SettingsSidebar({ current }: { current: SectionId }) {
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
                    onClick={() => openSection(s.id)}
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
