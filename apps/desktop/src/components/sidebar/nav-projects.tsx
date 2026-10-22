// shadcn sidebar-08 (base-vega) nav-projects, on COSS primitives (DropdownMenu* is COSS Menu*).
// Changes: pages instead of projects, a New page action and empty text, rows select instead of
// linking, Delete wired; View/Share and the trailing "More" row dropped (nothing behind them yet);
// a page's Thoughts page and essay hang under it on a tree (see Children).
import { Ellipsis, Plus, Trash } from "lucide-react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect } from "react";
import { cn } from "@leadinglight/ui/lib/utils";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@leadinglight/ui/components/menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@leadinglight/ui/components/sidebar";

type Child = { name: string; isActive: boolean; onSelect: () => void; onDelete: () => void };

// The tree after xevrion's sidebar submenu (MIT, github.com/xevrion/ui-lab): a trunk from the page
// with a curved branch to each child, and the branch to the open child drawn in the primary colour,
// sliding when another child opens. Changes: COSS's sub rows (28px, 4px apart), no section bar.
const ROW = 32;
const TOP = 2;
const TRUNK = 0.5;
const BEND = 6;
const REACH = 12;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SLIDE = { type: "spring", visualDuration: 0.35, bounce: 0.12 } as const;
const rowMiddle = (i: number) => TOP + i * ROW + 14;
const branch = (y: number) => `M${TRUNK} ${y - BEND} Q${TRUNK} ${y} ${TRUNK + BEND} ${y} H${REACH}`;

function Children({ items }: { items: Child[] }) {
  const reduce = useReducedMotion() ?? false;
  const active = items.findIndex((c) => c.isActive);
  const tree = [`M${TRUNK} 0 V${rowMiddle(items.length - 1) - BEND}`, ...items.map((_, i) => branch(rowMiddle(i)))].join(" ");
  const y = useMotionValue(rowMiddle(Math.max(0, active)));
  const lit = useTransform(y, (v) => `M${TRUNK} 0 V${v - BEND} Q${TRUNK} ${v} ${TRUNK + BEND} ${v} H${REACH}`);
  useEffect(() => {
    if (active < 0) return;
    if (reduce) y.jump(rowMiddle(active));
    else animate(y, rowMiddle(active), SLIDE);
  }, [active, reduce, y]);
  return (
    <motion.div
      animate={{ height: "auto", opacity: 1, transition: { duration: 0.32, ease: EASE_OUT } }}
      className="overflow-hidden"
      exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0, transition: { duration: 0.32, ease: EASE_OUT } }}
      initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
    >
      <SidebarMenuSub className="relative border-l-0 pl-4">
        <svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" fill="none" height={items.length * ROW} strokeLinecap="round" strokeWidth={1.25} width={REACH}>
          <path className="stroke-sidebar-border" d={tree} />
          {active >= 0 && (
            <motion.path
              animate={{ pathLength: 1 }}
              className="stroke-sidebar-primary"
              d={lit}
              initial={reduce ? false : { pathLength: 0 }}
              transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.08 }}
            />
          )}
        </svg>
        {items.map((c) => (
          <SidebarMenuSubItem key={c.name}>
            <SidebarMenuSubButton aria-current={c.isActive ? "page" : undefined} className="pe-8" isActive={c.isActive} onClick={c.onSelect} render={<button type="button" />}>
              <span>{c.name}</span>
            </SidebarMenuSubButton>
            <RowMenu className="top-0.5 opacity-0 group-hover/menu-sub-item:opacity-100" onDelete={c.onDelete} />
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    </motion.div>
  );
}

// A row's "More" menu, with Delete.
function RowMenu({ onDelete, className, showOnHover }: { onDelete: () => void; className?: string; showOnHover?: boolean }) {
  const { isMobile } = useSidebar();
  return (
    <Menu>
      <MenuTrigger
        render={
          // COSS's showOnHover keys off Radix's data-state; Base UI sets aria-expanded.
          <SidebarMenuAction className={cn("aria-expanded:bg-muted aria-expanded:opacity-100", className)} showOnHover={showOnHover} />
        }
      >
        <Ellipsis />
        <span className="sr-only">More</span>
      </MenuTrigger>
      <MenuPopup align={isMobile ? "end" : "start"} className="w-48" side={isMobile ? "bottom" : "right"}>
        <MenuItem onClick={onDelete}>
          <Trash className="text-muted-foreground" />
          <span>Delete</span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

export function NavProjects({
  projects,
  onCreate,
}: {
  projects: {
    name: string;
    icon: React.ReactNode;
    isActive: boolean;
    onSelect: () => void;
    onDelete: () => void;
    open: boolean;
    children: Child[];
  }[];
  onCreate: () => void;
}) {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Pages</SidebarGroupLabel>
      <SidebarGroupAction aria-label="New page" onClick={onCreate}>
        <Plus />
      </SidebarGroupAction>
      {projects.length === 0 && <p className="px-2 py-1.5 text-sm">No pages yet</p>}
      <SidebarMenu>
        {projects.map((item, i) => (
          <SidebarMenuItem key={i}>
            <SidebarMenuButton aria-current={item.isActive ? "page" : undefined} isActive={item.isActive} onClick={item.onSelect}>
              {item.icon}
              <span>{item.name}</span>
            </SidebarMenuButton>
            <RowMenu onDelete={item.onDelete} showOnHover />
            <AnimatePresence initial={false}>{item.open && item.children.length > 0 && <Children items={item.children} />}</AnimatePresence>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
