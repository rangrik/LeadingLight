# Website capture: native integration

This page covers how the desktop host connects the native fetch
([web-capture-native.md](web-capture-native.md)) to the app and to extension recipes. The fetch
itself is in `src-tauri/src/leadinglight_web_capture/`; this page is about what surrounds it:

- `src-tauri/src/commands/web_capture.rs`, the two commands: the fetch served at dispatch, and the
  cancel;
- `src-tauri/src/lib.rs`, the state, the fetch's dispatch, registration and window hooks;
- `src-tauri/src/leadinglight_extensions/manifest.rs`, the recipe vocabulary and the capability
  guard;
- `src-tauri/src/leadinglight_extensions/bundled/website-capture.json`, the bundled recipe.

## Two commands

| Command | Arguments | Reply |
|---|---|---|
| `web_capture_fetch` | `{ args: { attemptId, url } }` | `fetched`, `failed` with a fixed reason, or `cancelled` |
| `web_capture_cancel` | `{ args: { attemptId } }` | `cancelled` or `notActive` |

**Arguments are read strictly.** An unknown or missing key is an unreadable argument, and so is an
`attemptId` that is not a canonical lowercase UUID. In those cases the call fails, and nothing is
reserved or starts. A fetch call also fails when its window is sealed (see below). Every other
outcome is a reply.

**The fetch is served as Tauri dispatches it.** The app's invoke handler answers
`web_capture_fetch` itself, after Tauri's own permission check, using only Tauri's public invoke
API. It reads `args` exactly as a generated command would and reserves the attempt there, before
any task exists. Then it hands that reservation to this request's own task with `respond_async`.
The lookups, connections and timers live in that task on the async runtime, never on the dispatch
thread. `web_capture_cancel` is an ordinary command, and also runs off the main thread.

**The owner is the calling window.** The window's label comes from Tauri itself; no argument can
name a window, vault, extension run or package. That has two consequences:

- one window has at most one fetch at a time, and a newer fetch from it replaces the older one;
- a cancel must match both the window and the attempt id.

A fetch stops on its own when its window starts loading a page or is destroyed. A fetch that is
stopped, replaced or cancelled answers `cancelled`; its result is never delivered later. That holds
even before its task first runs: a cancel, page load or newer fetch that comes first stops it before
any lookup or connection.

**Dispatch order is not send order.** Each request is its own asynchronous `fetch`. When a reply
fails, Tauri's bridge sends the same message again through `postMessage`. So a fetch can arrive
after its cancel was answered. For each window's current page, native remembers the ids that were
cancelled or replaced, and a fetch arriving with one of them answers `cancelled` without starting.

The record is bounded at 1,024 ids and never evicted. When it is full, the window is sealed: fetch
calls fail, and the dialog shows website fetch as unavailable, until the window's page loads again
or the window closes. The record goes with the page.

A request from a replaced page that arrives after the new page's load started cannot be told apart
natively; it can run once, unanswered.
[web-capture-native.md](web-capture-native.md) lists these limits.

The website service is created at startup. Creating it starts nothing: no lookup, connection or
timer exists until the first explicit fetch.

## Recipes that save a web page

The extension format gains one step and one capability. Both are additive: every existing package
validates exactly as before, with the same codes, paths and messages.

- **`captureWebPage`** has exactly two keys, `id` and `op`. A package can never give an address,
  method, header, credential, cookie or option; any other key is refused as `unknownField`.
- **The step's values.** It produces four one-line values for the composed note:
  - `pageTitle`, `pageUrl` and `siteName` are always filled, so they may appear in the title;
  - `byline` may be unknown, so it may appear in headings, paragraphs, quotes, list items and
    `ifFilled`, but not in the title.
- **The page's text is not available to the package.** A reference to `article`, `html` or any
  other name is refused.
- **`web.capture`** is the capability the step needs. It comes last in the canonical order, after
  `document.open`.
- **What a website command may do.**
  - It saves only as a new note in a folder the person chooses (`newInChosenFolder`). Adding to an
    existing page or to an associated note is refused.
  - It captures either a passage or a web page, never both, and at most one page.
  - The page block itself (`webArticle`) is made by the host. A package that writes one is
    refused.

These rules mirror `src/leadinglight/extensions/extensionSchema.ts`. Native runs the same
conformance corpus, `fixtures/web-capture-cases.json`, and gets exactly one diagnostic per case,
with the same code and path.

