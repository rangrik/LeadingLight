import { isNative } from "~/lib/platform";
import { ask } from "~/lib/project-runtime/transport";

export type BrowserFile = { name: string; mime: string; data: string };
const MAX_BYTES = 32 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const filename = (name: string) => (name.split(/[\\/]/).pop() ?? "").replace(/[\x00-\x1f\x7f]/g, "").replace(/^\.+$/, "") || "download";
const decode = (data: string) => Uint8Array.from(atob(data), (character) => character.charCodeAt(0));

export async function saveBrowserFile(file: BrowserFile): Promise<boolean> {
  if (file.data.length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error("Saving files over 32 MB is not supported yet.");
  const raw = atob(file.data);
  if (raw.length > MAX_BYTES) throw new Error("Saving files over 32 MB is not supported yet.");
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const name = filename(file.name);
  if (await isNative) {
    const [{ save }, { writeFile }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
    const path = await save({ title: "Save browser file", defaultPath: name });
    if (!path) return false;
    // The save dialog adds only the chosen file to Tauri's filesystem scope.
    await writeFile(path, bytes);
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime || "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

// Native downloads are written in bounded chunks, so large files never fill the app's memory.
export async function saveBrowserDownload(base: string, tab: string, id: string): Promise<boolean> {
  const route = `${base}/downloads/${encodeURIComponent(id)}/data?tab=${encodeURIComponent(tab)}`;
  if (!(await isNative)) return saveBrowserFile(await ask<BrowserFile>("GET", route));
  type Chunk = BrowserFile & { totalBytes: number; offset: number; done: boolean };
  const read = (offset: number) => ask<Chunk>("GET", `${route}&offset=${offset}&length=${CHUNK_BYTES}`);
  let chunk = await read(0);
  const total = chunk.totalBytes;
  const checkedBytes = (part: Chunk, offset: number) => {
    if (!Number.isSafeInteger(total) || total < 0 || offset > total || part.offset !== offset || part.totalBytes !== total || typeof part.data !== "string" || part.data.length > Math.ceil(CHUNK_BYTES / 3) * 4) throw new Error("The download changed while it was being saved.");
    const bytes = decode(part.data);
    if (bytes.length !== Math.min(CHUNK_BYTES, total - offset) || part.done !== (offset + bytes.length === total)) throw new Error("The download is incomplete.");
    return bytes;
  };
  let bytes = checkedBytes(chunk, 0);
  const [{ save }, { open }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
  const path = await save({ title: "Save download", defaultPath: filename(chunk.name) });
  if (!path) return false;
  const file = await open(path, { write: true, create: true, truncate: true });
  let offset = 0;
  try {
    for (;;) {
      let written = 0;
      while (written < bytes.length) {
        const count = await file.write(bytes.subarray(written));
        if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - written) throw new Error("The download could not be written.");
        written += count;
      }
      offset += bytes.length;
      if (chunk.done) {
        if (offset !== total) throw new Error("The download is incomplete.");
        return true;
      }
      chunk = await read(offset);
      bytes = checkedBytes(chunk, offset);
    }
  } finally { await file.close(); }
}
