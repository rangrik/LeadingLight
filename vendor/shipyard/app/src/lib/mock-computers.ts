import type { BerthEvent, Status } from "@/lib/api";
import { findJoinLink, type Invite, type JoinOutput, type JoinResult, type TrustedComputer } from "@/lib/computers";

// More than one computer, in mock mode (?mock=1): making a join link here,
// joining with one (any berth://join? link reads as an invite from a
// MacBook to devl, build and homelab, the last on a tailnet this computer has
// not signed in to, so the sign-in shows), and each box's list of computers.

type Emit = (e: Omit<BerthEvent, "time">) => void;

interface Ctx {
  status: Status;
  networks: { name: string }[];
  addBox(name: string, address: string, network?: string): void;
  emit: Emit;
  delay: <T>(v: T) => Promise<T>;
}

let ctx: Ctx | undefined;

export function initMockComputers(c: Ctx) {
  ctx = c;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const fp = (seed: string) => (seed.repeat(13) + "abcdefghijklmnopqrstuvwxyz234567").slice(0, 52);

const clients: Record<string, TrustedComputer[]> = {
  devl: [
    { name: "my-macbook-pro", fingerprint: fp("mn2b"), paired_at: daysAgo(41), you: true },
    { name: "my-mac-mini", fingerprint: fp("x7qa"), paired_at: daysAgo(2) },
  ],
};

function clientsOf(box: string): TrustedComputer[] {
  return (clients[box] ??= [{ name: "my-macbook-pro", fingerprint: fp("mn2b"), paired_at: daysAgo(12), you: true }]);
}

type Box = { name: string; address: string; network?: string; tailnet?: string };

// Links made here, so joining with one reads back its boxes.
const made = new Map<string, { from: string; expires: string; boxes: Box[] }>();

const demoInvite = () => ({
  from: "my-macbook-pro",
  expires: new Date(Date.now() + 9 * 60_000 + 12_000).toISOString(),
  boxes: [
    { name: "devl", address: "100.64.0.4:7444" },
    { name: "build", address: "100.64.0.12:7444" },
    { name: "homelab", address: "100.64.0.7:7444", network: "personal", tailnet: "home.example" },
  ] as Box[],
});

// A link the shape of a real one: base64url of a few hundred bytes.
function fakeLink(boxes: number): string {
  const bytes = new Uint8Array(24 + boxes * 96);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `berth://join?v=1&d=${b64}`;
}

function readLink(text: string) {
  const link = findJoinLink(text);
  if (!link) return { error: "no join link in that; it starts with berth://join? (Settings → Computers → Add another computer makes one)" };
  const inv = made.get(link) ?? demoInvite();
  if (/expired/.test(text) || Date.parse(inv.expires) < Date.now()) return { error: `this join link expired; make a new one on ${inv.from} with berth invite` };
  return { link, inv };
}

const paired = (name: string) => ctx!.status.boxes.some((b) => b.name === name);
const signedIn = (network?: string) => !network || ctx!.networks.some((n) => n.name === network);

export function computersCall(method: string, path: string, body: unknown): Promise<unknown> | undefined {
  if (!ctx) return undefined;
  const c = ctx;
  if (method === "POST" && path === "/v1/invite") {
    const names = (body as { boxes?: string[] }).boxes ?? c.status.boxes.map((b) => b.name);
    const inv: Invite = { link: "", from: "my-macbook-pro", expires: new Date(Date.now() + 10 * 60_000).toISOString(), boxes: [], skipped: [] };
    for (const name of names) {
      const b = c.status.boxes.find((x) => x.name === name);
      if (!b) continue;
      if (b.state !== "online") inv.skipped.push({ name, error: "offline" });
      else inv.boxes.push({ name, addresses: [b.address], network: b.network, tailnet: b.network ? "example.ts.net" : undefined });
    }
    if (inv.boxes.length === 0) return Promise.reject(new Error(`no box could make an invite (${inv.skipped.map((s) => `${s.name}: ${s.error}`).join("; ")})`));
    inv.link = fakeLink(inv.boxes.length);
    made.set(inv.link, { from: inv.from, expires: inv.expires, boxes: inv.boxes.map((b) => ({ name: b.name, address: b.addresses[0], network: b.network, tailnet: b.tailnet })) });
    for (const b of inv.boxes) c.emit({ type: "pairing.invited", box: b.name, data: { for: "", by: "laptop:my-macbook-pro", expires: inv.expires } });
    return new Promise((r) => setTimeout(() => r(inv), 500));
  }
  const join = /^\/v1\/join(\/check)?$/.exec(path);
  if (method === "POST" && join) {
    const read = readLink((body as { link: string }).link);
    if ("error" in read) return Promise.reject(new Error(read.error));
    const { link, inv } = read;
    if (join[1]) {
      const out: JoinOutput = {
        from: inv.from,
        expires: inv.expires,
        boxes: inv.boxes.map((b): JoinResult => (paired(b.name) ? { name: b.name, status: "already", address: b.address } : { name: b.name, status: "ready", address: b.address, network: b.network, tailnet: b.tailnet, sign_in: !signedIn(b.network) || undefined })),
      };
      return c.delay(out);
    }
    const used = /used/.test(link);
    const boxes = inv.boxes.map((b): JoinResult => {
      if (paired(b.name)) return { name: b.name, status: "already", address: b.address };
      if (used) return { name: b.name, status: "failed", error: "the box refused the code: this link was used already or has expired; make a new one with berth invite" };
      if (!signedIn(b.network)) return { name: b.name, status: "needs-network", network: b.network, tailnet: b.tailnet, error: `sign in to the ${b.network} network to reach it` };
      c.addBox(b.name, b.address, b.network);
      return { name: b.name, status: "paired", address: b.address, network: b.network };
    });
    return new Promise((r) => setTimeout(() => r({ from: inv.from, expires: inv.expires, boxes }), 1400));
  }
  return undefined;
}

export function computersBoxCall(box: string, method: string, path: string): Promise<unknown> | undefined {
  if (!ctx) return undefined;
  if (method === "GET" && path === "clients") return ctx.delay(clientsOf(box));
  const remove = /^clients\/([^/]+)$/.exec(path);
  if (method === "DELETE" && remove) {
    const name = decodeURIComponent(remove[1]);
    const list = clientsOf(box);
    const target = list.find((c) => c.name === name || c.fingerprint === name);
    if (!target) return Promise.reject(new Error("no paired peer with that name or fingerprint"));
    if (target.you) return Promise.reject(new Error(`${name} is the computer asking; forget the box on it instead`));
    clients[box] = list.filter((c) => c !== target);
    ctx.emit({ type: "client.revoked", box, data: { name: target.name, fingerprint: target.fingerprint } });
    return ctx.delay({ removed: target.name });
  }
  return undefined;
}
