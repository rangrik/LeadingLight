import { Check } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Input } from "@leadinglight/ui/components/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@leadinglight/ui/components/tabs";
import { Toolbar, ToolbarButton, ToolbarLink } from "@leadinglight/ui/components/toolbar";
import { cn } from "@leadinglight/ui/lib/utils";
import { ImageDrop } from "~/components/page-icon";
import { openLink } from "~/lib/links";
import { type Color, COLORS, type PageCover } from "~/lib/page-meta";
import { type Failure, markUsed, type Photo, searchPhotos, tagged } from "~/lib/unsplash";

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
  const [failed, setFailed] = useState<string>();
  const y = moving ?? (cover.kind === "image" ? cover.y : 50);
  const measure = () => setMovable(spareOf(img.current) > 1);
  useEffect(() => {
    const retry = () => setFailed(undefined);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

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
      {cover.kind === "image" && failed !== cover.url ? (
        <img
          alt=""
          className="size-full object-cover"
          draggable={false}
          onError={() => setFailed(cover.url)}
          onLoad={measure}
          ref={img}
          src={cover.url}
          style={{ objectPosition: `50% ${y}%` }}
        />
      ) : (
        <div className={cn("size-full", COLORS[cover.kind === "color" ? cover.color : "gray"].band)} />
      )}
      {moving !== null && (
        <div className="absolute inset-0 flex cursor-move items-center justify-center" onPointerDown={drag}>
          <span className="pointer-events-none rounded-md bg-black/50 px-2.5 py-1 text-white text-xs">Drag to reposition</span>
        </div>
      )}
      {cover.kind === "image" && cover.unsplash && moving === null && (
        <Toolbar className="absolute end-3 top-3 max-w-[calc(100%-1.5rem)] opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/cover:opacity-100">
          {/* Sized like the xs buttons below, so both toolbars are the same height. */}
          <span className="flex min-w-0 gap-1 whitespace-nowrap px-[calc(--spacing(2)-1px)] text-muted-foreground text-sm leading-7 sm:text-xs sm:leading-6">
            <span className="@max-xs:hidden">Photo by</span>
            <Credit className="truncate" href={cover.unsplash.profile} title={cover.unsplash.name}>
              {cover.unsplash.name}
            </Credit>
            on
            <Credit href="https://unsplash.com/">Unsplash</Credit>
          </span>
        </Toolbar>
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
            <CoverPicker
              cover={cover}
              onChange={(next) => {
                setFailed(undefined);
                onChange(next);
              }}
            >
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
    if (next) setTab(cover?.kind === "image" ? (cover.unsplash ? "unsplash" : "upload") : "colour");
    setOpen(next);
  };
  return (
    <Popover onOpenChange={toggle} open={open}>
      <PopoverTrigger render={children} />
      <PopoverPopup align="start" aria-label="Cover" className="w-96">
        <Tabs onValueChange={setTab} value={tab}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTab value="colour">Colour</TabsTab>
              <TabsTab value="unsplash">Unsplash</TabsTab>
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
          <TabsPanel className="flex h-52 flex-none flex-col gap-2" value="unsplash">
            <UnsplashSearch
              onPhoto={(p) => {
                markUsed(p);
                pick({ kind: "image", url: p.url, y: 50, unsplash: { name: p.name, profile: p.profile } });
              }}
            />
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

const Credit = ({ href, className, title, children }: { href: string; className?: string; title?: string; children: ReactNode }) => (
  <ToolbarLink
    className={cn("text-foreground outline-none hover:underline", className)}
    title={title}
    href={tagged(href)}
    onClick={(e) => {
      e.preventDefault();
      openLink(e.currentTarget.href);
    }}
  >
    {children}
  </ToolbarLink>
);

const FAILURES: Record<Failure, string> = {
  unavailable: "Photo search is temporarily unavailable. Try again later.",
  limit: "Unsplash's hourly limit is used up. Try again later.",
  offline: "Couldn't reach Unsplash",
};

function UnsplashSearch({ onPhoto }: { onPhoto: (photo: Photo) => void }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Photo[] | Failure>();

  useEffect(() => {
    const q = query.trim();
    if (!q) return setFound(undefined);
    let live = true;
    // Waits for a pause in typing; a free key allows only 50 searches an hour.
    const wait = setTimeout(() => {
      searchPhotos(q).then(
        (photos) => live && setFound(photos),
        (e: unknown) => {
          if (!live) return;
          const why: Failure = e === "unavailable" || e === "limit" ? e : "offline";
          setFound(why);
        },
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(wait);
    };
  }, [query]);

  return (
    <>
      <Input aria-label="Search Unsplash" autoFocus onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Search Unsplash" size="sm" type="search" value={query} />
      {typeof found === "string" ? (
        <p className="text-destructive-foreground text-sm" role="alert">
          {FAILURES[found]}
        </p>
      ) : found?.length === 0 ? (
        <p className="text-muted-foreground text-sm">No photos found</p>
      ) : !found ? (
        <p className="mt-auto text-muted-foreground text-sm">Search for a photo to use as your cover.</p>
      ) : (
        <div className="grid min-h-0 grid-cols-3 gap-2 overflow-y-auto">
          {found?.map((p) => (
            <div className="min-w-0" key={p.url}>
              <Button aria-label={`Photo by ${p.name}`} className="h-auto w-full overflow-hidden p-0" onClick={() => onPhoto(p)} variant="ghost">
                <img alt="" className="aspect-3/2 w-full rounded-md object-cover" src={p.thumb} />
              </Button>
              <PhotoCredit href={p.profile}>{p.name}</PhotoCredit>
            </div>
          ))}
        </div>
      )}
      <PhotoCredit href="https://unsplash.com/">Photos from Unsplash</PhotoCredit>
    </>
  );
}

function PhotoCredit({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button className="h-auto min-w-0 max-w-full justify-start px-0 text-muted-foreground" render={<a href={tagged(href)} />} size="xs" variant="link" onClick={(e) => {
      e.preventDefault();
      openLink(tagged(href));
    }}>
      <span className="truncate">{children}</span>
    </Button>
  );
}
