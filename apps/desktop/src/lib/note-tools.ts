import { htmlDoc } from "@leadinglight/editor/editor";
import { markdownHtml } from "@/lib/markdown-html";
import { liveContent, liveEditor } from "~/lib/live";
import { docText, objects } from "~/lib/objects";
import { docMarkdown, plainWords } from "~/lib/page-markdown";
import { createPage, pageOf, space } from "~/lib/space";
import { PAGE_TYPE } from "~/lib/store";
import { pageInit } from "~/lib/templates";
import { isReport } from "~/lib/work";
import { authored, stampDoc } from "@leadinglight/editor/authorship";
import { action, type ChangeContext } from "~/lib/history-types";
import { flushAll } from "~/lib/saving";

// The page tools Claude and GPT work with, run here in the webview: an MCP server over Claude
// Code's control protocol, and Codex's dynamic tools (lib/turn.ts). Reading never asks; changes go
// through the page's open editor, so each is one undo step and the pane never saves over it.

const READ = { readOnlyHint: true };
const text = (description: string) => ({ type: "string", description });
const schema = (properties: Record<string, object>, required: string[] = []) => ({ type: "object", properties, required });

export const TOOLS = [
  {
    name: "read_page",
    description: "Read a page as Markdown: this page when no page is given, or another by its id or title.",
    inputSchema: schema({ page: text("Another page's id or title") }),
    annotations: READ,
  },
  {
    name: "search_pages",
    description: "Search every page's title and text. Returns up to 20 pages with their ids and the line that matched.",
    inputSchema: schema({ query: text("Words to look for") }, ["query"]),
    annotations: READ,
  },
  {
    name: "edit_page",
    description: "Replace words in this page. find is the page's words exactly as they read, without Markdown marks, and must be found once. replace is Markdown; empty deletes.",
    inputSchema: schema({ find: text("The words to replace"), replace: text("Markdown to put in their place") }, ["find", "replace"]),
  },
  {
    name: "insert_text",
    description: "Add Markdown blocks to this page: after the block holding the words in after, or at the end.",
    inputSchema: schema({ markdown: text("The blocks to add"), after: text("Words in the block to add them after") }, ["markdown"]),
  },
  {
    name: "write_page",
    description: "Replace this page's whole body with Markdown. Only for rewriting the whole page.",
    inputSchema: schema({ markdown: text("The new body") }, ["markdown"]),
  },
  {
    name: "create_page",
    description: "Make a new page with a title and a Markdown body. Returns its id.",
    inputSchema: schema({ title: text("The new page's title"), markdown: text("Its body") }, ["title"]),
  },
];

// The same tools as Codex takes them.
export const GPT_TOOLS = TOOLS.map(({ name, description, inputSchema }) => ({ type: "function", name, description, inputSchema }));

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (t: string): Result => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): Result => ({ ...ok(t), isError: true });

const titleOf = (id: string) => pageOf(id)?.title || "Untitled";
const quoted = (id: string) => `“${titleOf(id)}”`;
const html = (md: string) => markdownHtml(md.trim()).html;
// One paragraph goes in as inline text, so replacing words keeps their sentence whole.
export function inlineHtml(md: string): string {
  const h = html(md).trim();
  return /^<p>([\s\S]*)<\/p>$/.exec(h)?.[1] ?? h;
}

const findPage = (ref: string) => {
  const all = space.get().pages;
  const q = ref.trim().toLowerCase();
  return (all.find((p) => p.id === ref) ?? all.find((p) => p.title.toLowerCase() === q) ?? all.find((p) => q && p.title.toLowerCase().includes(q)))?.id;
};
const bodyOf = async (id: string) => liveContent(id) ?? (await objects.get(id))?.content ?? null;

export async function runTool(pageId: string, name: string, a: Record<string, string | undefined>, context = action("Agent edited page", { kind: "agent", name: "Agent" }), canChange?: () => boolean): Promise<Result> {
  if (name === "read_page" || name === "search_pages") return executeTool(pageId, name, a, context);
  await flushAll();
  if (canChange && !canChange()) return fail("This turn stopped before the page could be changed.");
  const result = await authored(context, () => executeTool(pageId, name, a, context, canChange));
  await flushAll();
  return result;
}

