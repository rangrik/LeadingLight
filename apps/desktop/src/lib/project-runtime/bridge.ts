import { type AgentCall, projectOf, runAgentTool } from "~/lib/agent-tools";
import { call } from "~/lib/project-runtime/transport";

// Agents' LeadingLight tools are answered here (DECISIONS.md, 19). The runtime holds each call
// until this asks for it; a write waits in the runtime while the app is quit, and is taken once
// it opens. Writes run one at a time, in the order they were made.

let serving = false;
let writes: Promise<unknown> = Promise.resolve();

async function answer(c: AgentCall, write: boolean) {
  // Another app's folder (a second browser profile on this runtime): its write waits for that app.
  if (write && !projectOf(c.caller)) return;
  const run = () => runAgentTool(c).then((result) => ({ result: result ?? null }), (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  const out = write ? await (writes = writes.then(run, run)) : await run();
  // Not told: the runtime offers the call again after a while, and a write is applied once.
  await call("POST", `/v1/ll/calls/${c.id}`, out).catch(() => {});
}

export function serveAgents() {
  if (serving) return;
  serving = true;
  void (async () => {
    for (let wait = 1000; ; ) {
      const r = await call<(AgentCall & { write?: boolean })[]>("GET", "/v1/ll/calls?wait=25").catch(() => null);
      if (r?.status !== 200 || !Array.isArray(r.body)) {
        await new Promise((ok) => setTimeout(ok, wait));
        wait = Math.min(wait * 2, 30_000);
        continue;
      }
      wait = 1000;
      for (const c of r.body) void answer(c, !!c.write);
    }
  })();
}
