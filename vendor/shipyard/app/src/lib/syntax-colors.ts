// The File tab's code colours from the same Shiki theme the diff view
// (@pierre/diffs) colours with, so a file in the editor and in Compare
// look alike in every app theme. The editor parses with Lezer, Shiki with
// TextMate grammars: each Lezer role below names the TextMate scopes Shiki
// gives the same tokens, most specific first, and takes the colour the
// theme's rules give the first of them any rule matches. Pure, so node's
// test runner reads it (syntax-colors.test.ts).

import { readable } from "../themes/color.ts";

export interface ThemeRule {
  scope?: string | string[];
  settings?: { foreground?: string; fontStyle?: string };
}

export interface ShikiTheme {
  fg?: string;
  bg?: string;
  type?: string;
  settings?: ThemeRule[];
  tokenColors?: ThemeRule[];
  colorReplacements?: Record<string, string>;
}

export interface Style {
  color?: string;
  italic?: boolean;
  bold?: boolean;
}

// Each role and the scopes Shiki gives its tokens (TypeScript, JSON, CSS,
// Markdown, YAML, Go, Python, Rust, SQL, HTML), most specific first.
export const ROLES: Record<string, string[]> = {
  keyword: ["keyword.control", "keyword", "storage.type"],
  control: ["keyword.control.flow", "keyword.control.conditional", "keyword.control", "keyword"],
  module: ["keyword.control.import", "keyword.control.export", "keyword.control", "keyword"],
  definition: ["storage.type", "keyword"],
  modifier: ["storage.modifier", "storage.type", "keyword"],
  operatorWord: ["keyword.operator.new", "keyword.operator.expression", "keyword.operator", "keyword"],
  string: ["string.quoted", "string"],
  template: ["string.template", "string"],
  regexp: ["string.regexp", "string"],
  escape: ["constant.character.escape", "string"],
  comment: ["comment.line", "comment.block", "comment"],
  function: ["entity.name.function", "support.function", "meta.function-call"],
  type: ["entity.name.type", "support.type", "support.class", "entity.name.class"],
  className: ["entity.name.type.class", "entity.name.class", "entity.name.type"],
  namespace: ["entity.name.type.module", "entity.name.namespace", "entity.name.type"],
  number: ["constant.numeric", "constant"],
  bool: ["constant.language.boolean", "constant.language", "constant"],
  null: ["constant.language.null", "constant.language", "constant"],
  property: ["variable.other.property", "variable.other.object.property", "support.variable.property", "variable.other", "variable"],
  key: ["meta.object-literal.key", "support.type.property-name", "variable.other.property", "variable"],
  variable: ["variable.other.readwrite", "variable.other", "variable"],
  constant: ["variable.other.constant", "variable.other.readwrite", "variable"],
  self: ["variable.language.this", "variable.language"],
  tag: ["entity.name.tag"],
  attribute: ["entity.other.attribute-name"],
  operator: ["keyword.operator.assignment", "keyword.operator"],
  punctuation: ["punctuation.separator", "punctuation"],
  bracket: ["meta.brace", "punctuation.definition.block", "punctuation"],
  heading: ["markup.heading", "entity.name.section"],
  emphasis: ["markup.italic"],
  strong: ["markup.bold"],
  link: ["markup.underline.link", "string.other.link"],
  quote: ["markup.quote"],
  code: ["markup.inline.raw", "markup.raw"],
  invalid: ["invalid.illegal", "invalid"],
  meta: ["meta.decorator", "entity.name.function.decorator", "punctuation.decorator"],
};

// A rule's simple selectors: those with a parent scope ("a b") or an
// exclusion only apply in a context the editor doesn't know, so they are
// left out.
function selectors(scope: string | string[] | undefined): string[] {
  if (!scope) return [];
  const all = Array.isArray(scope) ? scope : scope.split(",");
  return all.map((s) => s.trim()).filter((s) => s && !/\s/.test(s));
}

const matches = (sel: string, target: string) => target === sel || target.startsWith(`${sel}.`);

// styleFor is the style the theme's rules give target: the most specific
// selector that matches (the later rule on a tie), its colour and its font
// style each taken from the best rule that sets it. Undefined when none
// matches.
export function styleFor(theme: ShikiTheme, target: string): Style | undefined {
  const rules = theme.settings ?? theme.tokenColors ?? [];
  let color: { spec: number; v: string } | undefined;
  let font: { spec: number; v: string } | undefined;
  rules.forEach((r) => {
    for (const sel of selectors(r.scope)) {
      if (!matches(sel, target)) continue;
      const spec = sel.split(".").length;
      const fg = r.settings?.foreground;
      const fs = r.settings?.fontStyle;
      if (fg && (!color || spec >= color.spec)) color = { spec, v: fg };
      if (fs !== undefined && (!font || spec >= font.spec)) font = { spec, v: fs };
    }
  });
  if (!color && !font) return undefined;
  const rep = theme.colorReplacements ?? {};
  const c = color?.v;
  return { color: c ? (rep[c.toLowerCase()] ?? rep[c] ?? c) : undefined, italic: !!font?.v.includes("italic"), bold: !!font?.v.includes("bold") };
}

// syntaxColors is every role's style in theme: the first of its scopes any
// rule matches. A role nothing matches is plain text (the theme's fg).
export function syntaxColors(theme: ShikiTheme): Record<string, Style> {
  const out: Record<string, Style> = {};
  const fg = theme.fg ?? styleFor(theme, "source")?.color ?? (theme.settings ?? theme.tokenColors ?? []).find((r) => !r.scope)?.settings?.foreground;
  for (const [role, scopes] of Object.entries(ROLES)) {
    let s: Style | undefined;
    for (const sc of scopes) {
      s = styleFor(theme, sc);
      if (s?.color) break;
    }
    out[role] = { color: s?.color ?? fg, italic: s?.italic, bold: s?.bold };
  }
  out.text = { color: fg };
  return out;
}

// cssVars turns the styles into the editor's custom properties
// (--syn-<role>, --syn-<role>-i for italic, --syn-<role>-b for bold).
// readableStyles is every role's colour at 4.5:1 on the code's background
// at least, moved in lightness only: a theme's soft comments and light
// strings keep their hue and read (WCAG AA). The same colours as the
// diffs, a shade darker or lighter where those fall short.
export function readableStyles(styles: Record<string, Style>, bg: string, min = 4.5): Record<string, Style> {
  return Object.fromEntries(Object.entries(styles).map(([role, s]) => [role, s.color ? { ...s, color: readable(s.color, bg, min) } : s]));
}

// readableTokens does the same to highlighted HTML from the diff renderer,
// whose spans carry their colours as --diffs-token-dark and -light.
export function readableTokens(html: string, bg: string, min = 4.5): string {
  const seen = new Map<string, string>();
  return html.replace(/(--diffs-token-(?:dark|light):)(#[0-9a-fA-F]{6,8})/g, (_, k: string, c: string) => {
    let r = seen.get(c);
    if (!r) seen.set(c, (r = readable(c, bg, min)));
    return k + r;
  });
}

export function cssVars(styles: Record<string, Style>): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [role, s] of Object.entries(styles)) {
    if (s.color) vars[`--syn-${role}`] = s.color;
    vars[`--syn-${role}-i`] = s.italic ? "italic" : "normal";
    vars[`--syn-${role}-b`] = s.bold ? "600" : "inherit";
  }
  return vars;
}