async function executeTool(pageId: string, name: string, a: Record<string, string | undefined>, context: ChangeContext, canChange?: () => boolean): Promise<Result> {
  if (name === "read_page") {
    const id = a.page ? findPage(a.page) : pageId;
    if (!id) return fail(`No page is called "${a.page}". search_pages finds pages by their words.`);
    return ok(`# ${titleOf(id)}\n(id: ${id})\n\n${docMarkdown(await bodyOf(id), titleOf)}`);
  }
  if (name === "search_pages") {
    const q = (a.query ?? "").trim().toLowerCase();
    if (!q) return fail("Give some words to look for.");
    const titled = space.get().pages.filter((p) => !p.properties.templateOf && p.title.toLowerCase().includes(q));
    const found = new Map(titled.map((p) => [p.id, ""]));
    for (const o of await objects.containing(q)) {
      if (o.properties.templateOf) continue;
      found.set(o.id, docText(liveContent(o.id) ?? o.content).split("\n").find((l) => l.toLowerCase().includes(q)) ?? "");
    }
    const rows = [...found].slice(0, 20).map(([id, line]) => `- ${titleOf(id)} (id: ${id})${line ? `: ${line.slice(0, 200)}` : ""}`);
    return ok(rows.length ? rows.join("\n") : `No page has "${a.query}".`);
  }
  if (name === "create_page") {
    const title = a.title?.trim() || "Untitled";
    const init = await pageInit(PAGE_TYPE, { title, ...(a.markdown?.trim() && { content: htmlDoc(html(a.markdown)) }) });
    if (canChange && !canChange()) return fail("This turn stopped before the page could be created.");
    const obj = await createPage(init, context);
    return ok(`Created ${quoted(obj.id)} (id: ${obj.id}).`);
  }

  // The rest change this page, through its editor. A report stays as its agent published it.
  if (isReport(pageId)) return fail(`${quoted(pageId)} is an agent's report, which isn't changed once published.`);
  const ed = liveEditor(pageId);
  if (!ed) return fail(`${quoted(pageId)} is not open any more, so it can't be changed. Ask the person to open it.`);
  if (name === "edit_page") {
    const find = a.find ?? "";
    const hit = ed.find(find, 0) ?? ed.find(plainWords(find), 0);
    if (!hit) return fail(`"${find}" is not in ${quoted(pageId)}. Read the page again and use its words as they are.`);
    const times = hit.text.includes("\n") ? 1 : ed.text().split(hit.text).length - 1;
    if (times > 1) return fail(`"${hit.text}" is in the page ${times} times. Include more of the words around it.`);
    ed.replaceRange(hit.from, hit.to, inlineHtml(a.replace ?? ""));
    return ok(`Changed "${hit.text}" in ${quoted(pageId)}.`);
  }
  if (name === "insert_text") {
    const after = a.after ? (ed.find(a.after, 0) ?? ed.find(plainWords(a.after), 0)) : null;
    if (a.after && !after) return fail(`"${a.after}" is not in ${quoted(pageId)}.`);
    ed.insertAfter(after?.to ?? Number.MAX_SAFE_INTEGER, html(a.markdown ?? ""));
    return ok(`Added to ${quoted(pageId)}${after ? ` after "${after.text}"` : " at the end"}.`);
  }
  if (name === "write_page") {
    ed.setContent(stampDoc(htmlDoc(html(a.markdown ?? "")), context.author)!);
    return ok(`Rewrote ${quoted(pageId)}.`);
  }
  return fail(`There is no tool called ${name}.`);
}

type Rpc = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: Record<string, string> } };

// One MCP message from Claude Code; notifications get the empty answer the Agent SDK gives.
export async function serve(pageId: string, msg: Rpc, context?: ChangeContext, canChange?: () => boolean): Promise<object> {
  const answer = (result: object) => ({ jsonrpc: "2.0", id: msg.id, result });
  if (msg.id === undefined) return { jsonrpc: "2.0", id: 0, result: {} };
  if (msg.method === "initialize") return answer({ protocolVersion: msg.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "notes", version: "1" } });
  if (msg.method === "tools/list") return answer({ tools: TOOLS });
  if (msg.method === "ping") return answer({});
  if (msg.method === "tools/call") {
    const result = await runTool(pageId, msg.params?.name ?? "", msg.params?.arguments ?? {}, context, canChange).catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
    return answer(result);
  }
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `No method ${msg.method}` } };
}
