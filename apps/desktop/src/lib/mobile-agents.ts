import { isNative } from "./platform";
import { createStore } from "./state";

export type MacConnection = { id: string; name: string; url: string };
type Status = { connection: MacConnection | null; online: boolean; error?: string | null };
type State = Status & { initialized: boolean; connected: boolean; error: string };
export type MobileReply<T> = { status: number; body: T };
export const mobileAgents = createStore<State>({ initialized: false, connected: false, connection: null, online: false, error: "" });
let generation = 0;
let refreshing: Promise<void> | null = null;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const set = (status: Status) => mobileAgents.set({ ...status, initialized: true, connected: Boolean(status.connection), error: status.error ?? "" });

async function command<T>(action: "status" | "connect" | "disconnect" | "request", args: Record<string, unknown> = {}): Promise<T> {
  if (await isNative) return (await import("@tauri-apps/api/core")).invoke<T>(`mobile_agents_${action}`, args);
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("ipad")) {
    const response = await fetch(`/__mobile/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(25_000) });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The mobile preview has no Mac connection. Use the installed iPhone or iPad app.");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The Mac connection failed.");
    return result as T;
  }
  throw new Error("Use the installed iPhone or iPad app to connect to your Mac.");
}

export function refreshMobileAgents(): Promise<void> {
  if (refreshing) return refreshing;
  const current = generation;
  const work = command<Status>("status").then((status) => {
    if (current === generation) set(status);
  }).catch((error) => {
    if (current === generation) mobileAgents.set({ ...mobileAgents.get(), initialized: true, online: false, error: message(error) });
  }).finally(() => { if (refreshing === work) refreshing = null; });
  return refreshing = work;
}

export async function connectMobileAgents(code: string): Promise<void> {
  const current = ++generation;
  refreshing = null;
  try {
    const status = await command<Status>("connect", { code: code.trim() });
    if (current === generation) set(status);
  } catch (error) {
    if (current === generation) mobileAgents.set({ ...mobileAgents.get(), error: message(error) });
    throw error;
  }
}

export async function disconnectMobileAgents(): Promise<void> {
  const current = ++generation;
  refreshing = null;
  await command("disconnect");
  if (current === generation) set({ connection: null, online: false });
}

export async function mobileCall<T = unknown>(method: string, path: string, body?: unknown, expectedConnection?: string): Promise<MobileReply<T>> {
  if (!mobileAgents.get().initialized) await refreshMobileAgents();
  const connection = mobileAgents.get().connection;
  if (!connection) throw new Error("Connect your Mac in Settings > Devices first.");
  if (expectedConnection !== undefined && expectedConnection !== connection.id) throw new Error("The Mac connection changed. Reopen the conversation before continuing.");
  const current = generation;
  try {
    const result = await command<MobileReply<T>>("request", { method, path, body: body ?? null, expectedConnection: expectedConnection ?? connection.id });
    if (current !== generation) throw new Error("The Mac connection changed. Reopen the conversation before continuing.");
    const error = result.status === 401 ? "This connection is no longer allowed. Copy a new code from Devices settings on your Mac." : "";
    mobileAgents.set({ ...mobileAgents.get(), online: !error, error });
    return result;
  } catch (error) {
    if (current === generation) mobileAgents.set({ ...mobileAgents.get(), online: false, error: message(error) });
    throw error;
  }
}
