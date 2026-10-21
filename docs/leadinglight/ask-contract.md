# Ask LeadingLight: the answer reply (Adapt contract amendment 5)

Ask LeadingLight reuses the Adapt transport (`src/leadinglight/adapt/adaptContract.ts`, mirrored natively in
`src-tauri/src/leadinglight_adapt/`). Amendment 5 adds one reply kind, `answer`, so the assistant can
answer about text the person attached as well as propose extensions. No command, argument, provider,
sign-in, control or storage format changes. How the assistant is told to answer is in
[ask-guide.md](ask-guide.md).

**Status.** The contract, both readers and their tests are implemented. Showing answers (inert
rendering, Copy, resuming a conversation from a page) is the interface's part and is not described here
as done. No live provider behaviour is qualified by these tests: they use synthetic final answers only.

## The reply

```ts
type AdaptReply =
  | { kind: 'candidate'; message: string; packageText: string }
  | { kind: 'question'; message: string; choices: string[] }
  | { kind: 'unsupported'; message: string; alternative: string | null }
  | { kind: 'answer'; message: string; answer: string }
```

| Field | Rule |
|---|---|
| `message` | As for every kind: plain prose, at most 600 UTF-16 units, not blank, tab and newline as the only control characters. One short sentence introducing the answer. |
| `answer` | The answer as Markdown text. At most 16 KiB (16,384 bytes) of UTF-8. It must not be blank. Well-formed Unicode, no NUL, and no control character except tab and newline: no carriage return, C1 controls, line or paragraph separators, or direction overrides and isolates. |

`answer` is untrusted text. LeadingLight never interprets it as anything but text to show and copy:

- it is not run;
- it is not fetched from or followed;
- it is not saved to a note automatically, only kept in the conversation's local record like every
  reply;
- it is not acted on.

An interface shows it only through an inert renderer: no HTML, no image or other loads, and links
are not followed. HTML, wikilinks or internal markers inside it stay characters. Writing an answer into
a note is a separate, later, host-made step with its own safe-text checks.

## The provider's final text

The provider must answer with exactly one JSON object matching this schema, which is strict, so
every property is required:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["kind", "message", "packageText", "choices", "alternative", "answer"],
  "properties": {
    "kind": { "type": "string", "enum": ["candidate", "question", "unsupported", "answer"] },
    "message": { "type": "string" },
    "packageText": { "type": ["string", "null"] },
    "choices": { "type": "array", "items": { "type": "string" } },
    "alternative": { "type": ["string", "null"] },
    "answer": { "type": ["string", "null"] }
  }
}
```

It is read strictly and never repaired. Native `prompt::read_answer` and TypeScript `readAdaptAnswer`
read every case in `src/leadinglight/adapt/fixtures/answer-cases.json` identically.

- **Shape.** The text must be one JSON object, not an array, with nothing before or after it except
  JSON whitespace.
- **Keys.** No key may be unknown or repeated, including keys that only repeat once escapes are
  decoded. `kind`, `message` and `choices` are required. A missing `packageText`, `alternative` or
  `answer` is read as `null`, as before amendment 5, so older final texts read unchanged.
- **Strings.** A string holding a lone surrogate is not text, and is refused as the text is read. NUL
  and the other character rules are checked later, with the bounds.
- **Fields by kind.** Each kind carries only its own fields:

  | `kind` | `packageText` | `choices` | `alternative` | `answer` |
  |---|---|---|---|---|
  | `candidate` | text | `[]` | `null` | `null` |
  | `question` | `null` | up to 3 | `null` | `null` |
  | `unsupported` | `null` | `[]` | text or `null` | `null` |
  | `answer` | `null` | `[]` | `null` | text |

- **Bounds.** A reply over a bound is recorded as the failure `outputTooLarge`; any other breach is
  `invalidOutput`. The message is checked first, then the kind's own fields, each for its bound before
  its characters: an answer over 16 KiB that also holds a NUL is `outputTooLarge`. Nothing is shown
  from a failed reply, and nothing is retried.

## What is sent

Every Send carries, in its instructions:

1. LeadingLight's host instructions;
2. the Ask guide;
3. the extension guide (`extensions-catalog.md`), unchanged.

The person's request, the attachment texts they chose and the earlier turns they named travel as one
JSON document in the message, as before. No vault path or note identity is added; attachment labels
are the titles the person sees.

An earlier turn the person includes is resent whole: its request and its reply, an answer as
`{ "kind": "answer", "message", "answer" }`. Each included turn counts its request plus its reply's
UTF-8 bytes against the 512 KiB payload bound. For an answer that is the message plus the answer;
the other kinds count their own fields. Over the bound, the Send is refused `tooLarge` and nothing is
sent. `adaptPayloadBytes` lets an interface say so before sending; native decides.

Each stored request records the instructions it went with as `guide-` followed by 12 hexadecimal digits
of the SHA-256 of the complete instructions text, so it fingerprints the host text and both guides.
Requests stored by earlier versions keep their `extensions-guide-…` value.

## Stored conversations

The record format stays 1:

- conversations saved before amendment 5 read exactly as before;
- a stored answer is read with the same rules as a fresh one;
- a stored reply that breaks a rule leaves its record unread and untouched, never rewritten or deleted.

**Limitation.** An earlier version of LeadingLight cannot read a conversation that contains an answer.
By its existing rule it leaves that record in place and does not list it.
