// Composes COSS's dialog, tabs, fields and buttons around one optional suggestion.
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@leadinglight/ui/components/tabs";
import { grammarLesson, type GrammarLesson } from "./grammar-lessons";
import { saveGrammarTip, useSavedTips } from "./grammar-learning";
import { addGrammarWord, applyGrammarIssue, collectGrammarIssues, grammarWords, isSpelling, keepGrammarIssue, onGrammarChange, removeGrammarWord, retryGrammarCheck, mapGrammarRange, type GrammarRange, type GrammarIssue } from "./grammar-review";

function Listen({ text }: { text: string }) {
  const [voice, setVoice] = useState<SpeechSynthesisVoice>();
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const speech = window.speechSynthesis;
    const voices = () => setVoice(speech.getVoices().find((item) => item.localService && /^en\b/i.test(item.lang)));
    voices();
    speech.addEventListener("voiceschanged", voices);
    return () => { speech.removeEventListener("voiceschanged", voices); speech.cancel(); };
  }, []);
  useEffect(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [text]);
  if (!voice) return <p className="text-xs text-muted-foreground">Listen needs a local English system voice.</p>;
  return <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => {
    window.speechSynthesis.cancel();
    if (speaking) { setSpeaking(false); return; }
    const speech = new SpeechSynthesisUtterance(text);
    speech.voice = voice;
    speech.rate = 0.9;
    speech.onend = speech.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(speech);
  }}><Volume2 className="size-4" />{speaking ? "Stop listening" : "Listen"}</Button>;
}

function Practice({ lesson }: { lesson: GrammarLesson }) {
  const [answer, setAnswer] = useState<number | null>(null);
  return <div className="grid gap-3 rounded-lg border p-3">
    <p className="text-sm font-medium">{lesson.practice.prompt}</p>
    <div className="flex flex-wrap gap-2">{lesson.practice.choices.map((choice, index) =>
      <Button key={choice} variant={answer === index ? "secondary" : "outline"} size="sm" onClick={() => setAnswer(index)}>{choice}</Button>)}</div>
    {answer !== null && <p role="status" className="text-sm leading-relaxed">{answer === lesson.practice.answer ? "Yes. " : "Here, "}{lesson.practice.explanation}</p>}
  </div>;
}

function Tip({ rule, onError }: { rule: string; onError: (message: string) => void }) {
  const lesson = grammarLesson(rule);
  const saved = useSavedTips();
  const [practice, setPractice] = useState(false);
  if (!lesson) return null;
  const kept = saved.includes(rule);
  return <div className="grid gap-3">
    <p className="text-sm leading-relaxed">{lesson.why}</p>
    <p className="text-sm text-muted-foreground">{lesson.example}</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => setPractice(!practice)}>{practice ? "Close practice" : "Try one"}</Button>
      <Button size="sm" variant="ghost" onClick={() => {
        try { saveGrammarTip(rule, !kept); }
        catch { onError("This tip could not be saved. Your writing is unchanged."); }
      }}>{kept ? "Remove saved tip" : "Save tip"}</Button>
    </div>
    {practice && <Practice lesson={lesson} />}
  </div>;
}

