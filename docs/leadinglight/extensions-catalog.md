# Extensions catalog: package format 1

An extension is one JSON document. It describes questions to ask, where the result goes and how
the resulting note is laid out. LeadingLight reads the description, shows its own form, preview and
buttons, and performs every effect itself. A package never contains or runs code.

This is the reference for anyone writing a package by hand or with an assistant. The source of truth
is `src/leadinglight/extensions/extensionContract.ts`. Shared examples and conformance cases are in
`src/leadinglight/extensions/fixtures/`.

## What recipes can and cannot do

A recipe can ask a few questions, capture the passage you selected or a web page you enter and fetch,
pick a destination you choose, lay out headings, paragraphs, quotes and lists from literal text and
your answers, propose one note to create or add to, and open it afterwards. A different package with
the same steps is a materially different workflow, with no app rebuild.

Recipes cannot:

- **Shape text.** No splitting answers into lines, checklists from lines, find and replace, dates,
  counters, conditions other than "only if this answer is filled", or loops.
- **Arrange the workspace.** No opening particular pages in panes, layouts or other app commands.
- Run scripts, expressions, regular expressions or templates; include raw Markdown, HTML, CSS, images
  or front matter; name files or folders; read notes you did not choose; contact the network or an
  AI provider; start in the background. A website recipe does not contact the network either: it
  names no address, and only LeadingLight fetches the one page the person enters, when they choose
  Fetch (see "Saving a web page").

When a request needs one of these, say so and offer the nearest recipe instead.

## Package

```json
{
  "schema": "leadinglight.extension/1",
  "id": "local.meeting-debrief",
  "version": "1.0.0",
  "name": "Meeting debrief",
  "description": "Answer a few questions after a meeting and create a structured note in a folder you choose.",
  "capabilities": ["document.create", "document.open"],
  "commands": [ ... ]
}
```

| Field | Rule |
|---|---|
| `schema` | Exactly `"leadinglight.extension/1"`. Any other value is refused before anything else is read. |
| `id` | Two or more dot-separated parts of lowercase letters, digits and hyphens, at most 64 characters. `leadinglight.` is reserved for bundled packages. |
| `version` | `MAJOR.MINOR.PATCH`, digits only. |
| `name`, `description` | One line of plain text each. |
| `capabilities` | Exactly the capabilities the commands use (below), each listed once. |
| `commands` | 1 to 8 commands, each with a unique `id`. |

Ids (`command`, `step`, `field`, `option`) start with a lowercase letter and use only letters, digits and
hyphens, at most 40 characters.

A command is `{ "id", "title", "steps" }`. `title` is the command's name in menus and its dialog.
A command that captures a passage is offered for a selection; a command that saves a web page opens
with an address field; every command is also in the command palette.

## Steps

Steps run in this order. Each appears at most once; optional steps may be left out. There are no other
operations.

| Order | `op` | Required | Other fields | Produces |
|---|---|---|---|---|
| 1 | `capturePassage` | no | none | `sourceTitle`; the host keeps the passage itself |
| 1 | `captureWebPage` | no | none | `pageTitle`, `pageUrl`, `siteName`, `byline`; the host keeps the page itself |
| 2 | `collectForm` | no | `fields` | one value per field |
| 3 | `resolveDestination` | yes | `policy` | nothing to refer to |
| 4 | `composeDocument` | yes | `blocks`, `title` | nothing to refer to |
| 5 | `proposeDocument` | yes | none | one create or append, shown before you confirm |
| 6 | `openCommittedResult` | no | none | opens the written note |

Every step also has an `id`, unique in its command. A command uses at most one capture step:
`capturePassage` or `captureWebPage`, never both (`notAllowed`).

### Destination policies

| `policy` | What happens | Title |
|---|---|---|
| `newInChosenFolder` | You choose a folder; a new note is created there and never replaces an existing file. | required |
| `chosenExistingDocument` | You choose an existing page; the result is added at its end. | not allowed |
| `associatedWithSource` | Adds to the note linked to the captured passage's page, or creates one beside it. You can ask for a separate note. Needs `capturePassage`. | required |

`capturePassage` is allowed only with `associatedWithSource`. A captured passage is evidence for the
note linked to its source. Sending it to an arbitrary chosen folder or page would silently make that note
look associated, and format 1 defines no other meaning for it, so such a package is refused
(`notAllowed`).

