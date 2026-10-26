import type { Asset, AssetStore } from "@leadinglight/editor/assets";
import { isNative } from "./platform";

const ext = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".")) : "");

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
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(decodeURIComponent(new URL(asset.url).pathname));
  },
};

export const assets: AssetStore = {
  put: async (file) => ((await isNative) ? tauriAssets : browserAssets).put(file),
  open: (asset) => void isNative.then((native) => (native ? tauriAssets : browserAssets).open(asset)),
  async transcribe(asset, language) {
    if (!(await isNative)) throw new Error("Transcription requires the Mac app on macOS 26 or newer. Your audio is saved.");
    const { invoke } = await import("@tauri-apps/api/core");
    const filename = decodeURIComponent(new URL(asset.url).pathname).split("/").pop();
    return invoke<string>("voice_transcribe", { filename, language });
  },
};
