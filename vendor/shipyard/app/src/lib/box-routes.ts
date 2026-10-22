import type { BoxRoute, BoxStatus } from "@berth/plugin";

// How the laptop reaches a box, in words (Settings › Boxes, the status bar):
// "via SSH, 24 ms · Tailscale, 140 ms". The route in use comes first.

// routeWords is how one route is doing: its latency when it works.
export function routeWords(r: BoxRoute): string {
  switch (r.state) {
    case "up":
      return r.latency_ms ? `${r.latency_ms} ms` : "works";
    case "stalled":
      return "not answering";
    case "down":
      return "down";
    case "off":
      return "off";
    default:
      return "not tried yet";
  }
}

// activeRoute is the route new requests take, if the box has routes.
export function activeRoute(box: Pick<BoxStatus, "routes">): BoxRoute | undefined {
  return box.routes?.find((r) => r.active);
}

// routeSummary names every route that is on, the one in use first.
export function routeSummary(box: Pick<BoxStatus, "routes">): string {
  const on = (box.routes ?? []).filter((r) => r.state !== "off");
  const sorted = [...on.filter((r) => r.active), ...on.filter((r) => !r.active)];
  return sorted.map((r) => `${r.active ? "via " : ""}${r.label}, ${routeWords(r)}`).join(" · ");
}

// viaRoute is the short form for a tooltip: "via SSH".
export function viaRoute(box: Pick<BoxStatus, "routes">): string | undefined {
  const r = activeRoute(box);
  return r ? `via ${r.label}` : undefined;
}

// canTurnOff says whether a route may be turned off: a box keeps one on.
export function canTurnOff(box: Pick<BoxStatus, "routes">, id: string): boolean {
  return (box.routes ?? []).some((r) => r.id !== id && r.state !== "off");
}
