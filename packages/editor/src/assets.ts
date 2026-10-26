// How the editor stores and opens files. The app supplies an implementation.
export type Asset = { url: string; name: string; size: number; mime: string };

export interface AssetStore {
  put(file: File): Promise<Asset>;
  open(asset: Asset): void;
  transcribe?(asset: Asset, language: string): Promise<string>;
}

export type MediaKind = "image" | "video" | "audio" | "file";

export function kindOf(mime: string): MediaKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