`captureWebPage` is allowed only with `newInChosenFolder`: a saved page is always a new note, never
added to an existing page or associated with one (`notAllowed`).

### Page values

`captureWebPage` offers four values, each one line of plain text, filled by LeadingLight from the page
the person fetched. The page's text is not among them.

| Field | Value |
|---|---|
| `pageTitle` | the page's title, as the person may have edited it in the dialog; the site's host name when blank |
| `pageUrl` | the page's final address |
| `siteName` | the site's name, or its host name |
| `byline` | the author line, only when the page has one |

### Form fields

| `kind` | Fields | Value |
|---|---|---|
| `text` | `id`, `label`, optional `required` | one line |
| `multilineText` | `id`, `label`, optional `required` | several lines |
| `choice` | `id`, `label`, `options` (2 to 12 `{ "id", "label" }`), optional `required` | the chosen option's label |
| `boolean` | `id`, `label` | yes or no; usable only in `ifFilled` |

`required` defaults to `false`. A form has at most 16 fields.

## Text and references

Wherever text appears (`title`, block `text`, list items) it is an array of parts. A string part is literal
text: one line, shown exactly as written. Markdown, HTML and link syntax in it stay plain characters.
An object part refers to a value produced by an earlier step:

```json
["Debrief: ", { "step": "answers", "field": "meeting" }]
```

| Used in | May refer to |
|---|---|
| `title` | `sourceTitle`; `pageTitle`, `pageUrl`, `siteName`; `text` or `choice` fields that are `required` |
| heading, list item | `sourceTitle`, any page value, `text`, `choice` |
| paragraph, quote | `sourceTitle`, any page value, `text`, `multilineText`, `choice` |
| `ifFilled` | any field, including `boolean` and `byline` |

References must name an earlier step and one of the values it produces. They are not paths,
expressions or templates.

**Empty answers.** A block, or one list item, that refers to an unanswered field is left out. A list with
no items left is left out. `ifFilled` keeps a block only when that field is answered (for `boolean`,
answered yes). A page's `byline` counts as unanswered when the page has none. These fixed rules are the
only conditions.

## Blocks

| `type` | Fields |
|---|---|
| `heading` | `level` (2, 3 or 4; the title is the only level 1), `text`, optional `ifFilled` |
| `paragraph` | `text`, optional `ifFilled` |
| `quote` | `text`, optional `ifFilled` |
| `list` | `style` (`bullet` or `numbered`), `items` (1 to 24 text arrays), optional `ifFilled` |

When a command captures a passage, LeadingLight places its own source block first. A package cannot write,
move or remove it, and your blocks follow it. The source block is capture evidence for LeadingLight's
association handling. It is not a header copied into every note:

- **New associated note:** exactly one `[Source](…)` link back to the source page and one association
  record, then the quoted passage, then your blocks.
- **Adding to an existing associated note:** LeadingLight checks that the note belongs to this
  source. It then extends that note's one association record and adds the quote and your blocks at its
  end, in a single reviewed change of the whole note. The title and the existing link stay as they are;
  no second header or source is added. If the note is malformed, belongs to another source, ends inside
  an unfinished code or HTML block, or changed since you reviewed it, nothing is written and your answers
  are kept.

The person chooses where it goes in LeadingLight's own dialog: the one linked note, one of several
linked notes, or a new separate note (numbered). LeadingLight never picks among several silently.

When a command saves a web page, LeadingLight likewise places its own page block first, and your
blocks follow it. A package cannot write, move or remove it, and a block of type `webArticle` is refused
(`unsupportedValue`). The page block is the whole saved page with where it came from; no reference can
read its text.

## Capabilities

| Capability | Needed when |
|---|---|
| `selection.read` | a command has `capturePassage` |
| `association.resolve` | `policy` is `associatedWithSource` |
| `document.create` | `proposeDocument` with `newInChosenFolder` or `associatedWithSource` |
| `document.append` | `proposeDocument` with `chosenExistingDocument` or `associatedWithSource` |
| `document.open` | a command has `openCommittedResult` |
| `web.capture` | a command has `captureWebPage` |

