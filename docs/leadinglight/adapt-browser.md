# Adapt in the browser: no provider, or an explicit test fixture

In the desktop app, the native commands in `src-tauri/src/leadinglight_adapt` implement the frozen
transport contract `src/leadinglight/adapt/adaptContract.ts`. In the browser, the same 13 commands are
answered by `src/mock-tauri/mock-adapt.ts`.

That module serves both browser routes:

- **`mockInvoke`**, used in plain browser development;
- **`window.__mockHandlers`**, which the desktop fixture harness calls directly.

Adapt commands never reach the dev vault server or the network.

This is test infrastructure for browser checks. It is not native authority. Passing browser checks
does not establish provider isolation, native durability or window ownership.

## Without a fixture: unavailable

This is what every page gets unless a test explicitly installs the fixture:

| Command | Answer |
|---|---|
| Provider status | Codex `unavailable/notInstalled`, with no version claimed; Claude `unavailable/notAuthorized` |
| Connect, Disconnect | `refused/unavailable` |
| Open visit | `refused/storageUnavailable`: the browser keeps no local Adapt data, so nothing can be shown as saved |
| Every visit-scoped command | `unknownVisit` (close answers `unknown`) |

There is no fake connected state, no request forwarding, no credential or provider file, and no
inference.

## The fixture

The fixture is test-only and must be turned on explicitly:

```ts
import { installAdaptFixture, releaseAdaptFixture, adaptFixtureSent, adaptSamplePackage } from '../helpers/adaptFixture'

await installAdaptFixture(page, { fixture: 'leadinglight.adapt-fixture/1', connects: [{ result: 'connected' }], turns: [...] })
await openFixtureVaultDesktopHarness(page, vault)   // after installAdaptFixture, which must precede navigation
```

**How it is installed.** `installAdaptFixture` writes the script into `sessionStorage` under
`leadinglight.adaptFixture`, once per tab.

**When it is read.** The app reads the key once, at page load, and only on the Vite dev server
(`import.meta.env.DEV`). A production bundle never reads it.

**A broken script.** A script that breaks any rule below makes Codex `unavailable/failed`, never a
default success. Visits are then refused as above, and a console warning names the format.

### Script

```ts
{
  fixture: 'leadinglight.adapt-fixture/1',
  account?: 'signedOut' | 'connected',      // where Codex starts; default 'signedOut'
  connects?: Array<{ result: 'connected' | 'failed' | 'accountNotSupported' | 'browserUnavailable', hold?: boolean }>,  // ≤ 16
  turns?: Array<                                                                                                        // ≤ 64
    ({ reply: AdaptReply } | { output: string } | { failure: AdaptFailure, resetsAt?: string | null })
    & { hold?: boolean, slowStop?: boolean, outcomeSave?: 'unsaved' | 'unconfirmed' }>,
}
```

**Which step runs.** Each explicit Connect takes the next `connects` step. Each **admitted** Send
takes the next `turns` step. A refused Send takes nothing, so counting Sends shows there was no
automatic retry.

**Unscripted calls fail.** A Connect with no step left ends `signedOut/lastConnect: 'failed'`. A Send
with no step left ends `failed/providerFailed`.

**How each step kind is read.**

- **`reply`** is the model's answer. It becomes the provider's five-key schema envelope and is read
  as native reads a final answer:
  - over a bound, such as a package over 128 KiB, a message over 600 characters or a choice over 120,
    it becomes `failed/outputTooLarge`;
  - any other break becomes `failed/invalidOutput`.

  The package itself is not validated here. A candidate that is not a valid E1 package still
  arrives as a reply, for the UI's E1 parser to refuse.
- **`output`** is the raw final text, read the same way. Text over 256 KiB is `outputTooLarge`.
- **`failure`** is recorded as written.
  - `resetsAt` is kept only for `usageLimit` with an ISO UTC instant.
  - `notConnected` also signs Codex out, as native does.

**Options on a turn.**

- **`hold`** keeps the turn `working` until it is released.
- **`slowStop`** makes a stop unproven until the late result arrives, either at release or from its
  timer. That result is then discarded.
