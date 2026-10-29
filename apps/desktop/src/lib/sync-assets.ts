export const MAX_ASSET_BYTES = 32 * 1024 * 1024;
export const MAX_ASSETS_BYTES = 64 * 1024 * 1024;
export const MAX_ASSETS = 256;
const PREFIX = "ll-asset:sha256:";
const HASH = /^[a-f0-9]{64}$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

export type AssetBytes = { bytes: Uint8Array; mime: string };
export type PortableAsset = { id: string; mime: string; size: number; data: string };
export type AssetBundle = { v: 1; items: PortableAsset[] };
export type AssetReader = (url: string, mime?: string) => Promise<AssetBytes>;
export type AssetWriter = (asset: PortableAsset, bytes: Uint8Array) => Promise<string>;

const extensions: Record<string, string> = {
  "application/pdf": "pdf", "application/json": "json", "application/zip": "zip",
  "application/octet-stream": "bin", "text/plain": "txt", "text/markdown": "md", "text/csv": "csv", "text/html": "html", "application/rtf": "rtf",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/svg+xml": "svg", "image/heic": "heic", "image/heif": "heif", "image/avif": "avif",
  "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg",
  "audio/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};
const aliases: Record<string, string> = { jpeg: "image/jpeg", markdown: "text/markdown", htm: "text/html" };
export const mimeFromName = (name: string) => aliases[name.toLowerCase().split(".").pop() ?? ""] ?? Object.entries(extensions).find(([, ext]) => name.toLowerCase().endsWith(`.${ext}`))?.[0];
export function assetMime(mime: string) {
  const value = mime.split(";", 1)[0].trim().toLowerCase();
  if (value.length > 127 || !MIME.test(value)) throw new Error("The attachment has an invalid MIME type.");
  return value;
}
export const assetFilename = (asset: Pick<PortableAsset, "id" | "mime">) => {
  if (!HASH.test(asset.id)) throw new Error("The attachment reference is invalid.");
  return `sha256-${asset.id}.${extensions[assetMime(asset.mime)] ?? "bin"}`;
};
export const toBase64 = (data: Uint8Array) => {
  let text = "";
  for (let i = 0; i < data.length; i += 32768) text += String.fromCharCode(...data.subarray(i, i + 32768));
  return btoa(text);
};
function fromBase64(data: string) {
  if (data.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error("The attachment has invalid or oversized base64 data.");
  }
  const decoded = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  if (decoded.length > MAX_ASSET_BYTES) throw new Error("An attachment exceeds the 32 MiB sync limit.");
  if (toBase64(decoded) !== data) throw new Error("The attachment has invalid base64 data.");
  return decoded;
}
export function dataAsset(url: string, hint?: string): AssetBytes {
  const split = url.indexOf(",");
  if (!url.startsWith("data:") || split < 0 || split > 256) throw new Error("The inline attachment is invalid.");
  const header = url.slice(5, split), value = url.slice(split + 1);
  const mime = assetMime(hint || header.split(";", 1)[0] || "text/plain");
  if (!header.endsWith(";base64")) {
    if (value.length > MAX_ASSET_BYTES * 3) throw new Error("An attachment exceeds the 32 MiB sync limit.");
    let decoded: Uint8Array;
    try { decoded = new TextEncoder().encode(decodeURIComponent(value)); }
    catch { throw new Error("The inline attachment is invalid."); }
    if (decoded.length > MAX_ASSET_BYTES) throw new Error("An attachment exceeds the 32 MiB sync limit.");
    return { bytes: decoded, mime };
  }
  return { bytes: fromBase64(value), mime };
}
export async function assetHash({ bytes, mime }: AssetBytes) {
  if (bytes.length > MAX_ASSET_BYTES) throw new Error("An attachment exceeds the 32 MiB sync limit.");
  const header = new TextEncoder().encode(`${assetMime(mime)}\0`);
  const input = new Uint8Array(header.length + bytes.length);
  input.set(header); input.set(bytes, header.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", input)), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function isDeviceAsset(src: string) {
  if (/^(asset:|file:|blob:)/i.test(src)) return true;
  try { return ["asset.localhost", "tauri.localhost"].includes(new URL(src).hostname); }
  catch { return false; }
}

// Read only the current app's assets; an old iOS sandbox UUID may change after an update.
export function nativeAssetFilename(src: string, directory: string, relocatedIos = false) {
  let url: URL, path: string;
  try {
    const decoded = decodeURIComponent(src);
    if (/[\\\u0000-\u001f]/.test(decoded) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded)) throw new Error();
    url = new URL(src);
    path = decodeURIComponent(url.pathname).replace(/^\/{2,}/, "/");
  } catch { throw new Error("The attachment path is invalid."); }
  if (!((url.protocol === "asset:" && url.host === "localhost") || (["http:", "https:"].includes(url.protocol) && url.host === "asset.localhost")) || url.username || url.password || url.search || url.hash) {
    throw new Error("Only files in this app's assets folder can sync.");
  }
  const root = directory.replace(/\/$/, "");
  const filename = path.slice(path.lastIndexOf("/") + 1), parent = path.slice(0, path.lastIndexOf("/"));
  const iosSuffix = (p: string) => p.match(/^\/(?:private\/)?var\/mobile\/Containers\/Data\/Application\/[^/]+(\/.*)$/)?.[1];
  if (parent !== root && !(relocatedIos && iosSuffix(root) && iosSuffix(parent) === iosSuffix(root))) {
    throw new Error("An attachment points outside this app's assets folder. Import it into the note before syncing.");
  }
  if (!filename || filename.length > 255 || filename.startsWith(".")) throw new Error("The attachment filename is invalid.");
  return filename;
}

async function walkMedia<T>(value: T, resolve: (src: string, mime?: string) => Promise<string>): Promise<T> {
  let nodes = 0;
  const walk = async (item: unknown, depth: number): Promise<unknown> => {
    if (++nodes > 500_000 || depth > 100) throw new Error("The sync event is too complex.");
    if (Array.isArray(item)) {
      const result = [];
      for (const child of item) result.push(await walk(child, depth + 1));
      return result;
    }
    if (!item || typeof item !== "object") return item;
    const record = item as Record<string, unknown>;
    const mime = typeof record.mime === "string" && record.mime ? record.mime : typeof record.name === "string" ? mimeFromName(record.name) : undefined;
    const entries: [string, unknown][] = [];
    for (const [key, child] of Object.entries(record)) entries.push([
      key, (key === "src" || key === "url") && typeof child === "string" ? await resolve(child, mime) : await walk(child, depth + 1),
    ]);
    return Object.fromEntries(entries);
  };
  return await walk(value, 0) as T;
}

export async function packAssets<T>(value: T, read: AssetReader): Promise<{ value: T; assets: AssetBundle }> {
  const items = new Map<string, PortableAsset>(), urls = new Map<string, string>();
  let total = 0;
  const packed = await walkMedia(value, async (src, hint) => {
    if (src.startsWith(PREFIX) || src.startsWith("ll-asset:")) throw new Error("An attachment has not been downloaded yet.");
    if (!src.startsWith("data:") && !isDeviceAsset(src)) return src;
    const cacheKey = `${hint ?? ""}\0${src}`;
    const cached = urls.get(cacheKey); if (cached) return cached;
    const file = src.startsWith("data:") ? dataAsset(src, hint) : await read(src, hint);
    const mime = assetMime(file.mime), id = await assetHash({ ...file, mime });
    if (!items.has(id)) {
      total += file.bytes.length;
      if (total > MAX_ASSETS_BYTES || items.size >= MAX_ASSETS) throw new Error("This sync event exceeds 64 MiB or 256 attachments. Split its attachments across pages.");
      items.set(id, { id, mime, size: file.bytes.length, data: toBase64(file.bytes) });
    }
    const ref = `${PREFIX}${id}`; urls.set(cacheKey, ref); return ref;
  });
  return { value: packed, assets: { v: 1, items: [...items.values()] } };
}

export async function unpackAssets<T>(value: T, bundle: unknown, write: AssetWriter): Promise<T> {
  const files = new Map<string, { asset: PortableAsset; bytes: Uint8Array }>();
  let total = 0;
  const add = async (asset: PortableAsset) => {
    if (!asset || typeof asset.id !== "string" || !HASH.test(asset.id) || typeof asset.data !== "string" || typeof asset.mime !== "string" || assetMime(asset.mime) !== asset.mime || !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > MAX_ASSET_BYTES) throw new Error("The synced attachment metadata is invalid.");
    if (files.has(asset.id)) throw new Error("The sync event contains duplicate attachment definitions.");
    const bytes = fromBase64(asset.data);
    if (bytes.length !== asset.size || await assetHash({ bytes, mime: asset.mime }) !== asset.id) throw new Error("The synced attachment size or hash does not match. Nothing from this event was applied.");
    total += bytes.length;
    if (total > MAX_ASSETS_BYTES || files.size >= MAX_ASSETS) throw new Error("The synced attachments exceed the 64 MiB or 256-file limit.");
    files.set(asset.id, { asset, bytes });
  };
  if (bundle !== undefined) {
    const b = bundle as AssetBundle;
    if (!b || b.v !== 1 || !Array.isArray(b.items) || b.items.length > MAX_ASSETS) throw new Error("This attachment format is invalid or needs a newer app.");
    for (const asset of b.items) await add(asset);
  }
  const used = new Set<string>();
  const refs = await walkMedia(value, async (src, hint) => {
    if (src.startsWith("data:")) {
      const file = dataAsset(src, hint), id = await assetHash(file);
      if (!files.has(id)) await add({ id, mime: file.mime, size: file.bytes.length, data: toBase64(file.bytes) });
      used.add(id); return `${PREFIX}${id}`;
    }
    if (isDeviceAsset(src)) throw new Error("The synced attachment still contains a device-only path.");
    if (!src.startsWith("ll-asset:")) return src;
    const id = src.slice(PREFIX.length);
    if (!src.startsWith(PREFIX) || !HASH.test(id) || !files.has(id)) throw new Error("A synced attachment is missing or its reference is invalid.");
    used.add(id); return src;
  });
  // Validate the whole event before creating files or replacing any document references.
  const urls = new Map<string, string>();
  for (const id of used) {
    const file = files.get(id)!;
    urls.set(`${PREFIX}${id}`, await write(file.asset, file.bytes));
  }
  return walkMedia(refs, async (src) => urls.get(src) ?? src);
}
