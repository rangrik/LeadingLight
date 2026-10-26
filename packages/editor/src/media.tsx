import { type Editor, mergeAttributes, Node, nodePasteRule } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { AudioLines, File as FileIcon, Film, Image as ImageIcon, ImageOff, Link as LinkIcon, Trash, Upload, VideoOff, VolumeOff } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Input } from "@leadinglight/ui/components/input";
import { Toolbar, ToolbarPrimitive, ToolbarSeparator } from "@leadinglight/ui/components/toolbar";
import { TooltipProvider } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { type Asset, type AssetStore, formatSize, kindOf } from "./assets";
import { placeFor } from "./drop";
import { Player } from "./player";
import { VoiceRecording } from "./voice";
import { surface, ToolButton } from "./ui";

type MediaOptions = { assets: AssetStore };
type MediaKind = "image" | "video" | "audio" | "file";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    media: {
      insertMedia: (kind: MediaKind) => ReturnType;
      insertEmbed: () => ReturnType;
    };
  }
}

// --- Shared pieces -----------------------------------------------------------

// A hidden file input and a function that opens it.
function useFilePicker(accept: string, onFile: (file: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      accept={accept}
      className="hidden"
      onChange={(e) => {
        const file = e.currentTarget.files?.[0];
        if (file) onFile(file);
        e.currentTarget.value = "";
      }}
      ref={ref}
      type="file"
    />
  );
  return { open: () => ref.current?.click(), input };
}

// An empty media block: what it is, and how to fill it.
function Placeholder({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div
      className="ll-row ll-media-empty flex items-center gap-3 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5 text-muted-foreground text-sm [&>svg]:size-4 [&>svg]:shrink-0"
      contentEditable={false}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {children}
    </div>
  );
}

function ChooseFile({ accept, onFile }: { accept: string; onFile: (file: File) => void }) {
  const picker = useFilePicker(accept, onFile);
  return (
    <>
      {picker.input}
      <Button onClick={picker.open} size="xs" variant="outline">
        Choose file
      </Button>
    </>
  );
}

// Floats over a picture's top-right corner. Toolbars stay inside their own block, so they never
// cover the title or a neighbour's controls.
function MediaToolbar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipProvider delay={500}>
      <Toolbar aria-label={label} className={cn(surface, "absolute top-2 right-2 z-10 items-center gap-0.5 p-1")} contentEditable={false}>
        {children}
      </Toolbar>
    </TooltipProvider>
  );
}

// Flat buttons at the end of a one-row card, where there is no picture to float over. Base UI's
// unstyled root, because COSS's Toolbar is a bordered pill.
function RowActions({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <TooltipProvider delay={500}>
      <ToolbarPrimitive.Root aria-label={label} className={cn("flex items-center gap-0.5", className)} contentEditable={false}>
        {children}
      </ToolbarPrimitive.Root>
    </TooltipProvider>
  );
}

// The src that failed to load, if it is the current one. A missing file (moved, deleted) shows
// as a row that says so and offers a new file, not as an empty box.
function useFailed(src: string | null) {
  const [failed, setFailed] = useState<string | null>(null);
  return { failed: src !== null && failed === src, onError: () => setFailed(src) };
}

// Media controls change the page, so a read-only page doesn't show them.
// Words that can't change (a report, an embed) only take notes: their media aren't edited.
const fixed = (editor: NodeViewProps["editor"]) => !editor.isEditable || !!editor.view.dom.closest("[data-annotate]");
const isSelected = ({ selected, editor }: NodeViewProps) => selected && !fixed(editor);

function ReplaceAndRemove({ accept, onFile, onRemove }: { accept: string; onFile: (f: File) => void; onRemove: () => void }) {
  const picker = useFilePicker(accept, onFile);
  return (
    <>
      {picker.input}
      <ToolButton label="Replace" onClick={picker.open}>
        <Upload />
      </ToolButton>
      <ToolButton label="Remove" onClick={onRemove}>
        <Trash />
      </ToolButton>
    </>
  );
}

function useAsset(props: NodeViewProps) {
  const assets = (props.extension.options as MediaOptions).assets;
  const put = async (file: File) => {
    const a = await assets.put(file);
    props.updateAttributes({ src: a.url, name: a.name, size: a.size, mime: a.mime });
  };
  return { assets, put };
}

