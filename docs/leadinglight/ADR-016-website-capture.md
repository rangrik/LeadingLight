# ADR 016: Saving a web page as a note

**Status.** Accepted design for the website milestone, not released. Its parts are built and tested
separately: native fetch, conversion, extension vocabulary and dialog. Real sites, the dialog in the
native window, and native webviews are not qualified; the only browser evidence is a headless Chrome
check that the inert parse makes no request.

## Context

The owner authorized two explicit network exceptions for this local-first fork (AGENTS.md, October 20):
saving a website the person enters as a Markdown note, and the in-app provider session Adapt uses. This
ADR covers the first. Extensions are data run by a trusted host
([ADR 013](ADR-013-local-extensions-experience.md)), and Adapt drafts them from a built-in guide
([ADR 014](ADR-014-adapt-extension-authoring.md)). A web page is untrusted input in every part: its
address, redirects, bytes, encoding, markup, scripts, images and text. Nothing in the app may treat it
as instructions, and nothing may reach a site unless the person asks.

## Decision

Website capture is four parts with one owner each, joined by the website dialog and the existing
extension run.

**1. A trusted native fetch service** (`src-tauri/src/leadinglight_web_capture/`, commands
`web_capture_fetch` and `web_capture_cancel`):

- One explicit request, started only by the dialog's Fetch, carrying the exact address shown. The owner
  is the calling window, read natively; one attempt per window; Stop, a new Fetch, a page load or a closed
  window cancels, and a late result never replaces a newer one.
- A plain GET with fixed headers: no cookies, credentials, proxy, referrer, compression or retry.
  http(s) only, no credentials in the address, at most 5 redirects, never https to http.
- Every DNS answer must be public, and the checked answers are pinned for that hop; local and private
  addresses are refused before any connection.
- Bounded: 5 MiB body and decoded text, 30 s per attempt, documented decoding (not full browser
  parity), 21 fixed failure reasons that never echo server text. No URL is logged or kept afterwards.
- It knows nothing of vaults, notes, runs, packages or providers.

**2. An inert conversion pipeline** (`src/leadinglight/webCapture/`):

- One new dependency, **`@mozilla/readability` 0.6.0**, pinned exactly. Everything else is already in
  the app: DOMPurify, BlockNote's HTML parser and canonical Markdown serializer, and `yaml`. Turndown,
  Defuddle and hosted extraction were rejected: they add heuristics or network code, or send pages
  elsewhere.
- The page is parsed into a detached document that is never attached to the app and loads nothing.
  Readability extracts the article, DOMPurify reduces it to a strict allowlist, and a normalizer keeps
  ordinary structure (headings, lists, quotes, code, simple tables, links).
- Images and other media become text links, never downloads. Code the page labels HTML or as a diagram
  never becomes a live app block. Internal editor markers are refused.
- **Exact or refused.** The note must reopen in the editor as exactly the converted article and save back
  to the same bytes. A page that can't meet this is refused with a fixed reason (`unreadable`,
  `tooLarge`, `tooComplex`, `unsafeText`, `notExact`). It is never cut short, filled in or guessed. The
  person may then save a link-only note, which keeps the address and provenance and has no page text.

**3. One extension step** (format 1, additive): `captureWebPage`, deriving the capability `web.capture`.

- A package names no address, header, method, credential or option. It gets four bounded values
  (`pageTitle`, `pageUrl`, `siteName`, `byline`) and lays out its own questions, title and blocks around
  a host-only page block that it cannot write, move, remove or read.
- Create only (`newInChosenFolder`), never with passage capture, one write per run.
- The review states the network effect from the steps (`network: explicitWebPage`), never from package
  text. Host capability lists are explicit snapshots, so adding a capability never grows them.
  `web.capture` is offered only where fetch, conversion and dialog qualify, behind a native flag of its
  own, switched together with the frontend list. Until then a website package validates but stays off.
- The rules are in [extensions-catalog.md](extensions-catalog.md) and
  [web-capture-recipes.md](web-capture-recipes.md); TypeScript and native validation share one
  conformance corpus.

**4. The existing write path, unchanged.** The page arrives in the run's review decision. The commit
composes the whole note (the converted page re-titled, the package's blocks after it), verifies it and
submits the existing exclusive create proposal. A lost reply is queried, never retried. Undo is the
existing guarded create Undo, and the result opens in the reserved pane. There is no new write path, run
driver, background job or agent framework.

## Consequences

- **The saved note is ordinary Markdown.** Its front matter has `source`, `captured`, optional `author`,
  `site` and `published`, and one hidden provenance record. It is never fetched again, refreshed or
  updated, and opening it makes no request. Turning the recipe off removes only its command.
- **Adapt can draft and adjust website recipes from the guide.** It cannot grant `web.capture`, add an
  address, or replace the bundled `leadinglight.website-capture`; a change becomes a `local.` package.
  Attaching a saved note to Adapt is a separate, explicit choice there.
- **A site sees one request** from the person's network, with LeadingLight's user agent, only when they
  choose Fetch. This is a deliberate, disclosed network exception, like Adapt's explicit provider session.
  The local-only runtime and dependency documents must say so when the milestone ships.
- **Limits.** Extraction quality on real sites, native webviews (WKWebView, WebView2, WebKitGTK) and the
  dialog in the native window are unqualified. Conversion timings are measured in jsdom only. The "saved before" check
  compares the loaded notes' `source` and is best effort. Fetching never follows a sign-in or runs
  scripts, so such pages are refused or saved as links.
