// A table artifact's rows, from CSV, TSV or a JSON array of objects. Text
// only: cells are drawn as text, never as HTML.

export interface TableData {
  head: string[];
  rows: string[][];
  // The column whose values say pass/fail/skip, if any.
  status: number;
}

const STATUS = /^(status|result|outcome|state)$/i;

export function parseTable(body: string, format: string): TableData {
  let head: string[] = [];
  let rows: string[][] = [];
  if (format === "json") {
    try {
      const list = JSON.parse(body) as Record<string, unknown>[];
      if (Array.isArray(list)) {
        for (const r of list) for (const k of Object.keys(r ?? {})) if (!head.includes(k)) head.push(k);
        rows = list.map((r) => head.map((k) => cell(r?.[k])));
      }
    } catch {
      // nothing to show
    }
  } else {
    const all = parseDelimited(body, format === "tsv" ? "\t" : ",");
    head = all[0] ?? [];
    rows = all.slice(1).filter((r) => r.some((c) => c !== ""));
  }
  return { head, rows, status: head.findIndex((h) => STATUS.test(h.trim())) };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

// parseDelimited reads CSV (RFC 4180: quoted fields, doubled quotes,
// newlines in quotes) or TSV.
export function parseDelimited(text: string, sep: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += ch;
      continue;
    }
    if (ch === '"' && f === "") q = true;
    else if (ch === sep) {
      row.push(f);
      f = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(f);
      out.push(row);
      row = [];
      f = "";
    } else f += ch;
  }
  if (f !== "" || row.length) {
    row.push(f);
    out.push(row);
  }
  return out;
}

export type Verdict = "pass" | "fail" | "skip" | undefined;

export function verdict(v: string): Verdict {
  const s = v.trim().toLowerCase();
  if (/^(pass|passed|ok|success|green|✓)$/.test(s)) return "pass";
  if (/^(fail|failed|failure|error|errored|broken|red|✗)$/.test(s)) return "fail";
  if (/^(skip|skipped|pending|todo|xfail)$/.test(s)) return "skip";
  return undefined;
}