function Suggestion({ issue, apply, keep, remember, busy, onError, applied, next }: {
  applied?: string; next: () => void;
  issue: GrammarIssue; apply: (text: string) => void; keep: () => void; remember: () => void; busy: boolean; onError: (message: string) => void;
}) {
  const [replacement, setReplacement] = useState(applied ?? issue.suggestions[0] ?? "");
  const [why, setWhy] = useState(false);
  const at = issue.contextOffset;
  const start = Math.max(0, at - 70);
  const context = `${start ? "…" : ""}${issue.context.slice(start, Math.max(start + 180, at + issue.original.length))}${issue.context.length > Math.max(start + 180, at + issue.original.length) ? "…" : ""}`;
  const word = /^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*$/u.test(issue.original);
  return <div className="grid gap-4">
    {applied === undefined && <p className="text-sm text-muted-foreground leading-relaxed break-words">
      {start > 0 && "…"}{issue.context.slice(start, at)}<mark className="rounded bg-accent px-0.5 text-accent-foreground">{issue.original}</mark>{issue.context.slice(at + issue.original.length, Math.max(start + 180, at + issue.original.length))}{issue.context.length > Math.max(start + 180, at + issue.original.length) && "…"}
    </p>}
    <div className="grid gap-2 rounded-lg border p-4 text-base break-words">
      <p><span className="mb-1 block text-xs text-muted-foreground">Your words</span>{issue.original || "At this position"}</p>
      {issue.suggestions.length > 0 && <p><span className="mb-1 block text-xs text-muted-foreground">{applied === undefined ? "Suggested" : "Changed to"}</span>{(applied ?? replacement) || "Remove the extra text"}</p>}
    </div>
    {applied === undefined && issue.suggestions.length > 1 && <Field><FieldLabel>Suggestion</FieldLabel>
      <Select value={replacement} onValueChange={(value) => { if (value !== null) setReplacement(value); }} items={issue.suggestions.map((text) => ({ value: text, label: text || "Remove" }))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectPopup>{issue.suggestions.map((text) => <SelectItem key={text} value={text}>{text || "Remove"}</SelectItem>)}</SelectPopup>
      </Select></Field>}
    <div className="flex flex-wrap gap-2">
      {applied === undefined && issue.suggestions.length > 0 && <Button data-grammar-step disabled={busy} onClick={() => apply(replacement)}>Apply</Button>}
      {applied === undefined ? <Button data-grammar-step disabled={busy} variant="outline" onClick={keep}>Keep this wording</Button> : <Button data-grammar-step onClick={next}>Next suggestion</Button>}
      <Button variant="ghost" aria-expanded={why} onClick={() => setWhy(!why)}>{why ? "Hide explanation" : "Why?"}</Button>
    </div>
    {why && <div className="grid gap-3 border-t pt-4">
      <p className="text-sm font-medium">{issue.lesson?.title ?? "About this suggestion"}</p>
      {issue.lesson ? <Tip rule={issue.rule} onError={onError} /> : <p className="text-sm leading-relaxed">{issue.message}</p>}
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      {applied === undefined && isSpelling(issue.kind) && word && <Button data-grammar-step size="sm" variant="ghost" disabled={busy} onClick={remember}>Remember word</Button>}
      <Listen text={`${applied === undefined ? `${context}. Suggested: ${replacement || "remove the extra text"}.` : applied ? `Changed “${issue.original}” to “${applied}”.` : `Removed “${issue.original}”.`} ${why ? issue.lesson?.why ?? issue.message : ""}`} />
    </div>
  </div>;
}

export function GrammarCoach({ editor, at, scope, onClose }: { editor: Editor; at?: number; scope?: GrammarRange; onClose: () => void }) {
  const range = useRef(scope);
  const undoRange = useRef<GrammarRange | undefined>(undefined);
  const [review, setReview] = useState(() => collectGrammarIssues(editor, range.current));
  const [applied, setApplied] = useState<{ issue: GrammarIssue; replacement: string } | null>(null);
  const [tab, setTab] = useState("review");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [undoDoc, setUndoDoc] = useState<typeof editor.state.doc | null>(null);
  const saved = useSavedTips();
  const preferred = useRef(at);
  const shownId = useRef<string | undefined>(undefined);
  const lastStep = useRef<{ x: number; y: number; at: number } | null>(null);
  const refresh = () => { if (!editor.isDestroyed) setReview(collectGrammarIssues(editor, range.current)); };
  useEffect(() => {
    const off = onGrammarChange(refresh);
    const changed = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return;
      shownId.current = undefined; preferred.current = undefined;
      if (range.current) range.current = mapGrammarRange(range.current, transaction);
      refresh();
    };
    editor.on("transaction", changed);
    return () => { off(); editor.off("transaction", changed); };
  }, [editor]);
  const pinned = review.issues.find((item) => item.id === shownId.current);
  const issue = applied?.issue ?? pinned ?? (shownId.current && review.pending ? undefined :
    review.issues.find((item) => preferred.current !== undefined && item.from <= preferred.current && item.to >= preferred.current) ?? review.issues[0]);
  useLayoutEffect(() => { if (!applied && issue) shownId.current = issue.id; }, [applied, issue]);
  const stale = () => { setError("The words changed. Review the updated suggestion."); refresh(); };
  const words = grammarWords();
  const changeWord = async (word: string, add: boolean) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      await (add ? addGrammarWord(word) : removeGrammarWord(word));
      shownId.current = undefined;
      setMessage(add ? `Remembered “${word}” on this device.` : `“${word}” will be checked again.`);
      refresh();
    } catch { setError("The word list could not be saved. Please try again."); }
    finally { locked.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPopup onClickCapture={(event) => {
      if (!event.detail) { lastStep.current = null; return; }
      const previous = lastStep.current;
      const now = performance.now();
      // A moving card must not turn a double-click into an unrelated action.
      if (previous && now - previous.at < 500 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 8) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      lastStep.current = (event.target as HTMLElement).closest("[data-grammar-step]") ? { x: event.clientX, y: event.clientY, at: now } : null;
    }} finalFocus={() => { if (!editor.isDestroyed) editor.view.focus(); return false; }}>
      <DialogHeader>
        <DialogTitle>Review writing</DialogTitle>
        <DialogDescription>{scope ? "Selected text" : "Whole page"}. One suggestion at a time.</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList className="mb-3" aria-label="Writing help"><TabsTab value="review">Review</TabsTab><TabsTab value="tips">Saved tips</TabsTab><TabsTab value="words">My words</TabsTab></TabsList>
          <TabsPanel value="review">
            {review.error && !applied ? <div className="grid gap-3"><p role="alert" className="text-sm">The local checker could not finish. Your words are unchanged.</p><Button variant="outline" onClick={() => { shownId.current = undefined; retryGrammarCheck(); refresh(); }}>Retry</Button></div>
              : issue ? <Suggestion key={`${issue.id}:${issue.original}:${issue.suggestions.join("|")}`} issue={issue} applied={applied?.replacement} next={() => { shownId.current = undefined; setApplied(null); setUndoDoc(null); setMessage(""); refresh(); }} busy={busy} onError={setError}
                apply={(replacement) => {
                  setError("");
                  const before = range.current;
                  if (!applyGrammarIssue(editor, issue, replacement)) return stale();
                  undoRange.current = before;
                  setApplied({ issue, replacement });
                  preferred.current = undefined;
                  setUndoDoc(editor.state.doc);
                  setMessage("Change applied. You can stop here.");
                  refresh();
                }} keep={() => {
                  setError("");
                  if (!keepGrammarIssue(editor, issue)) return stale();
                  shownId.current = undefined;
                  preferred.current = undefined;
                  setMessage("Kept your wording for this review."); refresh();
                }} remember={() => void changeWord(issue.original, true)} />
              : <p role="status" className="py-6 text-sm text-muted-foreground">{review.pending ? "Checking on this device…" : "No suggestions from this check. You can keep writing."}</p>}
          </TabsPanel>
          <TabsPanel value="tips" className="grid gap-5">
            {saved.length === 0 && <p className="py-4 text-sm text-muted-foreground">Save a tip from “Why?” to return to it here.</p>}
            {saved.map((rule) => <div key={rule} className="grid gap-3 rounded-lg border p-4"><h3 className="text-sm font-medium">{grammarLesson(rule)?.title}</h3><Tip rule={rule} onError={setError} /><Listen text={`${grammarLesson(rule)?.why} ${grammarLesson(rule)?.example}`} /></div>)}
          </TabsPanel>
          <TabsPanel value="words" className="grid gap-3">
            <p className="text-sm text-muted-foreground">Words you chose to keep. Saved on this device.</p>
            {words.length === 0 && <p className="py-3 text-sm">Use “Remember word” on a spelling suggestion.</p>}
            {words.map((word) => <div key={word} className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 break-words text-sm">{word}</span><Button disabled={busy} size="sm" variant="ghost" aria-label={`Remove ${word}`} onClick={() => void changeWord(word, false)}>Remove</Button></div>)}
          </TabsPanel>
        </Tabs>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </DialogPanel>
      <DialogFooter className="flex-col sm:flex-col">
        {message && <div className="flex flex-wrap items-center gap-2"><p role="status" className="text-sm text-muted-foreground">{message}</p>{undoDoc === editor.state.doc && <Button data-grammar-step size="sm" variant="ghost" onClick={() => { editor.commands.undo(); range.current = undoRange.current; shownId.current = applied?.issue.id; setApplied(null); setUndoDoc(null); setMessage("Restored your words."); refresh(); }}>Undo</Button>}</div>}
        <DialogClose render={<Button className="sm:self-end" variant="outline" />}>Done for now</DialogClose>
      </DialogFooter>
    </DialogPopup>
  </Dialog>;
}
