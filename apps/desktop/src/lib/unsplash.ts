// Unsplash photos for covers. Each person brings their own free key; it stays on this device.
const KEY = "ll.unsplashKey";
const UTM = "utm_source=leadinglight&utm_medium=referral";

export const unsplashKey = {
  get: () => localStorage.getItem(KEY) ?? "",
  set: (key: string) => (key ? localStorage.setItem(KEY, key) : localStorage.removeItem(KEY)),
};

// Unsplash asks that links back to it carry the app's name.
export const tagged = (link: string) => `${link}${link.includes("?") ? "&" : "?"}${UTM}`;

export type Photo = { thumb: string; url: string; name: string; profile: string; used: string };
export type Failure = "key" | "limit" | "offline";

async function call(url: string) {
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${unsplashKey.get()}`, "Accept-Version": "v1" } }).catch(() => null);
  if (res?.ok) return res.json();
  throw (res?.status === 401 ? "key" : res?.status === 403 || res?.status === 429 ? "limit" : "offline") satisfies Failure;
}

type Raw = { urls: { raw: string; thumb: string }; user: { name: string; links: { html: string } }; links: { download_location: string } };

export async function searchPhotos(query: string): Promise<Photo[]> {
  const q = new URLSearchParams({ query, per_page: "24", orientation: "landscape" });
  const { results } = (await call(`https://api.unsplash.com/search/photos?${q}`)) as { results: Raw[] };
  return results.map((p) => {
    const url = new URL(p.urls.raw);
    url.searchParams.set("w", "2400");
    url.searchParams.set("q", "80");
    return { thumb: p.urls.thumb, url: url.href, name: p.user.name, profile: p.user.links.html, used: p.links.download_location };
  });
}

// Unsplash counts a photo as used only when its download link is called.
export const markUsed = (photo: Photo) => void call(photo.used).catch(() => {});
