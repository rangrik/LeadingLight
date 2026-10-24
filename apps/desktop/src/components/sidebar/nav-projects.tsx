// shadcn sidebar-08 (base-vega) nav-projects, on COSS primitives (DropdownMenu* is COSS Menu*).
// Changes: pages instead of projects, its label given (Pinned, Pages) with a New page action and
// empty text for Pages, rows select instead of linking; the row menu is Rename, Pin, Copy link and
// Delete (View/Share and the trailing "More" row dropped); rows can be dragged beside the open
// page; a page's Thoughts page and essay hang under it on a tree (see Children).
import { Ellipsis, Link, PencilLine, Pin, PinOff, Plus, Trash } from "lucide-react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@leadinglight/ui/lib/utils";
import { Input } from "@leadinglight/ui/components/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { Popover, PopoverPopup } from "@leadinglight/ui/components/popover";
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

// What a row's menu does; a child row (Thoughts, an essay) only copies its link and deletes.
type Actions = { onCopyLink: () => void; onDelete: () => void };
type Child = Actions & { name: string; isActive: boolean; onSelect: (e: React.MouseEvent) => void; onDrag: (e: React.PointerEvent<HTMLElement>) => void };
type Row = Child & {
  id: string;
  icon: React.ReactNode;
  title: string;
  onRename: (title: string) => void;
  pinned: boolean;
  onPin: () => void;
  open: boolean;
  children: Child[];
};

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
            <SidebarMenuSubButton
              aria-current={c.isActive ? "page" : undefined}
              className="pe-8"
              isActive={c.isActive}
              onClick={c.onSelect}
              onPointerDown={c.onDrag}
              render={<button type="button" />}
            >
              <span>{c.name}</span>
            </SidebarMenuSubButton>
            <RowMenu className="top-0.5 opacity-0 group-hover/menu-sub-item:opacity-100" item={c} />
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    </motion.div>
  );
}

// A row's "More" menu. Delete is last and red, a line apart from the rest.
function RowMenu({ item, onRename, className, showOnHover }: { item: Actions & Partial<Row>; onRename?: () => void; className?: string; showOnHover?: boolean }) {
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
        {onRename && (
          <MenuItem onClick={onRename}>
            <PencilLine />
            <span>Rename</span>
          </MenuItem>
        )}
        {item.onPin && (
          <MenuItem onClick={item.onPin}>
            {item.pinned ? <PinOff /> : <Pin />}
            <span>{item.pinned ? "Unpin" : "Pin"}</span>
          </MenuItem>
        )}
        <MenuItem onClick={item.onCopyLink}>
          <Link />
          <span>Copy link</span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={item.onDelete} variant="destructive">
          <Trash />
          <span>Delete</span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

// Rename opens a field under the row, as in Notion's sidebar: Enter or a click away keeps the new
// name, Escape drops it, and an empty name changes nothing.
function RenameField({ open, anchor, title, onDone }: { open: boolean; anchor: React.RefObject<HTMLElement | null>; title: string; onDone: (title?: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const done = (keep: boolean) => {
    const value = input.current?.value.trim();
    onDone(keep && value ? value : undefined);
  };
  return (
    <Popover onOpenChange={(next, { reason }) => !next && done(reason !== "escape-key")} open={open}>
      <PopoverPopup align="start" anchor={anchor} aria-label="Rename" className="w-64">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            done(true);
          }}
        >
          <Input aria-label="Page name" autoFocus defaultValue={title} onFocus={(e) => e.currentTarget.select()} placeholder="Untitled" ref={input} size="sm" />
        </form>
      </PopoverPopup>
    </Popover>
  );
}

function PageRow({ item }: { item: Row }) {
  // The field sits under the row itself, not under its open tree.
  const ref = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton ref={ref} aria-current={item.isActive ? "page" : undefined} isActive={item.isActive} onClick={item.onSelect} onPointerDown={item.onDrag}>
        {item.icon}
        <span>{item.name}</span>
      </SidebarMenuButton>
      <RowMenu item={item} onRename={() => setRenaming(true)} showOnHover />
      <RenameField
        anchor={ref}
        onDone={(title) => {
          setRenaming(false);
          if (title !== undefined && title !== item.title) item.onRename(title);
        }}
        open={renaming}
        title={item.title}
      />
      <AnimatePresence initial={false}>{item.open && item.children.length > 0 && <Children items={item.children} />}</AnimatePresence>
    </SidebarMenuItem>
  );
}

export function NavProjects({ label, projects, onCreate }: { label: string; projects: Row[]; onCreate?: () => void }) {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      {onCreate && (
        <SidebarGroupAction aria-label="New page" onClick={onCreate}>
          <Plus />
        </SidebarGroupAction>
      )}
      {onCreate && projects.length === 0 && <p className="px-2 py-1.5 text-sm">No pages yet</p>}
      <SidebarMenu>
        {projects.map((item) => (
          <PageRow item={item} key={item.id} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
