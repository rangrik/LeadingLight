import { FileCodeIcon, FileIcon, FileImageIcon, FileJsonIcon, FileTextIcon, HashIcon, TriangleAlertIcon } from "lucide-react";

import { Tip } from "@/components/tip";
import { usePreferredEditor } from "@/lib/editors";
import { docKey, isDirty, useFiles } from "@/lib/files";
import { cn } from "@/lib/utils";

// The small pieces of the ⌘P picker and File tabs that load with the app:
// a file's icon, its tab's state, and names. The editor and the File tab
// itself are chunks of their own (file-pane.tsx, code-editor.tsx).

export const EDITOR_NAMES: Record<string, string> = { cursor: "Cursor", vscode: "VS Code", windsurf: "Windsurf", zed: "Zed" };
export const useEditorName = () => EDITOR_NAMES[usePreferredEditor() ?? "cursor"] ?? "your editor";
export const AGENT_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex" };
export const agentName = (a?: string) => (a ? (AGENT_NAMES[a] ?? a.charAt(0).toUpperCase() + a.slice(1)) : "The agent");

// FileGlyph is a file's icon in tabs, headers and the picker, by its kind.
export function FileGlyph({ path, className }: { path: string; className?: string }) {
  const cls = cn("size-3.5 shrink-0 text-muted-foreground", className);
  if (/\.(tsx?|jsx?|mjs|cjs|go|py|rs|rb|java|kt|swift|c|h|cpp|cs|php|sh|vue|svelte)$/i.test(path)) return <FileCodeIcon className={cls} />;
  if (/\.jsonc?$/i.test(path)) return <FileJsonIcon className={cls} />;
  if (/\.(md|mdx|txt|rst)$/i.test(path)) return <FileTextIcon className={cls} />;
  if (/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(path)) return <FileImageIcon className={cls} />;
  if (/\.(sql|ya?ml|toml|css|scss|env|ini|lock)$/i.test(path)) return <HashIcon className={cls} />;
  return <FileIcon className={cls} />;
}

// FileTabState is what a File tab says about its file in the strip: the
// agent wrote it under your unsaved edits, or you have unsaved edits.
export function FileTabState({ ws, path }: { ws: string; path: string }) {
  const state = useFiles((s) => {
    const d = s.docs[docKey(ws, path)];
    return !d ? undefined : d.conflict ? "conflict" : isDirty(d) ? "dirty" : undefined;
  });
  if (state === "conflict")
    return (
      <Tip label="Changed on the box under your unsaved edits" side="bottom">
        <TriangleAlertIcon aria-label="Changed under your edits" data-testid="file-tab-conflict" className="size-3 shrink-0 text-warning-foreground" />
      </Tip>
    );
  if (state === "dirty") return <span role="img" aria-label="Unsaved" data-testid="file-tab-dirty" className="size-1.5 shrink-0 rounded-full bg-foreground/60" />;
  return null;
}

