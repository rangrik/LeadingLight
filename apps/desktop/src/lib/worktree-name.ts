// A task's worktree name, from its title (DECISIONS.md, 42): its telling words, short, never taken.
const STOP = new Set("a an the of on in to for and or with at by from please is are it this that as be my our your".split(" "));

// The words, joined, that fit in max characters; a first word too long is cut.
const fit = (words: string[], max: number) => words.reduce((name, w) => (!name ? w.slice(0, max) : name.length + 1 + w.length <= max ? `${name}-${w}` : name), "");

export function worktreeName(title: string, taken: Set<string>): string {
  // Accents go; a word with other letters left (a name the runtime can't take) goes whole.
  const words = (title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => /^[a-z0-9]+$/.test(w) && !/^\d+$/.test(w) && !STOP.has(w))
    .slice(0, 5);
  // berthd keeps names starting with "art-" for artifact hosts.
  if (words[0] === "art" && words.length > 1) words.shift();
  if (!words.length) words.push(`task-${Array.from({ length: 4 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("")}`);
  let name = fit(words, 30);
  for (let n = 2; taken.has(name); n++) name = `${fit(words, 30 - `-${n}`.length)}-${n}`;
  return name;
}
