import { EmojiGrid } from "@leadinglight/editor/emoji";
import { Check, FileText, ImageUp } from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Input } from "@leadinglight/ui/components/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@leadinglight/ui/components/tabs";
import { cn } from "@leadinglight/ui/lib/utils";
import iconsUrl from "@iconify-json/lucide/icons.json?url";
import { assets } from "@/lib/assets";
import { type Color, COLORS, type PageIcon } from "@/lib/page-meta";

// Lucide's whole set as one file, fetched on first use: importing it would put every icon in
// the main bundle.
let icons: Record<string, string> | undefined;
let loading: Promise<void> | undefined;
const loadIcons = () =>
  (loading ??= fetch(iconsUrl)
    .then((r) => r.json() as Promise<{ icons: Record<string, { body: string }> }>)
    .then((set) => {
      icons = Object.fromEntries(Object.entries(set.icons).map(([name, icon]) => [name, icon.body]));
    }));

function useIcons() {
  const [, loaded] = useState(Boolean(icons));
  useEffect(() => {
    if (!icons) void loadIcons().then(() => loaded(true));
  }, []);
  return icons;
}

// The set's own trusted markup, drawn in the text colour.
function LucideIcon({ name, className }: { name: string; className?: string }) {
  const body = useIcons()?.[name] ?? "";
  return <svg aria-hidden className={cn("shrink-0", className)} dangerouslySetInnerHTML={{ __html: body }} viewBox="0 0 24 24" />;
}

// 16 px for rows and headers, 64 px above the title.
export function PageIconView({ icon, large }: { icon: PageIcon; large?: boolean }) {
  if (icon.kind === "emoji") {
    return (
      <span aria-hidden className={cn("flex shrink-0 items-center justify-center leading-none", large ? "size-16 text-[56px]" : "size-4 text-sm")}>
        {icon.emoji}
      </span>
    );
  }
  if (icon.kind === "image") {
    return <img alt="" className={cn("shrink-0 object-cover", large ? "size-16 rounded-lg" : "size-4 rounded-[3px]")} draggable={false} src={icon.url} />;
  }
  return <LucideIcon className={cn(COLORS[icon.color].text, large ? "size-16 [&_*]:stroke-[1.5]" : "size-4")} name={icon.name} />;
}

// In rows: the page's icon, or the page symbol when it has none.
export const RowIcon = ({ icon }: { icon?: PageIcon }) =>
  icon ? <PageIconView icon={icon} /> : <FileText className="size-4 shrink-0 text-muted-foreground" />;

const LAST_COLOR = "ll.iconColor";

export function IconPicker({ icon, onChange, children }: { icon?: PageIcon; onChange: (icon?: PageIcon) => void; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("emoji");
  const search = useRef<HTMLInputElement>(null);
  const pick = (next?: PageIcon) => {
    onChange(next);
    setOpen(false);
  };
  // Each opening starts on the tab the current icon came from.
  const toggle = (next: boolean) => {
    if (next) setTab(icon?.kind === "icon" ? "icons" : icon?.kind === "image" ? "upload" : "emoji");
    setOpen(next);
  };
  return (
    <Popover onOpenChange={toggle} open={open}>
      <PopoverTrigger render={children} />
      <PopoverPopup align="start" aria-label="Icon" className="w-80" initialFocus={search}>
        <Tabs onValueChange={setTab} value={tab}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTab value="emoji">Emoji</TabsTab>
              <TabsTab value="icons">Icons</TabsTab>
              <TabsTab value="upload">Upload</TabsTab>
            </TabsList>
            {icon && (
              <Button onClick={() => pick(undefined)} size="xs" variant="ghost">
                Remove
              </Button>
            )}
          </div>
          <TabsPanel className="h-66 flex-none" value="emoji">
            <EmojiGrid inputRef={search} onPick={(emoji) => pick({ kind: "emoji", emoji })} />
          </TabsPanel>
          <TabsPanel className="h-66 flex-none" value="icons">
            <IconGrid
              initial={icon?.kind === "icon" ? icon.color : ((localStorage.getItem(LAST_COLOR) as Color | null) ?? "gray")}
              onPick={(name, color) => {
                localStorage.setItem(LAST_COLOR, color);
                pick({ kind: "icon", name, color });
              }}
            />
          </TabsPanel>
          <TabsPanel className="h-66 flex-none" value="upload">
            <ImageDrop className="h-full" onImage={(url) => pick({ kind: "image", url })} />
          </TabsPanel>
        </Tabs>
      </PopoverPopup>
    </Popover>
  );
}

function IconGrid({ initial, onPick }: { initial: Color; onPick: (name: string, color: Color) => void }) {
  const [color, setColor] = useState<Color>(initial in COLORS ? initial : "gray");
  const [query, setQuery] = useState("");
  const all = useIcons();
  const q = query.trim().toLowerCase().replaceAll(" ", "-");
  const names = Object.keys(all ?? {}).filter((n) => n.includes(q));
  return (
    <>
      <div aria-label="Colour" className="mb-3 flex justify-between px-0.5" role="radiogroup">
        {(Object.keys(COLORS) as Color[]).map((c) => (
          <button
            aria-checked={c === color}
            aria-label={COLORS[c].name}
            className={cn("flex size-6 items-center justify-center rounded-full text-white", COLORS[c].dot)}
            key={c}
            onClick={() => setColor(c)}
            role="radio"
            type="button"
          >
            {c === color && <Check className="size-3.5" strokeWidth={3} />}
          </button>
        ))}
      </div>
      <Input aria-label="Search icons" onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Search icons" size="sm" type="search" value={query} />
      <div className="-mx-1 mt-2 grid h-47 grid-cols-8 content-start overflow-y-auto">
        {names.map((name) => (
          <button aria-label={name} className="flex h-8 items-center justify-center rounded-md hover:bg-accent" key={name} onClick={() => onPick(name, color)} type="button">
            <svg aria-hidden className={cn("size-5", COLORS[color].text)} dangerouslySetInnerHTML={{ __html: all?.[name] ?? "" }} viewBox="0 0 24 24" />
          </button>
        ))}
        {all && names.length === 0 && <p className="col-span-8 px-1 py-2 text-muted-foreground text-sm">No results</p>}
      </div>
    </>
  );
}

// Choose, drop or paste an image. Stored like any media file in the page.
export function ImageDrop({ onImage, className }: { onImage: (url: string) => void; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const take = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose an image file");
    setError("");
    onImage((await assets.put(file)).url);
  };
  // Pasting anywhere while this is open: focus is usually on the tab, not here.
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files[0];
      if (!file) return;
      e.preventDefault();
      void take(file);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });
  return (
    <div
      className={cn("flex flex-col", className)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void take(e.dataTransfer.files[0]);
      }}
    >
      <button
        className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-muted-foreground/32 border-dashed text-muted-foreground text-sm transition-colors duration-150 hover:bg-accent/50"
        onClick={() => input.current?.click()}
        type="button"
      >
        <ImageUp className="size-4" />
        <span className="text-foreground">Choose an image</span>
        <span className="text-xs">or drop or paste one here</span>
      </button>
      <input accept="image/*" className="hidden" onChange={(e) => void take(e.currentTarget.files?.[0])} ref={input} type="file" />
      {error && (
        <p className="mt-2 text-destructive-foreground text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
