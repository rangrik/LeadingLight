# Website recipes

A website recipe saves one web page as a new ordinary note. The person types an address and chooses
**Fetch** in LeadingLight's own dialog; LeadingLight fetches that page, turns it into Markdown and adds
where it came from. The recipe decides only what is around the page: the questions, the note title and
the blocks after it. This extends package format 1 (`leadinglight.extension/1`, see
`extensions-catalog.md`); packages without the new step are unaffected.

The source of truth is `src/leadinglight/extensions/extensionContract.ts`. Shared examples are
`fixtures/website-capture.json` and the conformance cases in `fixtures/web-capture-cases.json`.
LeadingLight's own recipe is `leadinglight.website-capture` ("Save from website"); it is that fixture
(`local.website-capture`) under the reserved bundled id. A person's own version, made by hand or with
Adapt, uses a `local.` id; a bundled package is never replaced.

**Status.** The package format, validation and review below are implemented and tested. The dialog, the
fetch and the saving of the note are being integrated for the website milestone and are not released;
where this page says what LeadingLight does when a recipe runs, it describes that intended, guarded
behaviour, not a qualified result.

## What a website recipe can and cannot do

It can ask questions, compose a title from the page's title, site name or address and from answers,
add headings, paragraphs, quotes and lists after the page, and open the note.

It cannot name an address, a header, a method, credentials, cookies or any fetch option; fetch on its
own, in the background or twice; add to an existing note; read other notes; change, move or leave out
the page or its provenance; or supply HTML or Markdown. Validating, previewing or turning on a
package never contacts anything.

## The step

```json
{ "id": "page", "op": "captureWebPage" }
```

The step has no other fields, so `"url"` or `"headers"` is refused as an unknown field. It comes first,
before `collectForm`, at most once. A command captures a passage or a web page, never both. The
destination must be `newInChosenFolder`: a page is always a new note in a folder the person chooses,
created without replacing any file. Like every command that creates a note, a website command also needs
`resolveDestination`, `composeDocument` with a title, and `proposeDocument`.

| Capability | Needed when |
|---|---|
| `web.capture` | a command has `captureWebPage` |

The other capabilities follow as before: `document.create` for the new note, `document.open` with
`openCommittedResult`.

## Page values

The step offers four values to references, each one line of plain text:

| Field | Value | Usable in |
|---|---|---|
| `pageTitle` | the page's title, as the person may have edited it; the host name when blank | title, heading, paragraph, quote, list item |
| `pageUrl` | the page's final address | title, heading, paragraph, quote, list item |
| `siteName` | the site's name, or the host name | title, heading, paragraph, quote, list item |
| `byline` | the author line, only when the page has one | heading, paragraph, quote, list item, `ifFilled` |

`byline` may be missing, so it cannot be in the title, and a block or list item that refers to it is
left out when there is none, the same rule as for unanswered fields. The page's text is not a value:
no reference can read or move it.

## What the note looks like

LeadingLight places its own page block first: the title, the "Saved from" line with the address and
date, the author line when known, then the page itself. Where it came from is kept in the front matter:
`source` (the final address), `captured` (the time of the fetch), `author`, `site` and `published` when
known, and one hidden provenance record. The recipe's blocks follow the page. Changing the title in the
dialog changes only the title, never where the note says the page came from.

When the page can't be read, the person may choose **Save link only**. The note then has the same title
and provenance and a short hint to paste the text, and the recipe's blocks follow as usual: the same
recipe works for both.

```json
{
  "id": "note",
  "op": "composeDocument",
  "title": [{ "step": "page", "field": "pageTitle" }],
  "blocks": [
    { "type": "heading", "level": 2, "text": ["My notes"], "ifFilled": { "step": "notes", "field": "why" } },
    { "type": "paragraph", "text": [{ "step": "notes", "field": "why" }] }
  ]
}
```

The note is ordinary Markdown afterwards: it is never fetched again or refreshed, opening it makes no
request and loads no image, and nothing is sent to an AI provider. Turning the recipe off removes only
its command; saved notes stay readable. What a recipe may change and what LeadingLight always does
itself is listed under "Saving a web page" in `extensions-catalog.md`, which is also the guide Adapt
sends with each request.

## Refusals

Each mistake gives one diagnostic, with these codes and paths (plus every rule in `extensions-catalog.md`):

| Mistake | Code |
|---|---|
| any field besides `id` and `op` on the step | `unknownField` |
| the step after `collectForm`, or twice | `stepOrder` |
| `capturePassage` and `captureWebPage` in one command | `notAllowed` (at the web step) |
| `chosenExistingDocument` or `associatedWithSource` with the step | `notAllowed` (at the policy) |
| a block of type `webArticle` | `unsupportedValue` |
| a reference to a field the step doesn't offer, such as `article` or `html` | `unboundReference` |
| `byline` in the title | `incompatibleReference` |
| the step without `web.capture` in `capabilities`, or `web.capture` without the step | `undeclaredCapability`, `unusedCapability` |

## Review and availability

A package's review states, from its steps and never from its text, whether a command can make
LeadingLight contact a site: `network` is `explicitWebPage` for a website command and `none` otherwise.
A valid website package stays off, with `web.capture` listed as missing, until this version of
LeadingLight actually performs website capture. Turning it on asks for nothing more.

## For host developers

- `parseExtensionPackage` and `commandCapabilities` know the step; `reviewPackage` adds `network`.
- The page is fetched during review, so it arrives with the review decision:
  `{ action: 'submit', answers, destination, webPage }`. `previewDocument` and `prepareProposal` read it
  from `RunInput.webPage`. A missing or malformed page, a page given to a command without the step, or
  a passage capture given to a website command, is `invalidCapture`.
- `readWebPageCapture(value)` (`extensionWebPage.ts`) checks what the host builds after a Fetch or
  Save link only: an opaque run-bound `page` token, `kind` (`article` or `linkOnly`) and the four values,
  exactly those keys, bounded (page text 1000 bytes, address 2048 bytes; http or https, no credentials or
  fragment). It returns a frozen copy or null.
- The composed document is `[{ type: 'webArticle', page }, ...package blocks]`. `buildExtensionMarkdown`
  refuses it (`source`); the host writes it: `webArticleComposition(document)` gives the handle, the
  title and the package's blocks; the host resolves the handle to its converted page re-titled with that
  title, appends `packageBlocksMarkdown(blocks)` after one blank line, checks the whole note and submits
  one exclusive create.
- `E1_HOST_CAPABILITIES` and `E2_HOST_CAPABILITIES` are fixed lists and never include `web.capture`.
  A host adds it only once its fetch, conversion and dialog are in place. Natively the capability sits
  behind its own qualification flag, separate from the passage one; the native flag and the frontend
  host list are switched together, never one alone.
- Native validation mirrors these rules and runs the same conformance files (`cases.json` unchanged,
  plus `web-capture-cases.json`), so both validators give the same code and path for every case.