const mediaAttrs = {
  src: { default: null },
  name: { default: null },
  size: { default: null },
  mime: { default: null },
};

const mediaNode = { group: "block", atom: true, draggable: true, selectable: true } as const;

// Events inside a player's controls belong to the controls, not to ProseMirror's node handling.
const stopEvent = ({ event }: { event: Event }) => (event.target as Element | null)?.closest?.("[data-controls]") != null;

// --- Image -------------------------------------------------------------------

const WIDTHS = [
  ["small", "Small"],
  ["medium", "Medium"],
  ["full", "Full width"],
] as const;

function ImageView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode } = props;
  const selected = isSelected(props);
  const { assets, put } = useAsset(props);
  const { failed, onError } = useFailed(node.attrs.src);
  // There, a click shows the image itself, larger, as a file opens.
  const view = fixed(props.editor) ? () => assets.open({ url: node.attrs.src, name: node.attrs.name, size: node.attrs.size, mime: node.attrs.mime }) : undefined;
  return (
    <NodeViewWrapper className="ll-media" data-media="image" data-width={node.attrs.width}>
      {failed ? (
        <Placeholder icon={<ImageOff />} label="This image can't be shown">
          <ChooseFile accept="image/*" onFile={put} />
        </Placeholder>
      ) : node.attrs.src ? (
        // The frame is the image's own size, so the toolbar and the outline sit on the image.
        <div className="ll-image-frame relative">
          <img alt={node.attrs.name ?? ""} className={view ? "ll-image cursor-zoom-in" : "ll-image"} draggable={false} onClick={view} onError={onError} src={node.attrs.src} />
          {selected && (
            <MediaToolbar label="Image">
              {WIDTHS.map(([value, label]) => (
                <ToolButton key={value} label={label} onClick={() => updateAttributes({ width: value })} pressed={node.attrs.width === value}>
                  {label === "Full width" ? "Full" : label}
                </ToolButton>
              ))}
              <ToolbarSeparator className="mx-0.5 h-4" orientation="vertical" />
              <ReplaceAndRemove accept="image/*" onFile={put} onRemove={deleteNode} />
            </MediaToolbar>
          )}
        </div>
      ) : (
        <Placeholder icon={<ImageIcon />} label="Add an image, or paste or drop one">
          <ChooseFile accept="image/*" onFile={put} />
        </Placeholder>
      )}
    </NodeViewWrapper>
  );
}

export const ImageBlock = Node.create<MediaOptions>({
  name: "image",
  ...mediaNode,
  addOptions: () => ({ assets: null as unknown as AssetStore }),
  addAttributes: () => ({ ...mediaAttrs, width: { default: "medium" } }),
  parseHTML: () => [{ tag: "img[src]" }],
  renderHTML: ({ HTMLAttributes, node }) => [
    "img",
    mergeAttributes(HTMLAttributes, { src: node.attrs.src, alt: node.attrs.name, "data-width": node.attrs.width }),
  ],
  addNodeView: () => ReactNodeViewRenderer(ImageView),
});

// --- Video, audio and file ----------------------------------------------------

function PlayerView({ kind, props }: { kind: "video" | "audio"; props: NodeViewProps }) {
  const { node, deleteNode } = props;
  const { put } = useAsset(props);
  const accept = `${kind}/*`;
  const actions = isSelected(props) && <ReplaceAndRemove accept={accept} onFile={put} onRemove={deleteNode} />;
  const { failed, onError } = useFailed(node.attrs.src);
  return (
    <NodeViewWrapper className="ll-media relative" data-media={kind}>
      {failed ? (
        <Placeholder icon={kind === "video" ? <VideoOff /> : <VolumeOff />} label={`This ${kind} can't be played`}>
          <ChooseFile accept={accept} onFile={put} />
        </Placeholder>
      ) : !node.attrs.src ? (
        <Placeholder icon={kind === "video" ? <Film /> : <AudioLines />} label={kind === "video" ? "Add a video" : "Add an audio file"}>
          <ChooseFile accept={accept} onFile={put} />
        </Placeholder>
      ) : kind === "video" ? (
        <Player
          kind={kind}
          onError={onError}
          overlay={actions && <MediaToolbar label="Video">{actions}</MediaToolbar>}
          src={node.attrs.src}
        />
      ) : (
        <Player
          actions={
            actions && (
              <RowActions label="Audio">
                <ToolbarSeparator className="mx-0.5 h-4" orientation="vertical" />
                {actions}
              </RowActions>
            )
          }
          kind={kind}
          onError={onError}
          src={node.attrs.src}
        />
      )}
    </NodeViewWrapper>
  );
}

