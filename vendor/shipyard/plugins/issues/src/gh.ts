// The gh calls behind the Issues screen, run on a box with exec in the
// repository's main checkout, and how their failures read. Every answer is
// shaped by --jq on the box so it stays small (exec keeps the last 64 KB).

export interface Label {
  name: string;
  // Hex without the #, as GitHub stores it.
  color: string;
}

// A pull request GitHub knows will close the issue when it merges.
export interface LinkedPR {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  draft?: boolean;
  title?: string;
  url?: string;
}

export interface Issue {
  number: number;
  title: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  labels: Label[];
  assignees: string[];
  comments: number;
  prs: LinkedPR[];
}

export interface IssueList {
  // Who gh is logged in as on that box: "mine" means assigned to them.
  viewer: string;
  repo: string;
  enabled: boolean;
  // Open issues in all; the list holds the 100 most recently updated.
  total: number;
  issues: Issue[];
}

export interface Comment {
  author?: string;
  body: string;
  createdAt: string;
  url?: string;
}

export interface IssueDetail extends Omit<Issue, "comments"> {
  url: string;
  state: "OPEN" | "CLOSED";
  body: string;
  comments: Comment[];
  totalComments: number;
}

export type Problem =
  | { kind: "no-gh" }
  | { kind: "no-auth" }
  | { kind: "not-github" }
  | { kind: "disabled"; repo: string }
  | { kind: "offline" }
  | { kind: "error"; message: string };

export const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

const ISSUE_FIELDS = "number title createdAt updatedAt author{login} labels(first:12){nodes{name color}} assignees(first:6){nodes{login}}";

const LIST_QUERY = `query($owner:String!,$name:String!){viewer{login} repository(owner:$owner,name:$name){nameWithOwner hasIssuesEnabled issues(first:100,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){totalCount nodes{${ISSUE_FIELDS} comments{totalCount} closedByPullRequestsReferences(first:4,includeClosedPrs:true){nodes{number state isDraft}}}}}}`;

const LIST_JQ = `{viewer: .data.viewer.login, repo: .data.repository.nameWithOwner, enabled: .data.repository.hasIssuesEnabled, total: (.data.repository.issues.totalCount // 0), issues: [(.data.repository.issues.nodes // [])[] | {number, title, author: .author.login, createdAt, updatedAt, labels: [.labels.nodes[] | {name, color}], assignees: [.assignees.nodes[].login], comments: .comments.totalCount, prs: [.closedByPullRequestsReferences.nodes[] | {number, state, draft: .isDraft}]}]}`;

const DETAIL_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){${ISSUE_FIELDS} url state body comments(last:50){totalCount nodes{author{login} body createdAt url}} closedByPullRequestsReferences(first:6,includeClosedPrs:true){nodes{number state isDraft title url}}}}}`;

// Bodies are cut short on the box so a long thread can't push the start of
// the answer out of exec's 64 KB.
const DETAIL_JQ = `.data.repository.issue | {number, title, url, state, createdAt, updatedAt, body: ((.body // "")[:24000]), author: .author.login, labels: [.labels.nodes[] | {name, color}], assignees: [.assignees.nodes[].login], totalComments: .comments.totalCount, comments: [.comments.nodes[] | {author: .author.login, body: ((.body // "")[:4000]), createdAt, url}], prs: [.closedByPullRequestsReferences.nodes[] | {number, state, draft: .isDraft, title, url}]}`;

function split(slug: string) {
  const [owner, name] = slug.split("/");
  return `-f owner=${quote(owner)} -f name=${quote(name)}`;
}

export const listCommand = (slug: string) => `gh api graphql ${split(slug)} -f query=${quote(LIST_QUERY)} --jq ${quote(LIST_JQ)}`;

export const detailCommand = (slug: string, n: number) => `gh api graphql ${split(slug)} -F number=${n} -f query=${quote(DETAIL_QUERY)} --jq ${quote(DETAIL_JQ)}`;

// The body goes through base64 so nothing in it is ever read by the shell.
export const commentCommand = (slug: string, n: number, body: string) =>
  `printf %s ${quote(toBase64(body))} | base64 -d | gh issue comment ${n} --repo ${quote(slug)} --body-file -`;

function toBase64(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// readProblem sorts a failed gh call into something the screen can explain.
export function readProblem(exitCode: number, output: string, repo = ""): Problem {
  const text = output.toLowerCase();
  if (exitCode === 127 || text.includes("command not found")) return { kind: "no-gh" };
  if (text.includes("gh auth login") || text.includes("not logged in") || text.includes("bad credentials")) return { kind: "no-auth" };
  if (text.includes("has disabled issues")) return { kind: "disabled", repo };
  if (text.includes("none of the git remotes") || text.includes("no git remotes") || text.includes("not a git repository")) return { kind: "not-github" };
  return { kind: "error", message: output.trim().split("\n").slice(-3).join("\n") || `gh exited with ${exitCode}` };
}

export function parse<T>(exitCode: number, output: string, repo?: string): { ok: T } | { problem: Problem } {
  if (exitCode !== 0) return { problem: readProblem(exitCode, output, repo) };
  try {
    return { ok: JSON.parse(output) as T };
  } catch {
    return { problem: { kind: "error", message: output.trim().slice(-400) || "gh's answer was not JSON" } };
  }
}

export function since(iso?: string): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo ago`;
  return `${Math.floor(s / (86400 * 365))}y ago`;
}

export const isGitHub = (remote?: string) => !!remote && /github\.com[:/]/i.test(remote);

export const issueUrl = (repo: string, n: number) => `https://github.com/${repo}/issues/${n}`;
export const pullUrl = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`;

// The worktree a resolver makes for an issue is issue-<n> or
// issue-<n>-<slug-of-title>; this finds the number in a branch or name.
export function issueNumberOf(branchOrName?: string): number | undefined {
  const m = /(?:^|\/)issue-(\d+)(?:-|$)/.exec(branchOrName ?? "");
  return m ? Number(m[1]) : undefined;
}

// What an agent is first told: {{number}}, {{title}}, {{body}}, {{url}} and
// {{repo}} are filled in from the issue.
export const DEFAULT_TEMPLATE = "Work on #{{number}}: {{title}}\n\n{{url}}\n\n{{body}}\n\nOpen a PR that closes #{{number}} when done.";

const BODY_LIMIT = 8000;

export function renderPrompt(template: string, repo: string, issue: { number: number; title: string; body?: string; url?: string }): string {
  let body = stripComments(issue.body ?? "").trim();
  const url = issue.url ?? issueUrl(repo, issue.number);
  if (body.length > BODY_LIMIT) body = `${body.slice(0, BODY_LIMIT).trimEnd()}\n\n(The issue goes on; read the rest at ${url}.)`;
  const vars: Record<string, string> = { number: String(issue.number), title: issue.title, body, url, repo };
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, k: string) => vars[k] ?? whole)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Issue templates leave HTML comments in bodies; nobody wants to read them.
export const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "");

// A label's text colour on its own background, as GitHub picks it.
export function labelInk(hex: string): string {
  const n = Number.parseInt(hex, 16);
  if (Number.isNaN(n)) return "inherit";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1f2328" : "#ffffff";
}
