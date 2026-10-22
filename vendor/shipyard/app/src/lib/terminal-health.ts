import { toastManager } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { useStore } from "@/lib/store";
import { onRendererOutcome, type RendererOutcome } from "@/lib/terminal";

// Terminals draw with ghostty-web and fall back to xterm.js when it cannot
// start. That fallback used to go only to the console, so a release build
// where ghostty-web failed looked fine and nobody knew why. Now the first
// fallback of a run says so once, with the reason and a Copy details button,
// and every run records which renderer it got in ~/.berth/app/
// terminal-renderer.json, which `berth doctor` reads.

export const RENDERER_DOC = "/v1/app/terminal-renderer";

export interface RendererRecord extends RendererOutcome {
  at: string;
  user_agent: string;
}

let warned = false;

export function noticeFor(o: RendererOutcome): { title: string; description: string } | undefined {
  if (o.renderer !== "xterm" || o.chosen !== "ghostty") return undefined;
  return {
    title: "Terminals are using xterm.js",
    description: `ghostty-web couldn't start here${o.reason ? `: ${o.reason}` : ""}. Terminals work, drawn by the fallback; Settings → Terminal keeps the details.`,
  };
}

function handle(o: RendererOutcome) {
  const notice = noticeFor(o);
  if (notice && !warned) {
    warned = true;
    toastManager.add({
      type: "info",
      title: notice.title,
      description: notice.description,
      // Long enough to read, not forever: an open toast hides browser panes
      // (native views would cover it).
      timeout: 20_000,
      actionProps: { children: "Copy details", onClick: () => void copyText(o.details ?? o.reason ?? "", "Details copied") },
    });
  }
  void saveRecord({ ...o, at: new Date().toISOString(), user_agent: navigator.userAgent });
}

// saveRecord keeps trying for a minute: the first terminal can come before
// the agent answers (it is starting, or restarting after an update), and a
// record lost then left berth doctor without its "app terminal" line.
async function saveRecord(record: RendererRecord, tries = 0) {
  try {
    const client = useStore.getState().client;
    if (!client) throw new Error("the agent isn't connected yet");
    await client.laptop("PUT", RENDERER_DOC, record);
  } catch {
    if (tries < 20) window.setTimeout(() => void saveRecord(record, tries + 1), 3000);
  }
}

onRendererOutcome(handle);
