// What goes with a question. Claude Code keeps a session's first system prompt and ignores
// a new one on resume, so the system prompt is fixed and everything that can change rides
// in the question itself: the note's text, mentioned notes and an agent's instructions,
// each only when the thread hasn't seen it that way yet.

export type Seen = Record<string, string>;
export type NoteText = { id: string; title: string; text: string };

export const SYSTEM = [
  "You help someone read and write their notes in LeadingLight, a notes app on their Mac. You sit beside one note, the page they asked from.",
  "The note comes with the first question as Markdown between dashed lines, and again whenever it has changed. Other notes they mention come the same way.",
  "When they quote a selection, the question is about those words, in the context of the note.",
  "When they ask for a change, make it with the notes tools: edit_page swaps exact words (the page's words, not its Markdown marks), insert_text adds blocks, write_page rewrites the whole page. Change only what was asked and keep their voice; then say in one sentence what you changed.",
  "search_pages and read_page find and read their other notes; create_page makes a new one. Your web search looks things up.",
  "Otherwise answer in Markdown, briefly, with no preamble and no closing offer.",
].join("\n");

export function buildPrompt(input: { seen: Seen; note: NoteText; pages: NoteText[]; agent: string | null; quote: string | null; question: string }): { prompt: string; seen: Seen } {
  const seen = { ...input.seen };
  const parts: string[] = [];
  const block = (label: string, text: string) => `${label}\n-----\n${text}\n-----`;
  const name = (n: NoteText) => `"${n.title || "Untitled"}"`;

  const note = input.note.text.slice(0, 20_000);
  if (seen.note !== note) {
    parts.push(block(seen.note === undefined ? `The note, ${name(input.note)}:` : `The note, ${name(input.note)}, as it is now:`, note));
    seen.note = note;
  }
  for (const p of input.pages) {
    const text = p.text.slice(0, 10_000);
    if (seen[`page:${p.id}`] !== text) {
      parts.push(block(`Another note, ${name(p)}:`, text));
      seen[`page:${p.id}`] = text;
    }
  }
  const agent = input.agent ?? "";
  if ((seen.agent ?? "") !== agent) {
    parts.push(agent ? `From now on, follow these instructions:\n${agent}` : "Drop the earlier instructions and answer as usual.");
    seen.agent = agent;
  }
  if (input.quote) parts.push(`> ${input.quote.replace(/\n/g, "\n> ")}`);
  parts.push(input.question);
  return { prompt: parts.join("\n\n"), seen };
}
