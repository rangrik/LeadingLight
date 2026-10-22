import { isMock } from "@/hooks/use-berth-connection";
import { hostSuffix } from "@/lib/browser-url";
import { useStore } from "@/lib/store";

// An HTML artifact's own origin, served by the laptop proxy
// (internal/proxy/artifact.go): http://art-<id>.<box>.localhost:1377. Mock
// mode has no proxy: pages run in a srcdoc frame under the same policy,
// unless ?artport= names a server standing in for the proxy (the e2e
// suite's, which serves the proxy's exact headers from origin.gen.json).
export function artOrigin(box: string, id: string): string | undefined {
  if (isMock()) {
    const port = new URLSearchParams(location.search).get("artport");
    return port && /^\d{2,5}$/.test(port) ? `http://art-${id}.${box.toLowerCase()}.localhost:${port}` : undefined;
  }
  return `http://art-${id}.${box.toLowerCase()}.localhost${hostSuffix(useStore.getState().status?.proxy.url_port)}`;
}