export const Video = Node.create<MediaOptions>({
  name: "video",
  ...mediaNode,
  addOptions: () => ({ assets: null as unknown as AssetStore }),
  addAttributes: () => mediaAttrs,
  parseHTML: () => [{ tag: "video[src]" }],
  renderHTML: ({ HTMLAttributes, node }) => ["video", mergeAttributes(HTMLAttributes, { src: node.attrs.src, controls: "" })],
  addNodeView: () => ReactNodeViewRenderer((props: NodeViewProps) => <PlayerView kind="video" props={props} />, { stopEvent }),
});

export const Audio = Node.create<MediaOptions>({
  name: "audio",
  ...mediaNode,
  addOptions: () => ({ assets: null as unknown as AssetStore }),
  addAttributes: () => mediaAttrs,
  parseHTML: () => [{ tag: "audio[src]" }],
  renderHTML: ({ HTMLAttributes, node }) => ["audio", mergeAttributes(HTMLAttributes, { src: node.attrs.src, controls: "" })],
  addNodeView: () => ReactNodeViewRenderer((props: NodeViewProps) => <PlayerView kind="audio" props={props} />, { stopEvent }),
});

function FileView(props: NodeViewProps) {
  const { node, deleteNode } = props;
  const selected = isSelected(props);
  const { assets, put } = useAsset(props);
  const asset: Asset = { url: node.attrs.src, name: node.attrs.name, size: node.attrs.size, mime: node.attrs.mime };
  return (
    <NodeViewWrapper className="ll-media relative" data-media="file">
      {node.attrs.src ? (
        <>
          {/* The size follows the name; the card's end stays free for the actions, so a long
              name truncates the same whether or not they show. */}
          <Button
            className="ll-file ll-row h-auto w-full justify-start gap-3 px-3 py-2.5 pe-20 font-normal"
            contentEditable={false}
            onClick={() => assets.open(asset)}
            variant="outline"
          >
            <FileIcon className="text-muted-foreground" />
            <span className="min-w-0 truncate text-left">{asset.name}</span>
            <span className="shrink-0 text-muted-foreground text-xs">{formatSize(asset.size ?? 0)}</span>
          </Button>
          {selected && (
            <RowActions className="absolute top-1/2 right-2 -translate-y-1/2" label="File">
              <ReplaceAndRemove accept="*/*" onFile={put} onRemove={deleteNode} />
            </RowActions>
          )}
        </>
      ) : (
        <Placeholder icon={<FileIcon />} label="Attach a file">
          <ChooseFile accept="*/*" onFile={put} />
        </Placeholder>
      )}
    </NodeViewWrapper>
  );
}

export const FileBlock = Node.create<MediaOptions>({
  name: "file",
  ...mediaNode,
  addOptions: () => ({ assets: null as unknown as AssetStore }),
  addAttributes: () => mediaAttrs,
  parseHTML: () => [{ tag: "a[data-file]" }],
  renderHTML: ({ HTMLAttributes, node }) => [
    "a",
    mergeAttributes(HTMLAttributes, { href: node.attrs.src, "data-file": "", "data-name": node.attrs.name, "data-size": node.attrs.size }),
    node.attrs.name ?? "file",
  ],
  addNodeView: () => ReactNodeViewRenderer(FileView),
});

// --- Embed -------------------------------------------------------------------

const YOUTUBE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/;
const VIMEO = /vimeo\.com\/(\d+)/;

// The iframe URL for a pasted link; null when the link can't be embedded.
export function embedSrc(url: string): string | null {
  const yt = url.match(YOUTUBE);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(VIMEO);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return /^https:\/\//.test(url) ? url : null;
}

