// Finding file paths in terminal output, kept free of imports so it can be
// tested on its own.

// File paths in terminal output: src/app.ts:12:3, ./README.md, and absolute
// paths. A path needs an extension or a position, so plain words never
// become links.
const PATH = /(?<![\w./:@-])((?:\.{1,2}\/|\/)?(?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*(?:\.[A-Za-z0-9]{1,10})(?::(\d+)(?::(\d+))?)?|(?:\.{1,2}\/|\/)?(?:[\w@.+-]+\/)+[\w@.+-]+:(\d+)(?::(\d+))?)/g;

export interface PathMatch {
  start: number; // index in the line
  end: number; // exclusive
  path: string;
  line?: number;
  col?: number;
}

export function findPaths(text: string): PathMatch[] {
  const out: PathMatch[] = [];
  for (const m of text.matchAll(PATH)) {
    const whole = m[1];
    const start = m.index ?? 0;
    // Not part of a URL (https://x.y/z) or an email address.
    if (/[a-z]+:\/\/\S*$/i.test(text.slice(0, start)) || text[start - 1] === "@") continue;
    let path = whole;
    let line: number | undefined;
    let col: number | undefined;
    const pos = /:(\d+)(?::(\d+))?$/.exec(whole);
    if (pos) {
      path = whole.slice(0, pos.index);
      line = Number(pos[1]);
      col = pos[2] ? Number(pos[2]) : undefined;
    }
    // An email address is not a file; scoped packages have a slash.
    if (!path.includes("/") && path.includes("@")) continue;
    // Version numbers and hosts (v1.2.3, example.com) are not files.
    if (!path.includes("/") && !line && /^[\w-]+(\.[\w-]+)+$/.test(path) && !/\.(md|ts|tsx|js|jsx|go|py|rs|json|ya?ml|toml|css|html|sh|txt|sql|rb|java|kt|swift|c|h|cpp|lock)$/i.test(path)) continue;
    out.push({ start, end: start + whole.length, path, line, col });
  }
  return out;
}

// resolveIn turns a path from a terminal in dir into an absolute path, or
// nothing when it points outside dir.
export function resolveIn(dir: string, p: string): string | undefined {
  const parts = (p.startsWith("/") ? p : `${dir.replace(/\/$/, "")}/${p}`).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!stack.length) return undefined;
      stack.pop();
    } else stack.push(part);
  }
  const abs = `/${stack.join("/")}`;
  const root = dir.replace(/\/$/, "");
  return abs === root || abs.startsWith(`${root}/`) ? abs : undefined;
}
