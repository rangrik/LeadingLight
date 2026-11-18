// This loopback preview keeps its account, box and conversations in memory.
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

const project = "p-demoatlas";
const connection = { id: "demo-studio", name: "Studio Mac (demo)", url: "https://example.invalid" };
const sessions = new Map();
let paired = true;
const status = () => ({ online: paired, connection: paired ? connection : null });
const response = (body, status = 200) => ({ status, body });

function mac({ method, path, body, expectedConnection }) {
  if (!paired || expectedConnection !== connection.id) return response({ error: "Connect the demo Mac first." }, 403);
  const route = new URL(path, "http://localhost");
  if (path === "/v1/locations") return response([{ name: project, path: "/Projects/Atlas" }]);
  if (route.pathname === "/v1/conversations") return response([...sessions.values()].filter((s) => s.conv.location === route.searchParams.get("location")).map((s) => s.conv));
  if (path === "/v1/sessions" && method === "GET") return response([...sessions.values()].map((s) => s.session));
  if (path === "/v1/sessions" && method === "POST") {
    if (body.location !== project) return response({ error: "Share this project on the Mac first." }, 403);
    if (sessions.has(body.name)) return response({ error: "Already started" }, 409);
    const session = { name: body.name, agent: body.agent, agent_state: "waiting", exited: false };
    const conv = { id: randomUUID(), session: body.name, dir: "/Projects/Atlas", location: project, agent: body.agent, model: body.model, mode: "default", title: body.title, live: true, created: new Date().toISOString() };
    const request = { id: randomUUID(), generation: 1, kind: "approval", blocking: true, tool: "Write", input: { file_path: "summary.md" }, state: "pending", opened: Date.now() };
    sessions.set(body.name, { session, conv, request, transcript: [{ kind: "user", id: randomUUID(), text: body.prompt }], sent: new Set() });
    return response(session);
  }
  const [, , , name, action] = route.pathname.split("/");
  const work = sessions.get(name);
  if (!work) return response({ error: "Unknown demo session." }, 404);
  if (action === "transcript") return response({ items: work.transcript, next: work.transcript.length, gen: "demo", source: "claude" });
  if (action === "requests" && method === "GET") return response([work.request]);
  if (action === "requests" && path.endsWith("/respond")) {
    if (work.request.state === "pending") {
      work.request.state = "resolved";
      work.request.command = body.command;
      work.session.agent_state = "idle";
      work.transcript.push({ kind: "text", id: randomUUID(), text: body.choice === "allow" ? "I wrote the project summary in summary.md." : "I left the project files as they were." });
    }
    return response({ request: work.request, receipt: { state: "accepted" } });
  }
  if (action === "send" && !work.sent.has(body.idem_key)) {
    work.sent.add(body.idem_key);
    work.transcript.push({ kind: "user", id: randomUUID(), text: body.text }, { kind: "text", id: randomUUID(), text: "Received on Studio Mac. This is the same Atlas conversation." });
  }
  if (action === "interrupt") { work.session.agent_state = "idle"; work.request.state = "expired"; }
  if (action === "turns") return response([{ n: 1, state: work.session.agent_state === "idle" ? "finished" : "running", started: work.conv.created }]);
  return response(action === "queue" ? [] : {});
}

const server = await createServer({
  server: { host: "127.0.0.1", port: Number(process.env.QA_PORT || 1461), strictPort: true },
  plugins: [{
    name: "remote-work-demo",
    enforce: "pre",
    transformIndexHtml() {
      return [{ tag: "script", injectTo: "body", attrs: { type: "module" }, children: `
        import { createPage, pageOf, space } from "/src/lib/space.ts";
        import { openPage } from "/src/lib/panes.ts";
        async function seed() {
          if (!space.get().types.length) return;
          stop();
          if (pageOf("demo-atlas")) return;
          await createPage({ id: "demo-atlas", title: "Atlas", typeId: "project" });
          await createPage({ id: "demo-unlinked", title: "Unlinked project", typeId: "project" });
          const task = await createPage({ id: "demo-summary", title: "Summarize the Atlas project", typeId: "task", properties: { "task-project": ["demo-atlas"] } });
          if (!location.search.includes("iphone")) openPage(task.id);
        }
        const stop = space.subscribe(seed); void seed();
      ` }];
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0] || "";
        if (!/^\/(?:api|__mobile|__runtime)\//.test(path)) return next();
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const value = chunks.length && req.headers["content-type"]?.includes("application/json") ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        const left = req.headers.cookie?.includes("demo-signed-out=1");
        let result;
        if (path === "/api/config") result = { ready: true, allowed: true, providers: [] };
        else if (path === "/api/auth/csrf") result = { csrfToken: "demo" };
        else if (path === "/api/auth/signout") {
          res.setHeader("set-cookie", "demo-signed-out=1; Path=/; SameSite=Strict");
          result = { url: new URL("/", `http://${req.headers.host}`).href };
        }
        else if (path === "/api/me" && left) { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"Signed out"}'); return; }
        else if (path === "/api/me") result = { id: "demo-owner", name: "Demo account" };
        else if (path === "/__mobile/request") result = mac(value);
        else if (path === "/__mobile/connect") { paired = true; result = status(); }
        else if (path === "/__mobile/disconnect") { paired = false; result = null; }
        else if (path === "/__mobile/status") result = status();
        else if (path.endsWith("/locations")) result = [];
        else if (path === "/__runtime/v1/mobile") result = { enabled: false, name: "This demo device", projects: [] };
        else if (path === "/api/devices") result = { devices: [] };
        else if (path === "/api/relay/pairs") result = { pairs: [] };
        else if (path === "/api/publications/status") result = { publications: [] };
        else result = { accounts: [], devices: [], events: [], state: "stopped" };
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(result));
      });
    },
  }],
});
await server.listen();
server.printUrls();
