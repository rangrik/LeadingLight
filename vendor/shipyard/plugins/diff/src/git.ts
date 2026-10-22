// How the Diff panel reads a branch's diff from a box. Everything runs as
// one `sh` script through orchestrate.exec, whose output is capped at 64 KB:
// the script writes the whole answer (a header, git's numstat and the patch,
// itself capped at LIMIT) to a temporary file, gzips it, and prints the first
// slice as base64. Larger answers are read in further slices from that file.

export type Scope = "branch" | "uncommitted" | "all";

// The patch is cut at 4 MB: more than anyone reads in a panel.
export const LIMIT = 4 << 20;
// One slice of the gzipped answer: base64 makes it 4/3 bigger, which with
// the line breaks base64 adds stays under exec's 64 KB.
const STEP = 45_000;

export interface FileStat {
  path: string;
  from?: string;
  added: number;
  removed: number;
  binary: boolean;
}

export type DiffResult =
  | { kind: "notgit" }
  | { kind: "nobase"; branch: string }
  | { kind: "nohead" }
  | {
      kind: "ok";
      branch: string;
      // The default branch it is compared with, and where they meet.
      base: string;
      mergeBase: string;
      files: FileStat[];
      patch: string;
      // The patch was longer than LIMIT; only its whole files are kept.
      truncated: boolean;
    };

export type Run = (command: string, timeout?: string) => Promise<{ exit_code: number; output: string }>;

// The script never uses single quotes, so it can be passed as one.
const PLAN = String.raw`
scope="$1"; cap="$2"; step="$3"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "@@berth-diff notgit"; exit 0; }
cd "$(git rev-parse --show-toplevel)" || exit 1
tmp=/tmp
[ -n "$TMPDIR" ] && [ -d "$TMPDIR" ] && tmp=$TMPDIR
find "$tmp" -maxdepth 1 -name "berth-diff.*" -mmin +30 -exec rm -f {} + 2>/dev/null
G="git -c core.quotepath=false -c diff.noprefix=false -c diff.mnemonicprefix=false -c diff.relative=false -c color.ui=never"
branch=$(git symbolic-ref -q --short HEAD 2>/dev/null || true)
head=$(git rev-parse -q --verify "HEAD^{commit}" 2>/dev/null || true)
base=""
for r in "$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)" origin/main main origin/master master; do
  if [ -n "$r" ] && git rev-parse -q --verify "$r^{commit}" >/dev/null 2>&1; then base=$r; break; fi
done
mb=""
if [ -n "$base" ] && [ -n "$head" ]; then mb=$(git merge-base HEAD "$base" 2>/dev/null || true); fi
case "$scope" in
  branch|all) [ -n "$head" ] || { echo "@@berth-diff nohead"; exit 0; }
    [ -n "$mb" ] || { echo "@@berth-diff nobase $branch"; exit 0; } ;;
esac
t=$(mktemp "$tmp/berth-diff.XXXXXX") || exit 1
idx=""
if [ "$scope" != branch ]; then
  # New files show up as added through a copy of the index that knows of
  # them (git add -N); the real index is never touched.
  idx="$t.idx"
  real=$(git rev-parse --git-path index)
  [ -f "$real" ] && cp "$real" "$idx"
  GIT_INDEX_FILE="$idx" git add -N -- . >/dev/null 2>&1
fi
from=$mb
if [ "$scope" = uncommitted ]; then
  from=$head
  [ -n "$from" ] || from=$(git hash-object -t tree /dev/null)
fi
to=""
[ "$scope" = branch ] && to=HEAD
d() { if [ -n "$idx" ]; then GIT_INDEX_FILE="$idx" $G diff "$@"; else $G diff "$@"; fi; }
{
  printf "branch\t%s\nbase\t%s\nmergebase\t%s\n--numstat--\n" "$branch" "$base" "$mb"
  d --numstat -z -M $from $to
  printf "\n--patch--\n"
  d --no-color --no-ext-diff --no-textconv -M $from $to | head -c $((cap + 1))
} > "$t"
rm -f "$idx"
enc=raw
if command -v gzip >/dev/null 2>&1 && gzip -c "$t" > "$t.z"; then mv "$t.z" "$t"; enc=gzip; fi
size=$(wc -c < "$t" | tr -d " ")
echo "@@berth-diff ok $t $enc $size"
head -c "$step" "$t" | base64
[ "$size" -le "$step" ] && rm -f "$t"
true
`;

const CHUNK = `
f="$1"
case "$f" in */berth-diff.*) ;; *) exit 2 ;; esac
[ -f "$f" ] || { echo "@@berth-diff gone"; exit 0; }
echo "@@berth-diff chunk"
tail -c +$(($2 + 1)) "$f" | head -c "$3" | base64
`;

