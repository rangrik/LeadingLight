// Colour arithmetic for themes: contrast as WCAG measures it, mixing the
// way CSS color-mix() does in srgb, and distance in OKLab for telling two
// colours apart. Plain functions over "#rrggbb" (and "#rrggbbaa"), with no
// imports, so the contrast check (contrast.test.ts) runs them in node.

export type RGB = [number, number, number];

export function parse(hex: string): { rgb: RGB; alpha: number } {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full)) throw new Error(`not a hex colour: ${hex}`);
  const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
  return { rgb: [n(0), n(2), n(4)], alpha: full.length === 8 ? n(6) / 255 : 1 };
}

export function hex([r, g, b]: RGB): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// mix is color-mix(in srgb, a p, b): p of a, the rest b.
export function mix(a: string, b: string, p: number): string {
  const x = parse(a).rgb;
  const y = parse(b).rgb;
  return hex([0, 1, 2].map((i) => x[i] * p + y[i] * (1 - p)) as RGB);
}

// over lays a colour, with its own alpha or the one given, on an opaque one.
export function over(top: string, under: string, alpha?: number): string {
  const t = parse(top);
  return mix(hex(t.rgb), under, alpha ?? t.alpha);
}

function channel(v: number) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: string): number {
  const [r, g, b] = parse(c).rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// contrast is the WCAG 2 ratio, 1 to 21.
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function oklab(c: string): RGB {
  const [r, g, b] = parse(c).rgb.map(channel);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function unchannel(v: number) {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return s * 255;
}

function fromOklab([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

// oklch is a colour's lightness (0–1), chroma and hue (degrees).
export function oklch(c: string): RGB {
  const [L, a, b] = oklab(c);
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

// fromOklch is the sRGB colour nearest an OKLCH one: chroma comes down
// until it fits, so the hue and lightness hold.
export function fromOklch(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180;
  for (let c = C; ; c = Math.max(0, c - 0.002)) {
    const lin = fromOklab([L, c * Math.cos(h), c * Math.sin(h)]);
    if (c === 0 || lin.every((v) => v >= -0.0005 && v <= 1.0005)) return hex(lin.map((v) => unchannel(Math.min(1, Math.max(0, v)))) as RGB);
  }
}

// distance is how far apart two colours look, in OKLab: about 0.02 is a
// just-visible difference; 0.1 tells a dot of one from a dot of the other.
export function distance(a: string, b: string): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// readable is fg moved in lightness only, hue and chroma kept, until it is
// min:1 on bg: darker on a light background, lighter on a dark one. A
// colour that already reads is returned as it is.
export function readable(fg: string, bg: string, min = 4.5): string {
  const solid = over(fg, bg);
  if (contrast(solid, bg) >= min) return fg;
  const [L, C, H] = oklch(solid);
  const darker = contrast("#000000", bg) > contrast("#ffffff", bg);
  for (let step = 1; step <= 400; step++) {
    const l = darker ? L - step * 0.0025 : L + step * 0.0025;
    if (l < 0 || l > 1) break;
    const x = fromOklch(l, C, H);
    if (contrast(x, bg) >= min) return x;
  }
  return darker ? "#000000" : "#ffffff";
}