- **`outcomeSave`** makes the local write of the turn's outcome fail (`unsaved`) or go unsynced
  (`unconfirmed`). The outcome stays visible either way.

### Timing

The fixture reports only host-known phases.

**Connect.** The call answers `started` and status shows `connecting`. The scripted result follows
150 ms later, or at release if the step is held. `browserUnavailable` is refused at once.

**Turn.** The phases run on a fixed schedule:

1. `sending` on admission;
2. `working` at 150 ms;
3. `checking` at 300 ms;
4. the outcome at 450 ms.

A held turn stays `working`.

### Controls

`window.__leadinglightAdaptFixture` exists only while a fixture is active.

- **`releaseAdaptFixture(page)`** finishes every held Connect and every held or stopping turn, and
  answers how many.
- **`adaptFixtureSent(page)`** answers exactly what each admitted Send gave the fixture provider in
  this page load, as `{ turnId, provider, request, attachments, earlierTurns, changePackage, guide }`.
  It keeps the last 16. Each envelope is built only from that Send's arguments and the visible request
  and reply text of the turns it names. No earlier attachment is carried along. As in native's
  prompt, `changePackage` is `{ packageId, baseSha256 }` only.
- **`adaptSamplePackage(id, version, variant)`** answers valid E1 package text: one form field, then
  one new note in a chosen folder. For a revision candidate, use the same id with a higher version.

The guide recorded with each request is `extensions-guide-fixture`. The fixture sends no real guide
and claims none.

## Rules mirrored from the contract and corrected native host

**Arguments.** Arguments must have exactly the typed keys. Anything else rejects the call, as native
deserialization does, and the UI reads the result as no reply.

**Send.** Checks run in native's order:

1. `unknownVisit`
2. `unknownConversation`
3. `checkSendArgs`
4. `cancelled`, when the turn id was cancelled before its Send arrived
5. `replayed`
6. `busy`
7. `conversationFull`
8. `providerUnavailable`, then `notConnected`
9. `invalidRequest`, when an included turn is not a finished turn of this conversation
10. `tooLarge`, when the payload is over 512 KiB counting the included turns

**A revision** has three fields in the request and two in the provider envelope:

- **In the Send and in the stored request entry:** `{ packageId, baseSha256, expectedActiveSha256 }`.
  `expectedActiveSha256` is the version that was active when the person attached the extension, or
  `null` when none was. It is stored and returned exactly as given, including across a reload,
  because the UI's activation compare-and-set must use that original value.
- **In the provider envelope:** `changePackage` carries only `packageId` and `baseSha256`.
  `expectedActiveSha256` never leaves the host.
- **When it is malformed:**
  - a missing or extra key, or a value that is neither a string nor `null`, rejects the call, as
    native deserialization does;
  - a string that is not a lowercase SHA-256 is refused `invalidRequest` by `checkSendArgs`;
  - nothing is admitted or sent either way.
- **Older stored state.** A stored request whose revision lacks the field is unreadable, so the
  fixture starts fresh rather than guessing it.

**Cancel.** Cancel affects only the named conversation's turn, through any open visit of its vault.
The same turn id running in another conversation is untouched.

- **A running turn.** Admission closes at once. Cancel answers `stopped` once proven, or `stopping`
  while a slow stop is pending.
- **A turn id never admitted.** Cancel answers `stopped` and records the id, so that Send is then
  refused `cancelled`.
- **A turn that already ended.** Cancel answers `finished`.

**Close visit.** Close cancels the visit's turns (`visitClosed`).

- **While work is unproven.** Close answers `stopping`, and the visit answers nothing but close:
  every other call treats it as `unknownVisit`.
- **Repeating close.** The same call answers `stopping` until the work is proven ended, then
  `closed`, then `unknown`.
- **A ninth open visit.** Opening a ninth visit in a page closes the oldest.

**Disconnect.** Admission closes first: Codex is signed out, so every Send is refused
`notConnected`. Then every running turn is cancelled (`accountChanged`). Disconnect answers
`stopping` until all are proven ended, and asking again then answers `disconnected`.

