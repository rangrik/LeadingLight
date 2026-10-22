// Fails when an element carries the HTML title attribute where it is the
// only way to learn something.
//
// A title tooltip shows late, in the operating system's style, and never
// for keyboard users; the app's own tooltip (components/tip.tsx, or coss
// Tooltip in plugins) shows on hover and on focus alike. So:
//
//   - Buttons, links, inputs, menu items and anything clickable or
//     focusable never carry a title.
//   - Nor does anything that is not plain text: an icon, a status dot, a
//     badge or chip with an icon in it, a bar segment. What its title says
//     is the meaning of the mark, and belongs in a Tip (and an aria-label).
//
// A title on plain, truncated text (a path in a <code className="truncate">,
// a clamped description) is left alone: it is a fallback for reading the
// whole text, which is on the page already. So is an <iframe>'s, which is
// its accessible name.
//
// Component props named title (<SettingsGroup title=…>, <DialogTitle>) are
// not attributes and are not checked: only lower-case elements and the UI
// kit's interactive components below are.
//
//   node scripts/check-titles.mjs     check app/src and the built-in plugins
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const app = resolve(import.meta.dirname, "..");
const roots = [join(app, "src"), resolve(app, "..", "plugins")];

// Elements that are interactive by themselves.
const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary", "details", "label", "option"]);
// The UI kit's components that render one of those, or take focus.
const INTERACTIVE_COMPONENTS = new Set([
  "Button",
  "Input",
  "InputGroupInput",
  "Textarea",
  "Toggle",
  "ToggleGroupItem",
  "TabsTab",
  "Checkbox",
  "Switch",
  "MenuItem",
  "MenuCheckboxItem",
  "MenuRadioItem",
  "MenuSubTrigger",
  "MenuTrigger",
  "ContextMenuItem",
  "SidebarMenuButton",
  "SidebarMenuSubButton",
  "SidebarMenuAction",
  "PopoverTrigger",
  "DialogTrigger",
  "SelectTrigger",
  "FilterChip",
]);
// Attributes that make any element interactive.
const INTERACTIVE_ATTRS = new Set(["onClick", "onDoubleClick", "onKeyDown", "href", "tabIndex"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch"]);

// Files that may still carry a title where it means something, with why.
// Keep it empty unless there is no way round it, and take a file out once
// it is fixed.
const ALLOW = new Map([
  // StateGlyph's state title: due a Tip and an aria-label, in the change
  // that reworks the glyph (state colours, reduced motion).
]);

async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.name.endsWith(".tsx")) yield p;
  }
}

const attrName = (a) => (ts.isJsxAttribute(a) ? a.name.getText() : undefined);

function interactive(node) {
  const tag = node.tagName.getText();
  if (INTERACTIVE_TAGS.has(tag) || INTERACTIVE_COMPONENTS.has(tag)) return true;
  // A component's other props are its own business: title may be a heading.
  if (!/^[a-z]/.test(tag)) return false;
  for (const a of node.attributes.properties) {
    const name = attrName(a);
    if (!name) continue;
    if (INTERACTIVE_ATTRS.has(name)) return true;
    if (name === "role" && a.initializer && ts.isStringLiteral(a.initializer) && INTERACTIVE_ROLES.has(a.initializer.text)) return true;
  }
  return false;
}

// Plain truncated text: a class that cuts it short (truncate, line-clamp),
// and nothing inside but text and expressions without markup.
const TRUNCATING = /\b(truncate|line-clamp-\d+|text-ellipsis)\b/;
const NAMED_BY_TITLE = new Set(["iframe"]);

const hasJsx = (node) => {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true;
    else ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
};

function plainTruncatedText(node) {
  if (NAMED_BY_TITLE.has(node.tagName.getText())) return true;
  if (!ts.isJsxOpeningElement(node)) return false;
  const cls = node.attributes.properties.find((a) => attrName(a) === "className");
  const text = cls?.initializer ? cls.initializer.getText() : "";
  if (!TRUNCATING.test(text)) return false;
  const children = node.parent.children;
  if (!children.some((c) => !ts.isJsxText(c) || c.text.trim())) return false;
  return children.every((c) => ts.isJsxText(c) || (ts.isJsxExpression(c) && (!c.expression || !hasJsx(c.expression))));
}

const problems = [];
for (const root of roots) {
  for await (const file of files(root)) {
    const rel = relative(app, file);
    if (ALLOW.has(rel)) continue;
    const text = await readFile(file, "utf8");
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.attributes.properties.some((a) => attrName(a) === "title")) {
        const tag = node.tagName.getText();
        const why = interactive(node) ? "interactive" : /^[a-z]/.test(tag) && !plainTruncatedText(node) ? "not plain truncated text" : undefined;
        if (why) {
          const { line } = src.getLineAndCharacterOfPosition(node.getStart());
          problems.push(`${rel}:${line + 1}  <${tag} title=…>  (${why})`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
}

if (problems.length) {
  console.error(`title= where it carries meaning; use <Tip label=…> (components/tip.tsx) or Tooltip instead, with an aria-label on a mark:\n\n  ${problems.join("\n  ")}\n`);
  process.exit(1);
}
console.log("check-titles: title= only on plain truncated text");
