import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { grammarError, onMistakes, type Mistake } from "./grammar";
import { grammarLesson, type GrammarLesson } from "./grammar-lessons";
import { grammarMistakes, grammarText, keepGrammarOccurrence } from "./grammar-prose";
import { writingKey } from "./writing";

export { addGrammarWord, grammarWords, removeGrammarWord, retryGrammarCheck, isSpelling } from "./grammar";
export const onGrammarChange = onMistakes;
export type GrammarIssue = Mistake & { id: string; original: string; context: string; contextOffset: number; lesson?: GrammarLesson };
export type GrammarReview = { issues: GrammarIssue[]; pending: boolean; error: string | null };
export type GrammarRange = { from: number; to: number };
const snapshots = new WeakMap<GrammarIssue, PMNode>();
const correctionKey = "grammarReviewCorrection";

export function mapGrammarRange(range: GrammarRange, transaction: Transaction): GrammarRange {
  let { from, to } = range;
  const correction = transaction.getMeta(correctionKey) === true;
  for (const map of transaction.mapping.maps) {
    if (from >= to) { from = to = map.map(from, 1); continue; }
    from = map.map(from, correction ? -1 : 1);
    to = map.map(to, correction ? 1 : -1);
    if (from > to) to = from;
  }
  const size = transaction.doc.content.size;
  return { from: Math.max(0, Math.min(from, size)), to: Math.max(0, Math.min(to, size)) };
}

export function collectGrammarIssues(editor: Editor, scope?: GrammarRange): GrammarReview {
  const result: GrammarReview = { issues: [], pending: false, error: null };
  if (editor.isDestroyed || !editor.isEditable) return result;
  const doc = editor.state.doc;
  if (scope && (!Number.isInteger(scope.from) || !Number.isInteger(scope.to) || scope.from >= scope.to || scope.to <= 0 || scope.from >= doc.content.size)) return result;
  const visit = (block: PMNode, pos: number) => {
    if (!block.isTextblock) return true;
    if (block.type.spec.code) return false;
    if (scope && (pos + 1 >= scope.to || pos + 1 + block.content.size <= scope.from)) return false;
    const { text } = grammarText(block);
    const mistakes = grammarMistakes(block, pos, doc);
    if (!mistakes) result.pending = true;
    result.error ??= grammarError(text);
    for (const mistake of mistakes ?? []) {
      const from = pos + 1 + mistake.from;
      const to = pos + 1 + mistake.to;
      if (scope && (from < scope.from || to > scope.to)) continue;
      const issue: GrammarIssue = { ...mistake, id: `${from}:${to}:${mistake.rule}`, from, to,
        original: text.slice(mistake.from, mistake.to), context: text, contextOffset: mistake.from,
        lesson: grammarLesson(mistake.rule),
      };
      snapshots.set(issue, doc);
      result.issues.push(issue);
    }
    return false;
  };
  if (scope) doc.nodesBetween(Math.max(0, scope.from), Math.min(scope.to, doc.content.size), visit);
  else doc.descendants(visit);
  return result;
}

export function grammarIssueIsCurrent(editor: Editor, issue: GrammarIssue) {
  return !editor.isDestroyed && editor.isEditable && snapshots.get(issue) === editor.state.doc;
}

export function applyGrammarIssue(editor: Editor, issue: GrammarIssue, replacement: string): boolean {
  if (!grammarIssueIsCurrent(editor, issue) || !issue.suggestions.includes(replacement) || replacement === issue.original) return false;
  let start = 0;
  let end = issue.original.length;
  let replacementEnd = replacement.length;
  // Keep unchanged letters and their marks, even when a correction spans differently styled words.
  while (start < end && start < replacementEnd && issue.original[start] === replacement[start]) start++;
  while (end > start && replacementEnd > start && issue.original[end - 1] === replacement[replacementEnd - 1]) { end--; replacementEnd--; }
  const from = issue.from + start;
  const to = issue.from + end;
  const text = replacement.slice(start, replacementEnd);
  const { doc, schema } = editor.state;
  const marks = doc.resolve(from).marksAcross(doc.resolve(to)) ?? doc.resolve(from).marks();
  const tr = closeHistory(editor.state.tr).setMeta(correctionKey, true);
  if (text) tr.replaceWith(from, to, schema.text(text, marks));
  else tr.delete(from, to);
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}

export function keepGrammarIssue(editor: Editor, issue: GrammarIssue): boolean {
  if (!grammarIssueIsCurrent(editor, issue)) return false;
  keepGrammarOccurrence(editor.state.doc, issue.from, issue.to, issue.rule);
  editor.view.dispatch(editor.state.tr.setMeta(writingKey, "rebuild"));
  return true;
}
