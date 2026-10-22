import { basename, dirname } from "@/components/add-project/intent";
import { shortPath } from "@/components/add-project/unique-name";
import type { Plan } from "@/components/add-project/use-plan";
import type { Location } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { plainError } from "@/lib/errors";
import { type KitInfo, kitsApi } from "@/lib/kits";
import { projectsApi } from "@/lib/projects";
import { useStore } from "@/lib/store";

// runPlan does what the plan says on the chosen box, then sets the same
// repository up on the other boxes picked ("also on"), by cloning its remote
// there, and applies the project's kit everywhere it landed. A project on
// several boxes is one project: the copies join by their remote.

export interface RunOptions {
  box: string;
  home?: string;
  also: string[];
  kit?: KitInfo;
  signal: AbortSignal;
  onLine(box: string, line: string): void;
}

export interface RunResult {
  loc: Location;
  extras: { box: string; loc?: Location; error?: string }[];
}

export async function runPlan(plan: Plan, o: RunOptions): Promise<RunResult> {
  const client = useStore.getState().client;
  if (!client) throw new Error("Not connected to the laptop agent.");
  const { box } = o;

  let loc: Location;
  switch (plan.do) {
    case "open":
      loc = plan.loc;
      break;
    case "add":
      loc = await projectsApi.add(client, box, plan.name, plan.path);
      break;
    case "clone":
      loc = await projectsApi.clone(client, box, { url: plan.url, parent: plan.parent, name: plan.folder }, (l) => o.onLine(box, l), o.signal);
      break;
    case "create":
      loc = await projectsApi.create(client, box, plan.folder, plan.parent);
      break;
    default:
      throw new Error(plan.do === "blocked" ? plan.message : "Pick a folder first.");
  }

  const extras: RunResult["extras"] = [];
  const remote = plan.do === "clone" ? plan.url : (loc.remote ?? remoteElsewhere(loc.slug ?? (plan.do === "add" ? plan.slug : undefined)));
  if (o.also.length && !remote) {
    for (const b of o.also) {
      o.onLine(b, "skipped: this repository has no remote to clone from");
      extras.push({ box: b, error: "no remote" });
    }
  } else if (o.also.length && remote) {
    // The same place on every box: ~/work/app here is ~/work/app there.
    const short = shortPath(loc.path, o.home);
    const parent = plan.do === "clone" ? plan.parent : short.startsWith("~") ? dirname(short) : "~/work";
    const folder = plan.do === "clone" ? plan.folder : basename(loc.path);
    await Promise.all(
      o.also.map(async (b) => {
        try {
          const l = await projectsApi.clone(client, b, { url: remote, parent, name: folder }, (line) => o.onLine(b, line), o.signal);
          extras.push({ box: b, loc: l });
          o.onLine(b, `Added ${l.name} at ${l.path}`);
        } catch (err) {
          const msg = o.signal.aborted ? "stopped" : plainError(err);
          extras.push({ box: b, error: msg });
          o.onLine(b, `failed: ${msg}`);
        }
      }),
    );
  }

  // The kit goes wherever the project is new: a project that was already
  // here keeps the setup it has.
  const targets = [...(plan.do === "open" ? [] : [{ box, location: loc.name }]), ...extras.flatMap((e) => (e.loc ? [{ box: e.box, location: e.loc.name }] : []))];
  if (o.kit && targets.length) {
    o.onLine(targets[0].box, `Applying the ${o.kit.name} kit…`);
    try {
      const end = await kitsApi.apply(
        client,
        o.kit.id,
        targets,
        (l) => {
          if (l.error) o.onLine(l.box ?? box, `kit: ${l.error}`);
          l.warnings?.forEach((w) => o.onLine(l.box ?? box, `kit: ${w}`));
        },
        o.signal,
      );
      o.onLine(targets[0].box, end.error ? `kit: ${end.error}` : `Applied ${o.kit.name}.`);
    } catch (err) {
      o.onLine(targets[0].box, `kit: ${errorMessage(err)}`);
    }
  }

  return { loc, extras };
}

// remoteElsewhere finds a repository's remote from a copy on another box,
// for a folder whose own location did not report one.
function remoteElsewhere(slug?: string): string | undefined {
  if (!slug) return undefined;
  const boxes = useStore.getState().boxes;
  for (const b of Object.values(boxes)) for (const l of b?.locations ?? []) if (l.remote && l.slug?.toLowerCase() === slug.toLowerCase()) return l.remote;
  return undefined;
}

// mergeProgress keeps git's "Receiving objects: 42%" lines from piling up:
// a line that updates the same step replaces the last one.
export function mergeProgress(lines: string[], line: string): string[] {
  const step = (l: string) => /^([A-Za-z ]+):\s+\d+%/.exec(l)?.[1];
  const s = step(line);
  if (s && lines.length && step(lines[lines.length - 1]) === s) return [...lines.slice(0, -1), line];
  return [...lines, line].slice(-200);
}
