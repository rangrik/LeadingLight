// What `gh pr view --json` returns, and how its failures read.

export interface Check {
  __typename: "CheckRun" | "StatusContext";
  name?: string;
  context?: string;
  workflowName?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
}

export interface PR {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  url: string;
  author?: { login: string };
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "";
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  body?: string;
  updatedAt?: string;
  reviews?: { author?: { login: string }; state: string; submittedAt?: string; body?: string }[];
  comments?: { author?: { login: string }; body: string; createdAt: string; url?: string }[];
  statusCheckRollup?: Check[];
}

export const FIELDS = "number,title,state,isDraft,url,author,reviewDecision,headRefName,baseRefName,additions,deletions,changedFiles,body,updatedAt,reviews,comments,statusCheckRollup";

export type Outcome =
  | { kind: "pr"; pr: PR }
  | { kind: "none" }
  | { kind: "no-gh" }
  | { kind: "no-auth" }
  | { kind: "not-github" }
  | { kind: "error"; message: string };

// readOutcome sorts gh's answer into what the panel should show.
export function readOutcome(exitCode: number, output: string): Outcome {
  if (exitCode === 0) {
    try {
      return { kind: "pr", pr: JSON.parse(output) as PR };
    } catch {
      return { kind: "error", message: output.trim() };
    }
  }
  const text = output.toLowerCase();
  if (exitCode === 127 || text.includes("command not found")) return { kind: "no-gh" };
  if (text.includes("no pull requests found")) return { kind: "none" };
  if (text.includes("gh auth login") || text.includes("authentication")) return { kind: "no-auth" };
  if (text.includes("none of the git remotes") || text.includes("no git remotes") || text.includes("not a git repository")) return { kind: "not-github" };
  return { kind: "error", message: output.trim() || `gh exited with ${exitCode}` };
}

export type CheckState = "pass" | "fail" | "pending" | "skip";

export function checkState(c: Check): CheckState {
  if (c.__typename === "StatusContext") {
    if (c.state === "SUCCESS") return "pass";
    if (c.state === "FAILURE" || c.state === "ERROR") return "fail";
    return "pending";
  }
  if (c.status !== "COMPLETED") return "pending";
  if (c.conclusion === "SUCCESS") return "pass";
  if (c.conclusion === "SKIPPED" || c.conclusion === "NEUTRAL") return "skip";
  return "fail";
}

export const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export function since(iso?: string): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// plainText makes a GitHub comment readable as text: no HTML comments,
// heading marks, quote marks, emphasis or image syntax.
export function plainText(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]{0,3}(#{1,6}|>+)[ \t]?/gm, "")
    .replace(/\[!(TIP|NOTE|WARNING|IMPORTANT|CAUTION)\]\s*/g, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
