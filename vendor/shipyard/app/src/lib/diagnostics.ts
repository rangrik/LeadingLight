import { ApiError, boxApi, type Check } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { type DiagApp, type Diagnostics, formatDiagnostics } from "@/lib/diagnostics-format";
import { errorMessage } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { recentEvents } from "@/lib/recent-events";
import { useStore } from "@/lib/store";
import { rendererOutcome } from "@/lib/terminal";
import { appVersion } from "@/views/settings/app-version";

// Copy diagnostics (Settings › About, and an error's Details): what this
// app, the laptop agent, `berth doctor`, the local box and each box say
// about themselves, and the last errors and toasts, as one short redacted
// text to paste into a chat (lib/diagnostics-format). Every part that
// can't be read says so on its line; nothing here throws.

// What GET /v1/doctor answers (internal/agent/doctor.go).
interface DoctorReport {
  version?: string;
  build?: string;
  os?: string;
  arch?: string;
  home?: string;
  checks?: Check[];
}

// What GET /v1/boxes/local answers (internal/agent/localbox.go).
interface LocalBoxStatus {
  supported?: boolean;
  installed?: boolean;
  running?: boolean;
  box?: string;
  name?: string;
}

// The app's own part, kept on the laptop so `berth doctor --report` has it.
export const APP_DIAGNOSTICS_DOC = "/v1/app/diagnostics";

const within = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(`${what} didn't answer within ${ms / 1000}s`)), ms))]);

// browserOS reads the system from the user agent, which a webview may
// freeze at an old version: said as such.
function browserOS(): string {
  const ua = navigator.userAgent;
  const mac = /Mac OS X (\d+[._]\d+(?:[._]\d+)?)/.exec(ua);
  if (mac) return `macOS ${mac[1].replaceAll("_", ".")} (from the browser)`;
  if (/Linux/.test(ua)) return "Linux (from the browser)";
  if (/Windows/.test(ua)) return "Windows (from the browser)";
  return "unknown (from the browser)";
}

export async function collectDiagnostics(): Promise<Diagnostics> {
  const st = useStore.getState();
  const client = st.client;
  const prefs = usePrefs.getState();
  const term = rendererOutcome();
  const { errors, toasts } = recentEvents();
  const version = await appVersion();
  const app: DiagApp = {
    version,
    build: __BERTH_COMMIT__ || undefined,
    renderer: term?.renderer,
    chosen: term?.chosen,
    renderer_reason: term?.reason,
    theme: st.themeId,
    labs: prefs.labs,
    zen: prefs.zen,
    agent_view: prefs.agentView,
    errors,
    toasts,
  };
  const d: Diagnostics = { generated: new Date().toISOString(), app, agent: {}, boxes: [] };

  if (!client) {
    d.agent = { state: st.connection.state === "connecting" ? "connecting" : "not answering", error: st.connection.error };
    d.doctor_error = "the agent isn't answering, so its checks can't run; try `berth doctor` in a terminal";
    app.os = browserOS();
    return d;
  }
  d.agent.state = "running";

  const [doctor, local] = await Promise.allSettled([within(client.laptop<DoctorReport>("GET", "/v1/doctor"), 20_000, "berth doctor"), within(client.laptop<LocalBoxStatus>("GET", "/v1/boxes/local"), 5_000, "the local box")]);
  if (doctor.status === "fulfilled") {
    const r = doctor.value;
    Object.assign(d.agent, { version: r.version, build: r.build });
    d.doctor = r.checks ?? [];
    d.home = r.home;
    app.os = r.os;
    app.arch = r.arch;
  } else {
    const err = doctor.reason;
    d.doctor_error = err instanceof ApiError && (err.status === 404 || err.status === 405) ? "this agent has no /v1/doctor (it is older); run berth doctor in a terminal" : `couldn't run: ${errorMessage(err)}`;
    app.os = browserOS();
  }

  const status = st.status?.boxes ?? [];
  // A box not opened yet hasn't said what it runs: ask it now.
  const infos = await Promise.all(
    status.map((b) => st.boxes[b.name]?.info ?? (b.state === "online" ? within(boxApi.info(client, b.name), 5_000, b.name).catch(() => undefined) : undefined)),
  );
  d.boxes = status.map((b, i) => {
    const info = infos[i];
    return { name: b.name, state: b.state, version: info?.version, build: info?.build, capabilities: info?.capabilities, error: b.error };
  });

  const ls = local.status === "fulfilled" ? local.value : undefined;
  const name = ls?.box ?? status.find((b) => b.local)?.name;
  if (name) {
    const b = status.find((x) => x.name === name);
    const box: NonNullable<Diagnostics["local_box"]> = { name, state: b?.state ?? (ls?.running ? "running, not connected" : "stopped"), version: st.boxes[name]?.info?.build };
    if (b?.state === "online") {
      try {
        box.checks = await within(client.box<Check[]>(name, "GET", "doctor"), 10_000, `${name}'s doctor`);
      } catch (err) {
        box.error = `doctor: ${errorMessage(err)}`;
      }
    }
    d.local_box = box;
  } else if (ls?.installed) {
    d.local_box = { name: ls.name ?? "this computer", state: ls.running ? "running, not paired" : "installed, stopped" };
  } else if (local.status === "rejected") {
    d.local_box = { name: "this computer", state: "unknown", error: errorMessage(local.reason) };
  }
  // A box on this computer runs as this account, so its home is ours too.
  d.home ||= name ? (st.boxes[name]?.info as { home?: string } | undefined)?.home : undefined;

  // Kept on the laptop, so `berth doctor --report` shows the app's part.
  void client.laptop("PUT", APP_DIAGNOSTICS_DOC, app).catch(() => {});
  return d;
}

export async function diagnosticsText(): Promise<string> {
  try {
    return formatDiagnostics(await collectDiagnostics());
  } catch (err) {
    // Never nothing: what failed is itself worth pasting.
    return formatDiagnostics({ generated: new Date().toISOString(), agent: { state: "unknown", error: errorMessage(err) }, doctor_error: "couldn't collect diagnostics" });
  }
}

export async function copyDiagnostics(): Promise<boolean> {
  return copyText(await diagnosticsText(), "Diagnostics copied");
}
