import { Check } from "lucide-react";
import { type ReactElement, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Input } from "@leadinglight/ui/components/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@leadinglight/ui/components/tabs";
import { Toolbar, ToolbarButton } from "@leadinglight/ui/components/toolbar";
import { cn } from "@leadinglight/ui/lib/utils";
import { ImageDrop } from "@/components/page-icon";
import { type Color, COLORS, type PageCover } from "@/lib/page-meta";

// object-cover scales the image to fill the band; only the height beyond the band can move.
const spareOf = (el: HTMLImageElement | null) => {
  if (!el?.naturalWidth) return 0;
  const band = el.getBoundingClientRect();
  return el.naturalHeight * Math.max(band.width / el.naturalWidth, band.height / el.naturalHeight) - band.height;
};

// The band across the top of a pane. An image can be dragged up or down to choose what shows.
export function CoverBand({ cover, onChange }: { cover: PageCover; onChange: (cover?: PageCover) => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [movable, setMovable] = useState(false);
  const y = moving ?? (cover.kind === "image" ? cover.y : 50);
  const measure = () => setMovable(spareOf(img.current) > 1);

  const drag = (e: React.PointerEvent<HTMLElement>) => {
    const spare = spareOf(img.current);
    if (spare <= 0) return;
    const start = e.clientY;
    const from = y;
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (the pointer is gone); moves over the band still work.
    }
    const move = (ev: PointerEvent) => setMoving(Math.min(100, Math.max(0, from - ((ev.clientY - start) / spare) * 100)));
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  return (
    <div aria-label="Cover" className="group/cover relative h-50 w-full shrink-0 overflow-hidden" onPointerEnter={measure} role="group">
      {cover.kind === "image" ? (
        <img
          alt=""
          className="size-full object-cover"
          draggable={false}
          onLoad={measure}
          ref={img}
          src={cover.url}
          style={{ objectPosition: `50% ${y}%` }}
        />
      ) : (
        <div className={cn("size-full", COLORS[cover.color].band)} />
      )}
      {moving !== null && (
        <div className="absolute inset-0 flex cursor-move items-center justify-center" onPointerDown={drag}>
          <span className="pointer-events-none rounded-md bg-black/50 px-2.5 py-1 text-white text-xs">Drag to reposition</span>
        </div>
      )}
      {/* A solid toolbar, so the buttons read over any image, light or dark. */}
      <Toolbar
        className={cn(
          "absolute end-3 bottom-3 gap-0.5 transition-opacity duration-150",
          moving === null && "opacity-0 focus-within:opacity-100 group-hover/cover:opacity-100 has-data-popup-open:opacity-100",
        )}
      >
        {moving === null ? (
          <>
            <CoverPicker cover={cover} onChange={onChange}>
              <ToolbarButton render={<Button size="xs" variant="ghost" />}>Change cover</ToolbarButton>
            </CoverPicker>
            {cover.kind === "image" && movable && (
              <ToolbarButton onClick={() => setMoving(cover.y)} render={<Button size="xs" variant="ghost" />}>
                Reposition
              </ToolbarButton>
            )}
          </>
        ) : (
          <>
            <ToolbarButton
              onClick={() => {
                if (cover.kind === "image") onChange({ ...cover, y: Math.round(y) });
                setMoving(null);
              }}
              render={<Button size="xs" variant="ghost" />}
            >
              Save position
            </ToolbarButton>
            <ToolbarButton onClick={() => setMoving(null)} render={<Button size="xs" variant="ghost" />}>
              Cancel
            </ToolbarButton>
          </>
        )}
      </Toolbar>
    </div>
  );
}

export function CoverPicker({ cover, onChange, children }: { cover?: PageCover; onChange: (cover?: PageCover) => void; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("colour");
  const pick = (next?: PageCover) => {
    onChange(next);
    setOpen(false);
  };
  const toggle = (next: boolean) => {
    if (next) setTab(cover?.kind === "image" ? "upload" : "colour");
    setOpen(next);
  };
  return (
    <Popover onOpenChange={toggle} open={open}>
      <PopoverTrigger render={children} />
      <PopoverPopup align="start" aria-label="Cover" className="w-80">
        <Tabs onValueChange={setTab} value={tab}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTab value="colour">Colour</TabsTab>
              <TabsTab value="upload">Upload</TabsTab>
              <TabsTab value="link">Link</TabsTab>
            </TabsList>
            {cover && (
              <Button onClick={() => pick(undefined)} size="xs" variant="ghost">
                Remove
              </Button>
            )}
          </div>
          <TabsPanel className="grid h-52 flex-none grid-cols-3 gap-2" value="colour">
            {(Object.keys(COLORS) as Color[]).map((c) => (
              <button
                aria-label={COLORS[c].name}
                aria-pressed={cover?.kind === "color" && cover.color === c}
                className={cn("flex items-center justify-center rounded-md text-foreground/70", COLORS[c].band)}
                key={c}
                onClick={() => pick({ kind: "color", color: c })}
                type="button"
              >
                {cover?.kind === "color" && cover.color === c && <Check className="size-4" />}
              </button>
            ))}
          </TabsPanel>
          <TabsPanel className="h-52 flex-none" value="upload">
            <ImageDrop className="h-full" onImage={(url) => pick({ kind: "image", url, y: 50 })} />
          </TabsPanel>
          <TabsPanel className="h-52 flex-none" value="link">
            <LinkField onImage={(url) => pick({ kind: "image", url, y: 50 })} />
          </TabsPanel>
        </Tabs>
      </PopoverPopup>
    </Popover>
  );
}

// Only a link that loads as an image is taken, so a typo never leaves a blank cover.
function LinkField({ onImage }: { onImage: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    const probe = new Image();
    probe.onload = () => onImage(url.trim());
    probe.onerror = () => setError("That link didn't load as an image");
    probe.src = url.trim();
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input
        aria-label="Image link"
        onChange={(e) => {
          setUrl(e.currentTarget.value);
          setError("");
        }}
        placeholder="Paste an image link"
        size="sm"
        value={url}
      />
      <Button disabled={!url.trim()} size="sm" type="submit">
        Use link
      </Button>
      {error && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