## The capability guard

What this host performs is decided by two independent switches in `manifest.rs`:

| Switch | Adds | Now |
|---|---|---|
| `HOST_SERVICES_QUALIFIED` | `selection.read`, `association.resolve` (passage commentary) | on, from 0.13.0 |
| `WEBSITE_SERVICES_QUALIFIED` | `web.capture` | on, from 0.14.0 |

`document.create`, `document.append` and `document.open` are always performed natively. Growing
the list of known capabilities never grows this host. This build therefore performs the five E2
capabilities and `web.capture`.

`web.capture` needs three things: the native fetch, the page conversion in the desktop window, and
the website dialog. It is offered because this build has all three. The native switch and the
desktop window's own host list (`WEBSITE_FRONTEND_QUALIFIED`) change together. The window adds
`web.capture` only in the desktop app; an ordinary browser never offers it.

In a build with the switch off, a website package can be imported and is listed, but:

- it shows `web.capture` as missing;
- turning it on is refused;
- its commands do not start.

## The bundled recipe

**Save from website** (`leadinglight.website-capture`) is the website conformance fixture under a
reserved id, the same arrangement as the other bundled recipes. It has one command, "Save from
website":

1. capture the page;
2. ask an optional "Why I saved this";
3. choose a folder;
4. compose a note titled with the page title, with a "My notes" section only when there is an
   answer;
5. save;
6. open it.

It is on by default only where the host performs everything it needs, so today it is listed and
off.

## Saving

**Saving uses the existing extension path; nothing new crosses into native.** The desktop window
composes the whole note:

- the converted page, with its provenance;
- the recipe's blocks;
- one exclusive create proposal, with the existing receipt, the lost-reply query and the guarded
  Undo of a created note.

Native sees an ordinary create: content, its digest, a folder bound to the run, and a file name.
It never sees the page handle, the page's HTML or the recipe's page block.

| Bound | Value |
|---|---|
| Fetched page text | at most 5 MiB of UTF-8 |
| Converted note | at most 768 KiB |
| Proposal content (note and recipe blocks) | at most 1 MiB of UTF-8 |
| File name | at most 255 bytes, a valid file name |
| Writes per run | one |

**A name already in use is a conflict.** Nothing is ever overwritten.

**Create-only is enforced by the recipe rules and the desktop window.** Native runs do not
themselves tie a proposal's kind to the command's capabilities. That is the existing extension
model; tightening it is a possible later change.

## What native does not do here

- Convert, store or cache a page.
- Keep an address after an attempt, or log one.
- Accept anything network-related from a package.
- Resolve or dispatch on a handle a package or page could supply.
- Fetch without an explicit request.
- Tie a fetch to a vault or a run. When the vault changes or the dialog closes, the desktop
  window cancels its own fetch.

## How it is tested

- **Recipe vocabulary.** These run in the extension module's tests:
  - the website corpus, with every case answered as the TypeScript validator answers it;
  - every forbidden step key, and an unknown key at every object of the recipe;
  - the page values by use, and page-specific messages;
  - capability order and list size;
  - E1 and E2 messages kept word for word;
  - the bundled recipe equal to the fixture.
- **The guard.** These use stores with chosen hosts:
  - with native alone, or with the E2 services qualified, the website recipe is listed, off, and
    refused activation for exactly `web.capture`, while E2 commentary is unaffected;
  - each switch adds exactly its own capabilities to this build's host;
  - this build's own host performs all six capabilities. It turns E2 commentary and the website
    recipe on by default without writing preferences, and admits a website run;
  - every E2 capability stays performed, whatever the website switch says;
  - with every capability, the recipe is on by default and its command is admitted.
- **Saving.** A website run on a disposable vault saves one note through the existing exclusive
  create, is offered Undo, and a second save under the same name is a conflict that leaves the
  first note untouched (Unix).
- **Commands.** One test checks that both commands are not on the disabled list. Another checks
  the fetch's `args` reader: it is strict, and an unreadable call reserves nothing. The dispatch
  itself, registration, state and window hooks are covered only by the build and lint checks. The
  service they call has the held-task tests in [web-capture-native.md](web-capture-native.md).

Not qualified here: the desktop dialog, the conversion, real websites, and any native window.