function sq(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function planCommand(scope: Scope) {
  return `sh -c ${sq(PLAN)} berth-diff ${scope} ${LIMIT} ${STEP}`;
}

function chunkCommand(file: string, offset: number) {
  return `sh -c ${sq(CHUNK)} berth-diff ${sq(file)} ${offset} ${STEP}`;
}

// What follows our marker line; a login shell may print before it.
function afterMarker(output: string): { head: string; body: string } {
  const at = output.lastIndexOf("@@berth-diff ");
  if (at < 0) throw new Error(output.trim() || "the box gave no answer");
  const nl = output.indexOf("\n", at);
  return { head: output.slice(at + 13, nl < 0 ? undefined : nl).trim(), body: nl < 0 ? "" : output.slice(nl + 1) };
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function fetchDiff(run: Run, scope: Scope, signal?: AbortSignal): Promise<DiffResult> {
  const first = await run(planCommand(scope), "120s");
  const { head, body } = afterMarker(first.output);
  const [kind, ...rest] = head.split(" ");
  if (kind === "notgit") return { kind: "notgit" };
  if (kind === "nohead") return { kind: "nohead" };
  if (kind === "nobase") return { kind: "nobase", branch: rest.join(" ") };
  if (kind !== "ok" || first.exit_code !== 0) throw new Error(first.output.trim() || `git exited with ${first.exit_code}`);
  const [file, enc, sizeText] = rest;
  const size = Number(sizeText);
  const parts: Uint8Array[] = [fromBase64(body)];
  let have = parts[0].length;
  // The rest in slices, a few at a time.
  const offsets: number[] = [];
  for (let off = have; off < size; off += STEP) offsets.push(off);
  for (let i = 0; i < offsets.length; i += 4) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const got = await Promise.all(
      offsets.slice(i, i + 4).map(async (off) => {
        const r = await run(chunkCommand(file, off));
        const m = afterMarker(r.output);
        if (m.head !== "chunk") throw new Error("The diff changed while it was read. Refresh to read it again.");
        return fromBase64(m.body);
      }),
    );
    parts.push(...got);
    have += got.reduce((n, p) => n + p.length, 0);
  }
  if (offsets.length) void run(`rm -f ${sq(file)}`).catch(() => {});
  let bytes: Uint8Array = new Uint8Array(have);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  if (enc === "gzip") bytes = await gunzip(bytes);
  return parsePayload(new TextDecoder().decode(bytes));
}

// parsePayload reads what the plan script wrote: a header, numstat -z and
// the patch. Exported for the mock, which writes the same.
export function parsePayload(text: string): DiffResult & { kind: "ok" } {
  const n = text.indexOf("--numstat--\n");
  const p = text.indexOf("\n--patch--\n", n);
  const header = Object.fromEntries(
    text
      .slice(0, n)
      .split("\n")
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf("\t")), l.slice(l.indexOf("\t") + 1)]),
  );
  const files = parseNumstat(text.slice(n + 12, p));
  let patch = text.slice(p + 11);
  let truncated = false;
  if (patch.length > LIMIT) {
    truncated = true;
    // Keep whole files only: a cut hunk would not parse.
    const cut = patch.lastIndexOf("\ndiff --git ", LIMIT);
    patch = cut > 0 ? patch.slice(0, cut + 1) : "";
  }
  return { kind: "ok", branch: header.branch ?? "", base: header.base ?? "", mergeBase: header.mergebase ?? "", files, patch, truncated };
}

// numstat -z: "added\tremoved\tpath\0", or for a rename
// "added\tremoved\t\0from\0to\0". Binary files count "-".
export function parseNumstat(text: string): FileStat[] {
  const fields = text.split("\0");
  const out: FileStat[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i].replace(/^\n+/, "");
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(f);
    if (!m) continue;
    const binary = m[1] === "-";
    const stat: FileStat = { path: m[3], added: binary ? 0 : Number(m[1]), removed: binary ? 0 : Number(m[2]), binary };
    if (m[3] === "") {
      stat.from = fields[++i];
      stat.path = fields[++i];
    }
    out.push(stat);
  }
  return out;
}

const LOCKFILES = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock|Pipfile\.lock|flake\.lock|mix\.lock|pubspec\.lock|Package\.resolved|[^/]+\.lock)$/;
const GENERATED = /(\.min\.(js|css)|\.map|\.snap|\.svg|(^|\/)(dist|vendor|__generated__|generated)\/.*)$/;

// Files that start collapsed: lockfiles, generated output, and big changes.
export function startsCollapsed(f: FileStat): string | undefined {
  if (LOCKFILES.test(f.path)) return "Lockfile";
  if (GENERATED.test(f.path)) return "Generated";
  if (f.added + f.removed > 1500) return "Large";
  return undefined;
}

export function splitPath(path: string) {
  const slash = path.lastIndexOf("/");
  return { name: path.slice(slash + 1), dir: slash > 0 ? path.slice(0, slash) : "" };
}
