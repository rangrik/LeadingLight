import type { RGB } from "@/lib/chat-background-render";

// The chat backgrounds drawn in code. Each is a field: for every cell of
// the canvas, how much ink it takes (0 to 1) and, for gradients, its hue.
// render() moves the ink into the theme's colours and dithers it. Sizes are
// in design px (CSS px at full scale); s is design px per cell, and lines
// are at least a cell wide so they never vanish between dots.

export interface Field {
  v: Float32Array;
  // A hue per cell (r, g, b), for the colour tone.
  hue?: Uint8ClampedArray;
}

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};
// line is the ink of a line of half width hw at distance d.
const line = (d: number, hw: number, s: number) => clamp(1 - Math.max(0, d - hw) / Math.max(s * 0.6, 0.6));

// The sea's blue, the patterns' hue in the colour tone.
export const SEA: RGB = [72, 128, 176];

export function patternField(id: string, w: number, h: number, s: number): Field {
  const v = new Float32Array(w * h);
  const at = (fn: (x: number, y: number) => number) => {
    for (let j = 0, p = 0; j < h; j++) for (let i = 0; i < w; i++, p++) v[p] = fn((i + 0.5) * s, (j + 0.5) * s);
  };
  switch (id) {
    case "dots": {
      // A dot every 20 px.
      const g = 20;
      at((x, y) => line(Math.hypot((x % g) - g / 2, (y % g) - g / 2), 1.1, s));
      break;
    }
    case "grid": {
      // A chart's graticule: fine lines every 160 px, with a short tick
      // across them every 32 px.
      const G = 160;
      const T = 32;
      const dist = (a: number, g: number) => {
        const m = ((a % g) + g) % g;
        return Math.min(m, g - m);
      };
      // Offset so a line crosses even a small tile.
      at((x0, y0) => {
        const x = x0 + 40;
        const y = y0 + 40;
        const lx = dist(x, G);
        const ly = dist(y, G);
        let ink = Math.max(line(lx, 0.55, s), line(ly, 0.55, s)) * 0.9;
        if (ly < 4) ink = Math.max(ink, line(dist(x, T), 0.55, s) * 0.9);
        if (lx < 4) ink = Math.max(ink, line(dist(y, T), 0.55, s) * 0.9);
        return ink;
      });
      break;
    }
    case "waves": {
      // Rows of long, low swells, every other one fainter.
      const R = 34;
      at((x, y) => {
        const row = Math.round(y / R);
        let best = 0;
        for (let r = row - 1; r <= row + 1; r++) {
          const k = (2 * Math.PI) / 110;
          const ph = r * 1.7;
          const yc = r * R + 4 * Math.sin(x * k + ph) + 1.5 * Math.sin(x * k * 2.3 + r);
          const slope = 4 * k * Math.cos(x * k + ph) + 1.5 * k * 2.3 * Math.cos(x * k * 2.3 + r);
          const d = Math.abs(y - yc) / Math.sqrt(1 + slope * slope);
          best = Math.max(best, line(d, 0.45, s) * (r % 2 ? 0.5 : 0.9));
        }
        return best;
      });
      break;
    }
    default: {
      // Chart contours: the isolines of a smooth, made-up seabed, every
      // fifth one heavier, as on a chart.
      const N = (x: number, y: number) =>
        Math.sin(x * 0.0061 + Math.sin(y * 0.0043) * 1.6) + Math.sin(y * 0.0057 + Math.sin(x * 0.0037) * 1.9) * 0.9 + Math.sin((x + y) * 0.0021 + 1.3) * 0.7 + Math.sin((x - y) * 0.0089) * 0.25;
      const K = 4.5;
      const e = 1;
      at((x, y) => {
        const f = N(x, y) * K;
        const gx = (N(x + e, y) - N(x - e, y)) * K * 0.5;
        const gy = (N(x, y + e) - N(x, y - e)) * K * 0.5;
        const grad = Math.max(Math.hypot(gx, gy), 1e-4);
        const near = Math.round(f);
        const d = Math.abs(f - near) / grad;
        const index = ((near % 5) + 5) % 5 === 0;
        return line(d, index ? 0.8 : 0.45, s) * (index ? 1 : 0.5);
      });
    }
  }
  return { v };
}

type Stop = [number, RGB];

function ramp(stops: Stop[], t: number): RGB {
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const k = (t - a) / Math.max(1e-6, b - a);
      return [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

const GRADIENTS: Record<string, { stops: Stop[]; ink(x: number, y: number, aspect: number): number }> = {
  // A glow rising from the horizon, low on the left.
  "g-dawn": {
    stops: [
      [0, [150, 140, 222]],
      [0.55, [232, 142, 172]],
      [1, [246, 190, 140]],
    ],
    ink: (x, y, a) => {
      const d = Math.hypot((x - 0.28) * a, y - 1.15) / 1.35;
      return smooth(1 - d) * 0.9 + y * 0.12;
    },
  },
  // The last light, low on the right, under a darkening sky.
  "g-dusk": {
    stops: [
      [0, [70, 78, 150]],
      [0.5, [160, 92, 150]],
      [1, [236, 132, 88]],
    ],
    ink: (x, y, a) => {
      const d = Math.hypot((x - 0.82) * a, y - 1.1) / 1.25;
      return smooth(1 - d) * 0.85 + (1 - y) * 0.18;
    },
  },
  // Deeper toward the foot, with the light's ripple through it.
  "g-deep": {
    stops: [
      [0, [96, 176, 190]],
      [1, [40, 70, 140]],
    ],
    ink: (x, y, a) => clamp(0.08 + Math.pow(y, 1.4) * 0.85 + 0.07 * Math.sin(x * a * 9 + Math.sin(y * 7) * 2.2) * (1 - y)),
  },
};

export function gradientField(id: string, w: number, h: number): Field {
  const g = GRADIENTS[id] ?? GRADIENTS["g-dawn"];
  const v = new Float32Array(w * h);
  const hue = new Uint8ClampedArray(w * h * 3);
  const a = w / h;
  for (let j = 0, p = 0; j < h; j++) {
    const y = (j + 0.5) / h;
    const c = ramp(g.stops, y);
    for (let i = 0; i < w; i++, p++) {
      v[p] = clamp(g.ink((i + 0.5) / w, y, a));
      hue[p * 3] = c[0];
      hue[p * 3 + 1] = c[1];
      hue[p * 3 + 2] = c[2];
    }
  }
  return { v, hue };
}
