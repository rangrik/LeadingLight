import { Extension } from "@tiptap/core";
import { Fragment, type Node as PMNode, DOMParser as SchemaParser, Slice } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";

// Signs of Markdown that prose doesn't have, so plain text still pastes line by line.
const SIGNS = [
  /^ {0,3}(#{1,6} |> ?\S|```|~~~)/m,
  /^ {0,3}([-*_])( *\1){2,} *$/m,
  /^\|.+\|\s*$/m,
  /^\s*([-*+]|\d+[.)]) \S[\s\S]*^\s*([-*+]|\d+[.)]) \S/m,
  /\*\*\S[^*\n]*\*\*/,
  /\[[^\]\n]+\]\(\S+\)/,
];
const isMarkdown = (text: string) => SIGNS.some((sign) => sign.test(text));

// HTML with structure of its own (a web page, this editor) beats its text. VS Code sends only
// styled lines, which add nothing to the Markdown.
const RICH = /data-pm-slice|<(h[1-6]|ul|ol|table|blockquote|a|img|strong|b|em|i)[\s>]/i;
// The clipboard's HTML, read, when it holds preformatted text.
const preformatted = (html: string) => (/<pre[\s>]/i.test(html) ? new DOMParser().parseFromString(html, "text/html").body : null);
// Code from a web page has a <code> or colouring in its <pre>. Markdown as written comes as a bare
// <pre> (Chrome copying a raw .md file) or as code marked Markdown.
const isCode = (body: HTMLElement) => !body.querySelector('[class*="language-markdown"], [class*="language-md"]') && Boolean(body.querySelector("pre code, pre span"));

function toDom(markdown: string) {
  const html = micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
  const body = new DOMParser().parseFromString(html, "text/html").body;
  // GFM writes a to-do as a list item starting with a checkbox; TipTap's task list wants data-type.
  for (const box of body.querySelectorAll("li > input[type=checkbox], li > p:first-child > input[type=checkbox]")) {
    const item = box.closest("li")!;
    item.dataset.type = "taskItem";
    item.dataset.checked = String(box.hasAttribute("checked"));
    item.parentElement!.dataset.type = "taskList";
    box.remove();
  }
  // A fence's last line ends in a newline, which a code block would show as an empty line.
  for (const code of body.querySelectorAll("pre > code")) code.textContent = code.textContent.replace(/\n$/, "");
  // Each line stays its own paragraph, as in a plain-text paste; Markdown would join them.
  for (const p of body.querySelectorAll("p")) {
    const lines = p.innerHTML.split(/(?:<br>)?\n/);
    if (lines.length > 1) p.outerHTML = lines.filter((line) => line.trim()).map((line) => `<p>${line}</p>`).join("");
  }
  // An image is a block here; a paragraph around it would be left behind empty.
  for (const p of body.querySelectorAll("p")) if (!p.textContent.trim() && p.querySelector("img")) p.replaceWith(...p.childNodes);
  return body;
}

// Only a paragraph at either end joins the line it lands in, so a heading, a list or code never
// melts into the text around it.
function insert(view: EditorView, content: Fragment, tr = view.state.tr) {
  const open = (node: PMNode | null) => (node?.type.name === "paragraph" ? 1 : 0);
  tr.replaceSelection(new Slice(content, open(content.firstChild), open(content.lastChild)));
  // The cursor goes to the end of what went in (where the last step's insert ends). A divider or
  // image there would be selected, and typing would go nowhere, so it goes to a line after it.
  let at = 0;
  tr.mapping.maps[tr.mapping.maps.length - 1].forEach((_from, _to, _newFrom, newTo) => (at ||= newTo));
  const end = Selection.near(tr.doc.resolve(at), -1);
  if (end instanceof NodeSelection && tr.doc.resolve(end.to).nodeAfter?.type.name !== "paragraph") tr.insert(end.to, view.state.schema.nodes.paragraph.create());
  tr.setSelection(end instanceof NodeSelection ? TextSelection.create(tr.doc, end.to + 1) : end);
  view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
  return true;
}

// Markdown as formatted blocks, in place of the selection.
export const insertMarkdown = (view: EditorView, text: string, tr = view.state.tr) =>
  insert(view, SchemaParser.fromSchema(view.state.schema).parseSlice(toDom(text)).content, tr);

// Markdown shown as written (raw) goes in formatted on an empty page. On a page with words it stays
// a Markdown code block, which the block's "Turn into formatted text" can format later.
function pasteMarkdown(view: EditorView, text: string, raw: boolean) {
  const { doc, schema, selection } = view.state;
  // Selected table cells go through the table's own paste, which fills each of them.
  if (selection instanceof CellSelection) return view.pasteHTML(toDom(text).innerHTML);
  let empty = true;
  doc.descendants((node) => (empty &&= !node.isLeaf));
  if (raw && !empty) return insert(view, Fragment.from(schema.nodes.codeBlock.create({ language: "markdown" }, schema.text(text.trimEnd()))));
  return insertMarkdown(view, text);
}

// How a paste goes in; false leaves it to ProseMirror.
function paste(view: EditorView, text: string, html: string) {
  if (view.state.selection.$from.parent.type.spec.code || RICH.test(html)) return false;
  const pre = preformatted(html);
  if (pre && isCode(pre)) return insert(view, SchemaParser.fromSchema(view.state.schema).parseSlice(pre).content);
  if (isMarkdown(text)) return pasteMarkdown(view, text, Boolean(pre));
  // Plain text shown as written (a raw .txt file) goes in line by line, not as code.
  return pre ? view.pasteText(text) : false;
}

// Clipboard text and HTML in as a paste puts them (a page pasted into the title).
export const pasteText = (view: EditorView, text: string, html = "") =>
  paste(view, text, html) || (RICH.test(html) ? view.pasteHTML(html) : view.pasteText(text));

// A page pasted into the title: a heading on its first line names the page and the rest is its
// body. Code keeps its first line, even a "# comment".
export function splitTitle(text: string, html: string): { title?: string; body: string } {
  const [first, ...rest] = text.split(/\r?\n/);
  const pre = preformatted(html);
  if (!/^#{1,6}\s/.test(first) || (pre && isCode(pre))) return { body: text };
  return { title: toDom(first).textContent.trim(), body: rest.join("\n").trim() };
}

export const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  addProseMirrorPlugins: () => [
    new Plugin({
      key: new PluginKey("markdownPaste"),
      props: {
        handlePaste: (view, event) => paste(view, event.clipboardData?.getData("text/plain") ?? "", event.clipboardData?.getData("text/html") ?? ""),
      },
    }),
  ],
});
