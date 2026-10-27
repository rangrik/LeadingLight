// Only the service URL is bundled; the Unsplash key stays on the server.
const SERVICE = `${(import.meta.env.VITE_IMAGE_SERVICE_URL || "https://leadinglight-images.vercel.app").replace(/\/$/, "")}/api/photos`;
// Discard keys from the old per-device setup.
localStorage.removeItem("ll.unsplashKey");
const UTM = "utm_source=leadinglight&utm_medium=referral";

export const tagged = (link: string) => `${link}${link.includes("?") ? "&" : "?"}${UTM}`;
export type Photo = { thumb: string; url: string; name: string; profile: string; used: string };
export type Failure = "unavailable" | "limit" | "offline";

export async function searchPhotos(query: string): Promise<Photo[]> {
  const res = await fetch(`${SERVICE}?${new URLSearchParams({ query })}`).catch(() => null);
  if (res?.ok) {
    const photos: unknown = await res.json().catch(() => null);
    if (Array.isArray(photos) && photos.every((p) => p && ["thumb", "url", "name", "profile", "used"].every((k) => typeof p[k] === "string"))) return photos;
    throw "unavailable" satisfies Failure;
  }
  throw (res?.status === 429 ? "limit" : res ? "unavailable" : "offline") satisfies Failure;
}

// Each selection is reported, even when its search results came from the cache.
export const markUsed = (photo: Photo) => void fetch(SERVICE, { method: "POST", body: photo.used, keepalive: true }).catch(() => {});