**Conversations.**

- **List.** Newest first, then by id.
- **New.** At 50, only an empty, never-sent conversation is reclaimed. Otherwise the answer is
  `conversationLimit`.
- **Delete.** Refuses `running` while a turn runs.
- **Read.** Answers `unchanged` when the known revision is current.
- **Revisions.** One counter that only increases.
- **Titles.** The first non-blank line of the first request.
- **Attachments.** Kept only as `{ kind, label, bytes, sha256 }`.

**Storage.** Every snapshot carries `storage`.

| Value | When |
|---|---|
| `saved` | The conversation's last write succeeded |
| `unsaved` | The outcome write failed (`outcomeSave: 'unsaved'`, or `sessionStorage` refused it). The outcome stays in memory, survives closing and reopening the visit, and is never re-requested |
| `unconfirmed` | `outcomeSave: 'unconfirmed'` |

- **`saveConversation`.** Writes the conversation as shown, locally only, and answers how that went.
  It never contacts the provider. Each storage change moves the revision on, so a poll sees it.
- **A later Send.** It writes the whole conversation, including an earlier unsaved outcome.

## Persistence and reload

The fixture's host state is kept in `sessionStorage` under `leadinglight.adaptFixture.state`. That
state is the account, the conversations with their storage flags, the script position and the
revision counter. A reload stands in for a native window reload, where the host process lives on:
history and the account are kept.

Not kept across a reload:

- **Visits.** Old visit ids answer `unknownVisit`.
- **A turn running at reload.** It ends `stopped`, with its stop reason or `visitClosed`, and
  `confirmed: true`, because its in-page provider ended with the page.
- **A Connect in progress.** It ends `signedOut/lastConnect: 'failed'`.

Other storage rules:

- **New contexts.** A new Playwright context starts clean.
- **Unreadable state.** State for another script, or state that breaks a rule, starts fresh.
- **Write refusals.** If `sessionStorage` refuses a write, these commands answer
  `storageUnavailable` and nothing changes: open visit, new conversation, delete, and Send (which
  sends nothing).

**Durability.** None is claimed. The fixture cannot model an app quit. `sessionStorage` is not
native local storage.

## What the fixture never does

- It never writes a note, imports or activates an extension, reads a vault file, reads or writes
  provider auth, or uses a real identity or the network.
- E1 creation in browser smoke tests still goes through the real disk bridge, on a disposable copy
  of `tests/fixtures/test-vault`.

## Tests

`pnpm exec vitest run src/mock-tauri/mock-adapt.test.ts` drives the host through `{ args }` exactly
as invoked. Every reply is read by the contract's own `parse*Reply` readers. The suite covers:

- **Without a fixture:** unavailability; the dev-server-only guard; broken scripts failing closed;
  and dispatch through `window.__mockHandlers` and `mockInvoke` with no fetch, including in a
  disk session.
- **Connect:** explicit Connect, and each sign-in ending.
- **Turns:**
  - phases and candidates;
  - questions and unsupported replies;
  - invalid and oversized answers;
  - a delayed run cancelled with its late result discarded;
  - cancel before admission;
  - cancel isolation across identical turn ids;
  - failures and limits without retry;
  - the fresh per-Send envelope and the payload bound;
  - revision candidates.
- **Revisions:** an explicit `null` and a hash both accepted and stored; the original expected
  active version kept through a reload; the provider envelope never carrying it; a missing, extra,
  mistyped or malformed value never admitted; and a stored revision without the field read as
  unreadable.
- **Local saving:** save failure, then close and reopen, then a local-only save, then reload; an
  unconfirmed outcome; a refused `sessionStorage`.
- **Visits and disconnect:** a closing visit answering `stopping`; disconnect answering `stopping`
  with admission closed.
- **Conversations and reload:** the conversation limit; reload recovery.
- **Arguments and helper:** strict arguments, and the helper's names and sample packages, which are
  validated by the real E1 parser.
