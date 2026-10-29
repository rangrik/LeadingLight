import type { Asset, AssetStore } from "@leadinglight/editor/assets";
import { toastManager } from "@leadinglight/ui/components/toast";
import { isDesktop, isNative, platformReady } from "./platform";

const ext = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".")) : "");

let iosAssetUrl: Promise<(src: string) => string> | undefined;

// iOS can move the data directory on update; resolve saved paths without rewriting notes.
export async function resolveAssetUrls<T>(value: T): Promise<T> {
  if (!(await isNative) || await platformReady !== "ios") return value;
  const resolve = await (iosAssetUrl ??= (async () => {
    const [{ appDataDir, join }, { convertFileSrc }] = await Promise.all([
      import("@tauri-apps/api/path"), import("@tauri-apps/api/core"),
    ]);
    const directory = await join(await appDataDir(), "assets");
    return (src: string) => {
      try {
        const url = new URL(src);
        if (url.protocol !== "asset:" || url.host !== "localhost" || url.username || url.password || url.search || url.hash) return src;
        const filename = decodeURIComponent(url.pathname).match(/\/assets\/([^/\\]+)$/)?.[1];
        if (!filename || filename.startsWith(".") || /[\u0000-\u001f]/.test(filename)) return src;
        return convertFileSrc(`${directory}/${filename}`);
      } catch { return src; }
    };
  })());
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [
      key, (key === "src" || key === "url") && typeof child === "string" ? resolve(child) : walk(child),
    ]));
  };
  return walk(value) as T;
}

// Browser: files live inside the document as data URLs. Fine for dev and QA.
const browserAssets: AssetStore = {
  put: (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ url: reader.result as string, name: file.name, size: file.size, mime: file.type });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }),
  // Browsers block opening data: URLs, so hand them a blob: URL of the same bytes.
  open: (asset) => {
    const [head, data] = asset.url.split(",");
    const bytes = Uint8Array.from(atob(data ?? ""), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: head.match(/data:([^;]+)/)?.[1] ?? asset.mime });
    window.open(URL.createObjectURL(blob), "_blank");
  },
};

// App: files are copied next to the database and served through the asset protocol.
const tauriAssets: AssetStore = {
  async put(file): Promise<Asset> {
    const [{ BaseDirectory, mkdir, writeFile }, { appDataDir, join }, { convertFileSrc }] = await Promise.all([
      import("@tauri-apps/plugin-fs"),
      import("@tauri-apps/api/path"),
      import("@tauri-apps/api/core"),
    ]);
    const rel = `assets/${crypto.randomUUID()}${ext(file.name)}`;
    await mkdir("assets", { baseDir: BaseDirectory.AppData, recursive: true });
    await writeFile(rel, new Uint8Array(await file.arrayBuffer()), { baseDir: BaseDirectory.AppData });
    const url = convertFileSrc(await join(await appDataDir(), rel));
    return { url, name: file.name, size: file.size, mime: file.type };
  },
  async open(asset) {
    const path = decodeURIComponent(new URL(asset.url).pathname);
    if (await platformReady === "ios") {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<void>("plugin:leadinglight-preview|asset_preview", { filename: path.split("/").pop() });
    }
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(path);
  },
};

export const assets: AssetStore = {
  put: async (file) => ((await isNative) ? tauriAssets : browserAssets).put(file),
  open: (asset) => void isNative.then((native) => (native ? tauriAssets : browserAssets).open(asset)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "The file is still saved. Please try again.";
    if ((error instanceof Error && error.name === "AbortError") || /\b(?:user cancel(?:led|ed)|cancel(?:led|ed) by (?:the )?user)\b/i.test(message)) return;
    toastManager.add({ type: "error", title: "Couldn't open the attachment", description: message });
  }),
  async transcribe(asset, language) {
    if (!(await isDesktop)) throw new Error("Transcription requires the Mac app on macOS 26 or newer. Your audio is saved.");
    const { invoke } = await import("@tauri-apps/api/core");
    const filename = decodeURIComponent(new URL(asset.url).pathname).split("/").pop();
    return invoke<string>("voice_transcribe", { filename, language });
  },
};