A valid package can still be unavailable on this version of LeadingLight. Turning it on stays blocked,
and the reason is shown, until every capability it lists is supported. This version performs all five
for commands that capture a passage: the selected passage is read when the person asks, the linked note
is found from its Source link, and it is added to or created beside the source. Adding to a page the
person picks (`chosenExistingDocument`) still needs a page chooser this version does not have, so such
a package stays unavailable and says it needs adding to an existing page.

`web.capture` is performed only by a version of LeadingLight that ships website capture. On any other
version a website package is still valid, but it stays unavailable and says it needs website capture;
it never claims to work. Turning on a package never fetches anything.

## Strict reading and limits

The package must be plain JSON: no comments, trailing commas, single quotes or second document. It is
refused when:

- a key repeats in one object, even when one copy spells a letter with a JSON `\u` escape
  (`invalid/escaped-duplicate-key.json` shows this);
- a key is not listed for that object, at any depth;
- brackets nest more than 12 deep anywhere in the text, including inside a member that a later
  duplicate would replace;
- a number is not a plain whole number (`2`, not `2.0`, `2e0` or `-0`);
- text contains control characters, line breaks, direction overrides or unpaired surrogates.

| Limit | Value |
|---|---|
| Package | 128 KiB (UTF-8), nesting depth 12 |
| Commands | 8 |
| Steps per command | 6, one of each operation, and at most one capture step |
| Form fields | 16; choice options 12 |
| Blocks per document | 48; list items 24; parts per text 12 |
| Literal text part | 1000 bytes; names, titles and labels 200 bytes; description 1000 bytes |
| Answers | one line 1000 bytes; several lines 64 KiB; captured quote 64 KiB |
| Composed note text, after references are filled in | 256 KiB |
| Page values a website step offers | title, site name and author 1000 bytes each; address 2048 bytes |
| Saved web page, made by LeadingLight | 768 KiB; with your blocks, the whole note at most 1 MiB |

## Diagnostics

A refused package returns diagnostics: `code`, a JSON Pointer `path` to the value or key, and a one-sentence
`message` saying what to change. Checks run in stages. Mistakes in the text itself are reported first,
then shape, then meaning, so one mistake usually gives one diagnostic. At most 32 are returned.

| Code | Meaning |
|---|---|
| `tooLarge`, `tooDeep` | the package is over the size or nesting limit |
| `invalidJson` | not plain JSON |
| `duplicateKey` | a key appears twice in one object |
| `invalidNumber` | a number is not a plain safe whole number |
| `unknownField`, `missingField` | a key is not allowed here, or is needed |
| `wrongType`, `invalidValue`, `tooLong`, `tooMany` | a value has the wrong type or form, or is over a limit |
| `unsupportedSchema` | not `leadinglight.extension/1` |
| `unknownOperation`, `unknownCapability`, `unsupportedValue` | a step `op`, capability or other choice is not in the lists above |
| `duplicateId` | an id or capability is used twice |
| `stepOrder`, `missingStep`, `notAllowed` | steps are out of order or missing, a title is given where none is used, a passage is captured for a note that is not associated with its source, a command has two capture steps, or a web page would go anywhere but a new note |
| `unboundReference`, `forwardReference`, `incompatibleReference` | a reference names nothing, names a later step, or is used where its value cannot go |
| `undeclaredCapability`, `unusedCapability` | `capabilities` does not match what the commands use |

## Examples

Four examples share the same steps and differ only in data. Their full text is in `fixtures/`.

**Meeting debrief** (`meeting-debrief.json`): a form, a folder you choose, a new structured note,
opened afterwards. Works now.

