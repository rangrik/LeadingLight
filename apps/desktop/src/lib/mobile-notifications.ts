import { mobileAgents, refreshMobileAgents } from "./mobile-agents";
import { isNative, platformReady } from "./platform";
import { createStore } from "./state";

type NativeStatus = { authorization: "notDetermined" | "denied" | "authorized" | "provisional" | "ephemeral"; token?: string; environment?: "sandbox" | "production"; error?: string };
export type MobileNotificationTarget = { connection: string; project: string; conversation: string; request: string; generation: number };
const preference = "leadinglight.agent-notifications";
const enabled = () => { try { return localStorage.getItem(preference) === "on"; } catch { return false; } };
export const mobileNotifications = createStore({ enabled: enabled(), registered: false, busy: false, authorization: "notDetermined" as NativeStatus["authorization"], error: "", cleanupError: "" });
let initialized: Promise<void> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<void> = Promise.resolve();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!(await isNative)) throw new Error("Notifications are available in the installed iPhone and iPad apps.");
  return (await import("@tauri-apps/api/core")).invoke<T>(command, args);
}

function update(requestPermission = false): Promise<void> {
  const work = async () => {
    mobileNotifications.set({ ...mobileNotifications.get(), busy: true, error: "" });
    try {
      const cleanup = await invoke<{ pending: number; error: string | null }>("mobile_agents_cleanup_notifications");
      mobileNotifications.set({ ...mobileNotifications.get(), cleanupError: cleanup.error ?? "" });
      const status = await invoke<NativeStatus>(`mobile_notifications_${requestPermission ? "request" : "status"}`);
      mobileNotifications.set({ ...mobileNotifications.get(), authorization: status.authorization });
      const connection = mobileAgents.get().connection;
      if (!connection) { mobileNotifications.set({ ...mobileNotifications.get(), registered: false }); return; }
      const desired = mobileNotifications.get().enabled;
      const allowed = ["authorized", "provisional", "ephemeral"].includes(status.authorization);
      const action = desired && allowed && !status.error && status.token && status.environment ? "register" : "unregister";
      const result = await invoke<{ registered: boolean }>("mobile_agents_notifications", { action, token: status.token ?? null, environment: status.environment ?? null, expectedConnection: connection.id });
      if (mobileAgents.get().connection?.id !== connection.id) return;
      const error = !desired ? "" : status.authorization === "denied" ? "Notifications are off in iOS Settings. Requests are still available in the app." : status.error || (!status.token || !status.environment ? "Waiting for Apple to register notifications. Keep this app online and check again." : "");
      mobileNotifications.set({ ...mobileNotifications.get(), registered: result.registered, error });
    } catch (error) { mobileNotifications.set({ ...mobileNotifications.get(), registered: false, error: message(error) }); }
    finally { mobileNotifications.set({ ...mobileNotifications.get(), busy: false }); }
  };
  const result = queue.then(work, work); queue = result; return result;
}

export async function setMobileNotifications(value: boolean): Promise<void> {
  try { localStorage.setItem(preference, value ? "on" : "off"); }
  catch { mobileNotifications.set({ ...mobileNotifications.get(), error: "Could not save the notification setting. Free device storage and try again." }); return; }
  mobileNotifications.set({ ...mobileNotifications.get(), enabled: value });
  await update(value);
}
export const refreshMobileNotifications = () => update();

// Subscribe after the dialog host mounts, then consume any cold-start tap.
export function initMobileNotifications(): Promise<void> {
  if (initialized) return initialized;
  clearTimeout(retry);
  const cleanups: (() => void)[] = [];
  return initialized = (async () => {
    if (!(await isNative) || await platformReady !== "ios") return;
    const { listen } = await import("@tauri-apps/api/event");
    const opening = new Set<string>();
    const later = () => {
      clearTimeout(retry);
      retry = setTimeout(() => { void drain().catch(later); }, 5000);
    };
    const open = async (payload: unknown) => {
      const raw = payload as { channel?: string; id?: string };
      const key = `${raw?.channel}:${raw?.id}`;
      if (opening.has(key)) return;
      opening.add(key);
      try {
        const target = await invoke<MobileNotificationTarget | null>("mobile_agents_notification", { payload });
        if (target) {
          if (mobileAgents.get().connection?.id !== target.connection) await refreshMobileAgents();
          if (mobileAgents.get().connection?.id === target.connection) {
            window.dispatchEvent(new CustomEvent("leadinglight:mobile-agent-request", { detail: target }));
          } else if (await invoke("mobile_agents_notification", { payload })) {
            throw new Error("Unlock this device and reconnect to open the agent request.");
          }
        }
        await invoke("mobile_notifications_ack_pending", { channel: raw.channel, id: raw.id });
      } catch (error) {
        mobileNotifications.set({ ...mobileNotifications.get(), error: message(error) });
        later();
      }
      finally { opening.delete(key); }
    };
    const drain = async () => {
      const pending = await invoke<unknown>("mobile_notifications_take_pending");
      if (pending) await open(pending);
    };
    cleanups.push(await listen("leadinglight:mobile-notification", (event) => { void open(event.payload); }));
    cleanups.push(await listen("leadinglight:mobile-notification-registration", () => { void update(); }));
    await drain();
    let host = mobileAgents.get().connection?.id;
    cleanups.push(mobileAgents.subscribe(() => {
      const next = mobileAgents.get().connection?.id;
      if (next !== host) { host = next; void update(); }
    }));
    const foreground = () => { if (document.visibilityState === "visible") { void update(); void drain().catch(later); } };
    document.addEventListener("visibilitychange", foreground);
    cleanups.push(() => document.removeEventListener("visibilitychange", foreground));
    await update();
  })().catch((error) => {
    cleanups.forEach((cleanup) => cleanup());
    clearTimeout(retry);
    initialized = undefined;
    mobileNotifications.set({ ...mobileNotifications.get(), error: message(error) });
    retry = setTimeout(() => { void initMobileNotifications(); }, 5000);
  });
}
