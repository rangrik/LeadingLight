# Website capture: the dialog

How a person saves a web page as a note, and the leaves that implement it in
`src/leadinglight/webCapture/`. The experience follows Fable's spec. The page conversion is described
in [web-capture-conversion.md](web-capture-conversion.md), and the recipe format in
[web-capture-recipes.md](web-capture-recipes.md).

The dialog is wired into the app. Website saving is on in the desktop app from 0.14.0, and only
there: see [How it is wired](#how-it-is-wired) at the end.

## One dialog, two stages

1. **Address.** The person types or pastes an address. Only the Fetch button, or Enter in the
   address field, sends a request. Typing, pasting, opening the dialog and leaving the field never do.
   - A bare name gets `https://`, and a quiet line shows what will be fetched.
   - While fetching, the button becomes Stop and the status names the host.
   - Escape stops a fetch and keeps the dialog open.
2. **Page ready.** The page's title is filled in, focused and selected, and can be edited.
   - The recipe's own question follows, then the folder.
   - On the other side is a passive preview of the whole note exactly as it will be saved: no live
     links, images, HTML or scripts.
   - Save is the only confirmation.
   - Editing the address returns to the first stage. The page, its title and the preview are
     dropped; the recipe's answers and the folder stay.

A failure is one plain alert, and the address stays in the field:

- **Save link only** is offered for every failure except an unusable or refused address, a refused
  redirect and a missing page. It keeps the address, the page title (when one was read safely) and
  a note telling the person to paste the text themselves.
- **Open in browser** is offered only where reading the page there is the next step: the site
  refused access, or the page had no readable text.

**Saved before.** Before fetching, the typed address is compared with the `source` of notes the app
has already listed.

- If it matches a saved note, no request is made. The notice offers **Open saved copy**, and Fetch
  becomes **Fetch anyway**.
- After fetching, the final address is checked the same way. Save then becomes **Save another
  copy**, and the file gets the next free number (`name-2.md`).
- The check reads only the listed notes' `source` property and is bounded. When the listing is
  incomplete, or the bound is reached, the notice says so rather than claiming there is no copy.

## What keeps it safe

- **One route to the network.** `webCaptureTransport.ts` sends only the two declared native
  commands (fetch and cancel), each with one `args` object.
  - Replies are read strictly against the request's own attempt id.
  - Anything unexpected counts as "unavailable", and is never read as a page.
  - In the browser build there is no native fetch, so the dialog says so honestly.
  - Addresses are never logged.
- **No stale result lands.** `webCaptureFlow.ts` gives every Fetch, address edit, Stop and
  revocation a new generation. A late reply or conversion from an older generation is dropped, and
  its page is never registered. Stop also cancels the native attempt and aborts the conversion.
- **Run-bound pages.** The recipe sees only an opaque token and four bounded values: title, address,
  site name and byline, checked by the domain's own reader.
  - The token stops resolving when the address changes, on a new Fetch, or when the run is revoked:
    the workspace changed, the recipe was turned off or replaced, or the dialog closed.
- **The whole note is verified before Save** (`webCaptureNote.ts`). The note is the converter's
  verified article (or link-only) note, then the recipe's blocks as the host's literal encoder
  wrote them. It must:
  - reopen in the editor exactly as the article alone followed by the recipe blocks alone;
  - have recipe blocks that are plain text (no marks, links, wikilinks, math, code or HTML);
  - stay within 1 MiB.

  Anything else is refused, and nothing is written.
- **No second write path.** Saving goes through the host's existing controller: one exclusive
  create proposal per run, Check again for an unconfirmed write, and the existing Undo.
  - The controller's synchronous `prepare` gets the verified bytes from `webCaptureContentFor`.
  - It gets them only when the proposal's page handle, title and recipe blocks are exactly what was
    verified.

## Leaves

| File | What it is |
|---|---|
| `webCaptureTransport.ts` | Native fetch and cancel, with strict reply readers. |
| `webCaptureFlow.ts` | Address, Fetch, Stop, convert, failure and link-only state; generation guards; the `useWebCaptureFlow` hook. |
| `webCapturePageStore.ts` | Run-bound page tokens, and the page values given to the recipe. |
| `webCaptureNote.ts` | The whole note, verified; the prepare match; numbered file names. |
| `webCaptureComposition.ts` | The recipe's title and blocks for a page, and the proposal's bytes, from the domain seam. |
| `webCaptureDuplicates.ts` | Bounded "saved before" lookup over listed notes. |
| `webCaptureLabels.ts` | The typed set of strings the dialog shows, all injected. |
| `WebCaptureDialog.tsx`, `webCapture.css` | The dialog. It reuses shadcn controls, the extension dialog shell and the template passive preview, with the Phosphor `Globe` icon. |

## Strings

The dialog holds no copy. The host passes `WebCaptureLabels`, built from these locale keys. The
English below follows Fable's spec.

**New keys** (each prefixed `leadinglight.webCapture.`):

| Key | English |
|---|---|
| `description` | Connects to the address you enter only when you choose Fetch. Nothing is saved until you choose Save. |
| `address` | Web address |
| `addressPlaceholder` | https:// |
| `fetch` | Fetch |
| `fetchAnyway` | Fetch anyway |
| `stop` | Stop |
| `willFetch` | Will fetch {url} |
| `fetching` | Fetching {host}… |
| `preparing` | Preparing the page… |
| `stopped` | Stopped. |
| `pageReady` | Page ready: {title} |
| `failure.unusableAddress` | Enter a full web address, such as https://example.org/article. |
| `failure.refusedAddress` | LeadingLight only fetches public websites, not addresses on this computer or a private network. |
| `failure.redirectRefused` | This address redirects somewhere LeadingLight won’t follow, so the page wasn’t fetched. |
| `failure.notFound` | That page wasn’t found at this address. Check it, or open it in your browser. |
| `failure.accessDenied` | This site didn’t let LeadingLight read the page. It may need a login, or it may block apps. |
| `failure.unreadable` | No readable text was found on this page. It may need a login or scripts to show its content. |
| `failure.notHtml` | This address isn’t a web page LeadingLight can read; it may be a file such as a PDF. |
| `failure.unsupportedPage` | This site sent the page in a form LeadingLight can’t read. |
| `failure.tooLargeOrComplex` | This page is too large or too complex to save safely. |
| `failure.rateLimited` | The site asked LeadingLight to slow down. Try again in a little while. |
| `failure.unreachable` | This site couldn’t be reached right now. Check your connection or try again later. |
| `failure.tlsFailed` | A secure connection to this site couldn’t be made. |
| `failure.unavailable` | Fetching web pages needs the LeadingLight desktop app. |
| `saveLinkOnly` | Save link only |
| `openInBrowser` | Open in browser |
| `wasAddress` | Was {url} |
| `savedBefore` | You saved this page before: {title}, in {folder}. |
| `savedBeforeIncomplete` | Not every note is listed yet, so an earlier copy might not show here. |
| `openSavedCopy` | Open saved copy |
| `saveAnotherCopy` | Save another copy |
| `title` | Title |
| `titleProblem` | This title can’t be used as written. Remove line breaks, special control characters or internal markers. |
| `exists` | A note named “{name}” already exists in {folder}. Change the title, then save again. |
| `imagesAsLinks` | Images aren’t downloaded. The note keeps a link for each one. |
| `linkOnlyNotice` | The page’s text couldn’t be saved from the website. Paste it here if you want it in this note. |
| `previewPreparing` | Preparing the preview… |
| `save` | Save |
| `saving` | Saving… |
| `media.image` | Image |
| `media.video` | Video |
| `media.audio` | Audio |

The `media.*` labels go to the converter's `mediaLabels`, and therefore into the note, as in
`Image: The lamp room`.

**Existing keys reused** (each prefixed `leadinglight.extensions.`):

- `createIn`, `rootFolder`, `willCreate`;
- `showPreview`, `hidePreview`, `previewLabel`;
- `cancel`, `done`, `close`, `checkAgain`, `checking`;
- `uncertain`, `uncertainRunning`, `uncertainUnknown`, `uncertainWhere`;
- `created`, `createdNotOpened`, `createdElsewhere`, `notDurable`;
- `revokedWorkspace`, `revokedPackage`;
- `problem.form`, `notWritten.*`;
- `discardQuestion`, `discardHint`, `discardUncertain`, `keepEditing`, `discard`, `stopChecking`.

## How it is wired

- **On in the desktop app from 0.14.0.** `WEBSITE_FRONTEND_QUALIFIED` in `webCaptureHost.ts` is
  `true`, together with native's `WEBSITE_SERVICES_QUALIFIED`. The window offers `web.capture` only
  in the desktop app. An ordinary browser never does, and a dev browser does only when a test
  installed the synthetic fetch fixture. In a build with the switches off, the bundled recipe "Save
  from website" is listed but off, and neither entry appears.
- **Entry points.** "From website…" in the sidebar, under From extension, and "Save from website…"
  in the palette (Note group). Each shows only while a website command can run, so turning the recipe
  off removes the entries; saved notes stay ordinary notes.
  - One website command opens directly. Several open the extension chooser, listing only them.
  - From extension…, Settings' Try it and Adapt's Try open the same dialog for a website command.
- **The run.** The dialog's Save is the recipe's run through the session controller (`submit` with
  the dialog's page): one guarded create per opening, whose bytes are the verified note
  (`webCaptureContentFor`).
  - Check again asks about that same write and never writes again.
  - The note opens in the pane reserved when the dialog opened; an unsaved page there is saved
    first, never replaced unsaved.
  - Closing cancels the opening; stopping an unconfirmed write abandons it. A workspace switch or the
    recipe turned off revokes the dialog and stops any fetch.
- **Undo.** Under the saved note's header, a notice says where it came from and offers Undo while the
  note is still exactly as saved. Undo moves the note to Trash through the note's own save lane.
  The notice ends with the next change to the note, once its pane has left it, or on a workspace switch.
- **Saved before.** Checked against the `source` of every listed note; while the list is still
  loading, the notice says an earlier copy might not show.
- **Words.** Every label comes from `leadinglight.webCapture.*`, or from the extension run dialog's
  keys where the words are shared (`webCaptureLocale.ts`). The capability reads "fetching one web page
  you enter, only when you choose Fetch".

### Browser testing

The browser has no website fetch. A test may install the synthetic fixture
(`tests/helpers/webCaptureFixture.ts`) before the page loads. It works on the dev server, in the
in-memory mock vault, outside native only.

- The fixture answers pages under `https://fixtures.leadinglight.invalid/` from its own text; any
  other address fails as an unknown host. It never opens a connection.
- With it, the page offers `web.capture`, and the bundled recipe is on by default.
- `tests/smoke/web-capture.spec.ts` covers the flows.
