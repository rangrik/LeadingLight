import type { EditorDoc } from "@leadinglight/editor/editor";
import { assets } from "~/lib/assets";
import { ask } from "~/lib/project-runtime/transport";

// Evidence in a report (features/evidence.feature): each file the agent named, copied by the runtime
// when it published and now into LeadingLight's own storage. Its content's hash names the version
// reviewed, so changing or cleaning up the folder later leaves it as it was.

export type KeptFile = { ref: string; name?: string; size?: number; sha?: string; mime?: string; error?: string };
// url is left out of what a page's properties keep when it is the file itself (a browser's data URL).
export type Evidence = { name: string; ref: string; sha: string; mime: string; size: number; url?: string; block: number; caption?: string; at?: number };

const kindOf = (mime: string) => (mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file");

// An image, video or audio plays where it is; anything else is a file card that opens it.
export const evidenceBlock = (e: Evidence): EditorDoc => ({ type: kindOf(e.mime), attrs: { src: e.url, name: e.name, size: e.size, mime: e.mime } });

// Stores each kept file; block is where it will sit in the report (1 is the first block).
export async function keepEvidence(files: KeptFile[], given: unknown, first: number): Promise<Evidence[]> {
  const extra = (Array.isArray(given) ? given : []) as { caption?: unknown; at?: unknown }[];
  const out: Evidence[] = [];
  for (const [i, f] of files.entries()) {
    if (f.error || !f.sha) throw new Error(`Evidence ${i + 1} (${f.ref}) wasn't kept: ${f.error ?? "the runtime has no copy"}.`);
    const { data } = await ask<{ data: string }>("GET", `/v1/ll/files/${f.sha}`);
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const mime = (f.mime ?? "application/octet-stream").split(";")[0];
    const name = f.name || f.ref.split("/").at(-1) || "file";
    const asset = await assets.put(new File([bytes], name, { type: mime }));
    const caption = typeof extra[i]?.caption === "string" ? (extra[i].caption as string).trim() : "";
    const at = typeof extra[i]?.at === "number" ? (extra[i].at as number) : undefined;
    // Each takes its block, and its caption the one after.
    const block = first + out.reduce((n, e) => n + (e.caption ? 2 : 1), 0);
    out.push({ name, ref: f.ref, sha: f.sha, mime, size: bytes.length, url: asset.url, block, ...(caption && { caption }), ...(at !== undefined && { at }) });
  }
  return out;
}

// The report's blocks for its evidence: each file, then its caption.
export const evidenceBlocks = (list: Evidence[]): EditorDoc[] =>
  list.flatMap((e) => [evidenceBlock(e), ...(e.caption ? [{ type: "paragraph", content: [{ type: "text", text: e.at === undefined ? e.caption : `${e.caption} (at ${Math.floor(e.at / 60)}:${String(Math.floor(e.at % 60)).padStart(2, "0")})` }] }] : [])]);