function EmbedView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode } = props;
  const selected = isSelected(props);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (embedSrc(value.trim())) updateAttributes({ src: value.trim() });
    else setInvalid(true);
  };
  return (
    <NodeViewWrapper className="ll-media relative" data-media="embed">
      {node.attrs.src ? (
        <div className="ll-embed">
          <iframe
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            loading="lazy"
            src={embedSrc(node.attrs.src) ?? undefined}
            title="Embedded content"
          />
        </div>
      ) : (
        <Placeholder icon={<LinkIcon />} label="Embed a link">
          <form className="flex items-center gap-2" onSubmit={submit}>
            <Input
              aria-invalid={invalid || undefined}
              aria-label="Embed URL"
              className="w-64"
              onChange={(e) => {
                setValue(e.currentTarget.value);
                setInvalid(false);
              }}
              placeholder="https://www.youtube.com/watch?v=…"
              size="sm"
              value={value}
            />
            <Button size="xs" type="submit" variant="outline">
              Embed
            </Button>
          </form>
        </Placeholder>
      )}
      {selected && node.attrs.src && (
        <MediaToolbar label="Embed">
          <ToolButton label="Remove" onClick={deleteNode}>
            <Trash />
          </ToolButton>
        </MediaToolbar>
      )}
    </NodeViewWrapper>
  );
}

export const Embed = Node.create({
  name: "embed",
  ...mediaNode,
  addAttributes: () => ({ src: { default: null } }),
  parseHTML: () => [{ tag: 'div[data-type="embed"]', getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute("data-src") }) }],
  renderHTML: ({ node }) => ["div", { "data-type": "embed", "data-src": node.attrs.src }],
  addNodeView: () => ReactNodeViewRenderer(EmbedView),
  // A pasted YouTube or Vimeo link becomes an embed.
  addPasteRules() {
    return [
      nodePasteRule({
        find: /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[\w-]{11}|youtu\.be\/[\w-]{11}|vimeo\.com\/\d+)\S*/g,
        type: this.type,
        getAttributes: (match) => ({ src: match[0] }),
      }),
    ];
  },
});

// --- Commands, paste and drop ------------------------------------------------

export const MediaCommands = Node.create<MediaOptions>({
  name: "mediaCommands",
  addOptions: () => ({ assets: null as unknown as AssetStore }),
  addCommands() {
    return {
      insertMedia:
        (kind) =>
        ({ chain }) =>
          chain().insertContent({ type: kind }).run(),
      insertEmbed:
        () =>
        ({ chain }) =>
          chain().insertContent({ type: "embed" }).run(),
    };
  },
  addProseMirrorPlugins() {
    const { assets } = this.options;
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("mediaFiles"),
        props: {
          handlePaste: (view, event) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            // Spreadsheets copy cells as HTML plus a picture of them; the cells are what's wanted.
            const html = event.clipboardData?.getData("text/html");
            const hasText = html && new DOMParser().parseFromString(html, "text/html").body.textContent?.trim();
            if (!files.length || hasText) return false;
            void insertFiles(editor, view, assets, files, view.state.selection.from);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (moved || !files.length) return false;
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
            void insertFiles(editor, view, assets, files, pos, event.clientY);
            return true;
          },
        },
      }),
    ];
  },
});

async function insertFiles(editor: Editor, view: EditorView, assets: AssetStore, files: File[], pos: number, clientY?: number) {
  let at = pos;
  let y = clientY;
  for (const file of files) {
    const a = await assets.put(file);
    const kind = kindOf(a.mime);
    const range = placeFor(view, at, editor.schema.nodes[kind], y);
    editor
      .chain()
      .insertContentAt(range, { type: kind, attrs: { src: a.url, name: a.name, size: a.size, mime: a.mime } })
      .run();
    // Later files follow the one just placed.
    at = editor.state.selection.to;
    y = undefined;
  }
}

export function createMedia(assets: AssetStore) {
  return [
    ImageBlock.configure({ assets }),
    Video.configure({ assets }),
    Audio.configure({ assets }),
    VoiceRecording.configure({ assets }),
    FileBlock.configure({ assets }),
    Embed,
    MediaCommands.configure({ assets }),
  ];
}
