import { useSyncExternalStore } from "react";
import { grammarLesson } from "./grammar-lessons";

const key = "ll.grammar.tips";
let saved: string[];
try { saved = JSON.parse(localStorage.getItem(key) ?? "[]").filter((rule: unknown) => typeof rule === "string" && grammarLesson(rule)); }
catch { saved = []; }
const listeners = new Set<() => void>();
export const useSavedTips = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => void listeners.delete(listener); }, () => saved);
export function saveGrammarTip(rule: string, keep: boolean) {
  const next = keep ? [...new Set([...saved, rule])].filter((id) => grammarLesson(id)) : saved.filter((id) => id !== rule);
  localStorage.setItem(key, JSON.stringify(next));
  saved = next;
  listeners.forEach((listener) => listener());
}
