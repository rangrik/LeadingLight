import { eInk } from "@/themes/builtin";
import type { Asset } from "@leadinglight/editor/assets";
import { isNative, platformReady } from "./platform";
import { nativeAssetFilename } from "./sync-assets";

export type PaperItem = { id: string; kind: "text" | "image" | "audio"; x: number; y: number; width: number; height: number; text?: string; asset?: Asset; fontSize?: number };
export type Paper = { version: 1; style?: "plain" | "ruled" | "dotted"; width: number; height: number; updatedAt: number; ink?: Asset; preview?: Asset; previewHeight?: number; inkBottom?: number; items: PaperItem[] };
export type PaperAction = "write" | "record" | "photo";
export const blankPaper = (): Paper => ({ version: 1, style: "ruled", width: 900, height: 1400, updatedAt: Date.now(), items: [] });
export const readPaper = (value: unknown): Paper | undefined => {
  const paper = value as Paper | undefined;
  return paper?.version === 1 && Array.isArray(paper.items) && paper.width === 900 && paper.height >= 1400 && paper.height <= 14000 ? { ...paper, previewHeight: paper.previewHeight ?? paper.height } : undefined;
};
const pages = new Map<string, (action: PaperAction) => void>();
export function registerPaper(id: string, open: (action: PaperAction) => void) {
  pages.set(id, open);
  return () => { if (pages.get(id) === open) pages.delete(id); };
}
export const openPaper = (id: string, action: PaperAction = "write") => pages.get(id)?.(action);

export async function editPaper(id: string, title: string, paper: Paper, action: PaperAction, changed: (paper: Paper) => Promise<void>): Promise<boolean> {
  if (!(await isNative) || await platformReady !== "ios") return false;
  const [{ invoke, Channel, convertFileSrc }, { appDataDir, join }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/path")]);
  const folder = await join(await appDataDir(), "assets");
  const local = (asset?: Asset) => asset && ({ ...asset, url: nativeAssetFilename(asset.url, folder, true) });
  const resolve = async (value: Paper): Promise<Paper> => {
    const asset = (a?: Asset) => a && ({ ...a, url: convertFileSrc(`${folder}/${a.url}`) });
    return { ...value, ink: asset(value.ink), preview: asset(value.preview), items: value.items.map((item) => ({ ...item, asset: asset(item.asset) })) };
  };
  let saving = Promise.resolve();
  const channel = new Channel<Paper>();
  channel.onmessage = (value) => { saving = saving.catch(() => {}).then(async () => { await changed(await resolve(value)); }); saving.catch(() => {}); };
  const result = await invoke<Paper>("plugin:leadinglight-preview|paper_edit", {
    id, title, action, onChange: channel,
    appearance: { paper: eInk.colors.background, ink: eInk.colors.foreground },
    paper: { ...paper, ink: local(paper.ink), preview: local(paper.preview), items: paper.items.map((item) => ({ ...item, asset: local(item.asset) })) },
  });
  await saving.catch(() => {});
  await changed(await resolve(result));
  // Only a confirmed database save retires the native recovery draft.
  const { remove, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  await remove(`paper-drafts/${id}.json`, { baseDir: BaseDirectory.AppData }).catch(() => {});
  return true;
}