```json
{
  "id": "new-debrief",
  "title": "New meeting debrief",
  "steps": [
    { "id": "answers", "op": "collectForm", "fields": [
      { "id": "meeting", "kind": "text", "label": "Meeting", "required": true },
      { "id": "decisions", "kind": "multilineText", "label": "Decisions", "required": true },
      { "id": "followUps", "kind": "multilineText", "label": "Follow-ups" },
      { "id": "revisit", "kind": "boolean", "label": "Revisit next week" }
    ] },
    { "id": "destination", "op": "resolveDestination", "policy": "newInChosenFolder" },
    { "id": "note", "op": "composeDocument",
      "title": ["Debrief: ", { "step": "answers", "field": "meeting" }],
      "blocks": [
        { "type": "heading", "level": 2, "text": ["Decisions"] },
        { "type": "paragraph", "text": [{ "step": "answers", "field": "decisions" }] },
        { "type": "heading", "level": 2, "text": ["Follow-ups"], "ifFilled": { "step": "answers", "field": "followUps" } },
        { "type": "paragraph", "text": [{ "step": "answers", "field": "followUps" }] },
        { "type": "paragraph", "text": ["Revisit this next week."], "ifFilled": { "step": "answers", "field": "revisit" } }
      ] },
    { "id": "create", "op": "proposeDocument" },
    { "id": "open", "op": "openCommittedResult" }
  ]
}
```

**Passage commentary** (`passage-commentary.json`): capture a selected passage, ask an optional thought,
add to the note linked to its source or create one. Works now: LeadingLight ships it on by default as
`leadinglight.passage-commentary`, offers it on a text selection (rich editor toolbar) and in the command
palette, and opens the note beside the source. A copy with your own fields or blocks works the same way.

**Observation log** (`append-observation.json`): ask what you noticed and add a heading and quote to the
end of a page you pick. Valid, but unavailable in this version: there is no page chooser yet.

**Save from website** (`website-capture.json`): fetch a page the person enters, ask why they saved it,
and create a note in a folder they choose, with the page first and the answer after it. LeadingLight's
own copy is `leadinglight.website-capture`; your own version uses a `local.` id, such as
`local.website-capture`. Available only where website capture is (see Capabilities).

```json
{
  "id": "save-page",
  "title": "Save from website",
  "steps": [
    { "id": "page", "op": "captureWebPage" },
    { "id": "notes", "op": "collectForm", "fields": [
      { "id": "why", "kind": "multilineText", "label": "Why I saved this" }
    ] },
    { "id": "where", "op": "resolveDestination", "policy": "newInChosenFolder" },
    { "id": "note", "op": "composeDocument",
      "title": [{ "step": "page", "field": "pageTitle" }],
      "blocks": [
        { "type": "heading", "level": 2, "text": ["My notes"], "ifFilled": { "step": "notes", "field": "why" } },
        { "type": "paragraph", "text": [{ "step": "notes", "field": "why" }] }
      ] },
    { "id": "save", "op": "proposeDocument" },
    { "id": "open", "op": "openCommittedResult" }
  ]
}
```

## Saving a web page

How LeadingLight's website capture is designed to work. Whether this version performs it is shown in
each package's review (see Capabilities); nothing here makes a package available.

**A recipe can change:**

- the command's title and the package's name and description;
- the questions, such as "Why I saved this" or a choice of topic, each optional or required;
- the note title, from `pageTitle`, `pageUrl`, `siteName` and required answers, such as
  `["Read: ", { "step": "page", "field": "pageTitle" }]`;
- headings, paragraphs, quotes and lists after the page, from literal text, answers and page values,
  with `ifFilled`;
- whether the note opens afterwards.

**LeadingLight always does itself, and no package can change:**

- **The address and the request.** The person types the address and chooses Fetch in LeadingLight's
  dialog. Nothing is fetched on paste, on opening the dialog, by validation, preview or turning a package
  on, or ever again later. Only public websites are fetched, never this computer or a private network,
  with one plain request: no cookies, sign-in, scripts, images or other files.
- **The page.** LeadingLight turns it into Markdown and keeps its text literally. Images stay links and
  are never downloaded, nothing from the page runs, and a page whose text can't be kept exactly is
  refused, never cut short or filled in.
- **Where it came from.** The page block, its "Saved from" line and the provenance in front matter
  (`source`, `captured`, and when known `author`, `site` and `published`, plus one hidden record). Editing
  the title in the dialog never changes them.
- **Save link only.** When the page can't be read, the person may save a note with the address and a hint
  to paste the text; your blocks follow it as usual, so the same recipe serves both.
- **The write.** The folder chooser, the file name from the title, never replacing a file, the "saved
  before" notice, Check again and Undo.

**After saving.** The note is ordinary Markdown. It is never fetched again or updated from the site, and
opening it makes no request and loads no image. Turning the recipe off removes only its command; saved
notes stay readable and their links keep working. Nothing is sent to an AI provider.

