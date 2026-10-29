import type { Node as PMNode } from "@tiptap/pm/model";
import type { Mapping } from "@tiptap/pm/transform";
import { mistakesIn } from "./grammar";

const texts = new WeakMap<PMNode, { text: string; blanks: [number, number][] }>();
type Kept = { from: number; to: number; rule: string; text: string };
const kept = new WeakMap<PMNode, Kept[]>();

export function grammarText(block: PMNode) {
  const cached = texts.get(block);
  if (cached) return cached;
  let text = "";
  const blanks: [number, number][] = [];
  block.forEach((child) => {
    const blank = child.isText ? child.marks.some((m) => m.type.name === "code" || m.type.name === "cited") : child.type.name !== "hardBreak";
    if (blank) blanks.push([text.length, text.length + child.nodeSize]);
    text += blank ? " ".repeat(child.nodeSize) : child.isText ? child.text : "\n";
  });
  const result = { text, blanks };
  texts.set(block, result);
  return result;
}

export function grammarMistakes(block: PMNode, pos: number, doc: PMNode) {
  if (block.type.spec.code) return [];
  const { text, blanks } = grammarText(block);
  return mistakesIn(text)?.filter((m) => !kept.get(doc)?.some((k) => k.from === pos + 1 + m.from && k.to === pos + 1 + m.to && k.rule === m.rule) && !blanks.some(([from, to]) => m.from < to && m.to > from));
}

export function keepGrammarOccurrence(doc: PMNode, from: number, to: number, rule: string) {
  const choices = kept.get(doc) ?? [];
  kept.set(doc, [...choices, { from, to, rule, text: doc.textBetween(from, to) }]);
}

export function mapGrammarKept(before: PMNode, after: PMNode, mapping: Mapping) {
  const choices = kept.get(before);
  if (!choices?.length) return;
  kept.set(after, choices.flatMap((choice) => {
    const from = mapping.mapResult(choice.from, 1);
    const to = mapping.mapResult(choice.to, -1);
    if (from.deleted || to.deleted || from.pos >= to.pos || after.textBetween(from.pos, to.pos) !== choice.text) return [];
    return [{ ...choice, from: from.pos, to: to.pos }];
  }));
}
