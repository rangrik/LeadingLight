// What the capture box holds (features/quick-capture.feature): a lone web address is a webpage;
// words, with an address among them or not, are an idea. "maybe" is an address still being typed.
export type CaptureText = { kind: "words" | "address" | "maybe"; url: string | null; words: string };

const safe = (token: string) => {
  try {
    const url = new URL(token);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};

export function readText(text: string): CaptureText {
  const t = text.trim();
  // A lone unsafe address is still an address, so saving it can say why it is refused; kept, it
  // is its words, never a link.
  if (/^(https?:\/\/|javascript:|data:|file:)\S+$/i.test(t)) {
    const url = safe(t);
    return { kind: "address", url, words: url ? "" : t };
  }
  const token = t.match(/https?:\/\/\S+/i)?.[0];
  const url = token ? safe(token) : null;
  const words = url && token ? t.replace(token, " ").replace(/\s+/g, " ").trim() : t;
  const typing = t && !/\s/.test(t) && ["https://", "http://"].some((p) => p.startsWith(t.slice(0, p.length).toLowerCase()));
  return { kind: typing ? "maybe" : "words", url, words };
}