**What cannot be asked for.** Format 1 has no field for an address, header, method, credentials,
cookies, scripts, HTML, Markdown, images or an AI provider, so a request for a recipe that fetches a
fixed page, fetches by itself, reads a site with a sign-in, adds to an existing note or rewrites the
page's text is unsupported. The nearest recipe is this one, with the person entering the address.

## For host developers

- `parseExtensionPackage(text)` validates and returns a frozen package or diagnostics. The run driver
  refuses any package object it did not produce.
- `reviewPackage(extension, hostCapabilities)` gives activation availability and, per command, its
  placement, network effect (`none`, or `explicitWebPage` for a website command), write, whether it opens
  the result, question count and missing capabilities. Write the user-facing sentences from these facts,
  not from package text.
- `previewDocument(command, { capture, answers, destination, webPage })` is pure. It returns the typed
  document, the write and every input problem. Previews use synthetic captures and handles and never
  reach native code. A website command's page arrives with the review decision; its host seam is in
  [web-capture-recipes.md](web-capture-recipes.md).
- `runExtensionCommand(start, effects)` runs review, then at most one commit, then open, through injected
  effects. It checks the run before and after each awaited effect. A run that ends during review writes
  nothing. A run that ends during commit keeps the write and does not open it. A lost commit reply is
  `uncertain`: query it by its operation id and never submit again.
- Composed text is literal. Encoding it as Markdown is done by the host, under the renderer's actual
  rules, before the guarded proposal (`src/leadinglight/proposals/proposalContract.ts`) is submitted.
- Native transport shapes are in `src/leadinglight/extensions/extensionApi.ts`. Ids and handles there are
  opaque, short plain tokens and are checked again natively.

### Sessions

Every run belongs to a native session, one per vault visit in one window.

- `openExtensionSession(api, vaultPath)` opens the session. Its `admit` never asks native before the
  session's own open reply arrives.
- `close()` stops admissions at once. It then closes the session natively; native revokes pending
  admissions, runs and handles, and joins writes already being published.
- An open reply that arrives after `close()` is closed as it arrives, before it can be used.
- Returning to a vault opens a new session. Identity never comes from a path, so a late admission from an
  earlier visit is refused.
- `end(invocationId)` ends a run by its request-time `{sessionId, invocationId}`, even before its
  admission reply. Native keeps that key as a tombstone for the session's life.
- A lost or mismatched admission reply is reported as `unanswered`, never as a run. The result also
  carries the barrier for ending its key.
- `liveness(invocationId)` is what `RunEffects.liveness` should return.

`close()` and `end()` return a barrier, `confirmed` or `unconfirmed`. A barrier is `confirmed` in two cases:

- native gave a valid answer for that exact session or key (`closed`, or `ended`); or
- the session never obtained an id, so nothing could have been admitted through it. No native cleanup is
  claimed in that case.

A native `unknown` answer means the answering process has no such session, so no work of it is active
there. It says nothing about writes committed earlier.

A lost, rejected or malformed answer is `unconfirmed`. The boundary is not settled: admissions stay off,
the vault must not be left as if settled, and calling again asks native again with the same session or
key. A confirmed close is remembered; an unconfirmed one is not. Neither result changes the status of a
write. A committed write stays committed, and an uncertain one is queried and never retried.

### Proposal results

- `conflict` and `refused` prove nothing was written. `storageUnavailable` means the folder or disk could
  not be written before anything was published. For an addition it also covers page history: if the
  page's earlier text could not be kept there and verified, the page is left as it was.
- `uncertain` may already have committed. Query it; never retry automatically.
- A query answers `running` for an operation still in flight. It answers `unknown` only when no record is
  kept, which never proves nothing was written.
- A committed reply must match the proposal's kind and digests.
- Adding to a page carries the whole reviewed page, prepared by LeadingLight from the exact bytes it
  bound, with the expected digest of the page before the change; it is written only if the page still
  holds exactly those bytes. A reported append must include an undo token; without one it is not a
  success. Undo is a host action offered to the person afterwards, never a recipe step. Its commands,
  lifetime and limits are in `src/leadinglight/proposals/proposalUndoContract.ts` and
  [commentary-native.md](commentary-native.md).
