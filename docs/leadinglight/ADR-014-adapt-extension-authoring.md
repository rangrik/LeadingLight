# ADR 014: Adapt, conversational authoring of E1 extensions

## Decision

Adapt lets the person describe an extension in their own words and get back an E1 package to
review. It is a narrow authoring channel, not a general agent:

- **What it produces.** It asks a provider for exactly one of three replies: a draft E1 package, one
  question, or a plain "not possible with extensions".
- **What decides.** The draft is untrusted data. LeadingLight's existing E1 validator, preview,
  activation, run form and undo decide everything that happens to it.
- **When it asks.** Only an explicit Send asks the provider, and only an explicit Connect starts the
  separate sign-in.
- **What it never does.**
  - Nothing is adopted automatically: no import, activation or note edit happens because a reply
    arrived.
  - Nothing patches the app core.
  - No JavaScript, HTML or package code is ever run.

The person-facing behaviour is in [adapt-experience.md](adapt-experience.md). E1 itself is in
[extensions-experience.md](extensions-experience.md) and [ADR 013](ADR-013-local-extensions-experience.md).

## What a Send carries

**Each Send starts a fresh, bounded provider thread.** It carries exactly:

- the request;
- the text of each attachment the person can see in the composer: pasted text, a snapshot of the
  page in front taken on their click, or one extension package;
- for each earlier turn of this conversation that ended with a reply, its request and reply text;
- the identity of the package being changed;
- LeadingLight's built-in extension guide.

**No extra context is added:**

- the host does not add vault paths or read notes the person did not attach;
- nothing comes from a hidden provider session.

Names or paths the person includes in their request or attached text remain part of that explicit
context; this boundary is about access, not silently rewriting their words.

**Consequences:**

- **Removing a chip.** Its text is not in the next Send.
- **Earlier replies are resent as visible text.** They may quote text attached earlier. The dialog says so, and
  **New request** leaves earlier turns out. Nothing claims that already-sent text is erased.
- **The current page.** It is bound to the exact page clicked. If another page or vault comes to the
  front while it saves, nothing is attached.

## From draft to extension

The draft's package text goes through the same E1 trusted path as a pasted package:

- **Import and preview.** E1 import checks the exact bytes. The effect-free E1 preview shows what it
  does, and Turn on in that preview is the only activation.
- **Trying it.** Try it opens the E1 form, for that exact adopted version only.
- **Undoing it.** Undo turns a new extension off, or turns the earlier version back on. Notes it made
  are never changed.

**Capabilities are E1's own:** `document.create` and `document.open`. A draft needing more is shown as
unavailable, with what it needs, and cannot be turned on. Highlight commentary (selection reading,
association, append) and web capture are future capabilities. They are not shipped here, and Adapt
cannot grant them.

**A change to an existing extension is a revision**, bound when the person attaches that extension:

- `packageId` and the exact `baseSha256`;
- `expectedActiveSha256`, the version that was on at that moment, or `null` when none was.

**The revision is stored with the request and used unchanged:**

- **Version.** The draft must keep the id and raise the version.
- **Stale.** It is stale when what is on now differs from the recorded value.
- **Turn on.** Activation uses E1's compare-and-set against that same recorded value, so a version
  turned on or off elsewhere is refused, not replaced.
- **Undo.** Undo restores that same accepted value.

**Bundled extensions.** Those under the reserved `leadinglight.` prefix are never replaced; a change
to one becomes a new ordinary extension.

**Following up.** After a successful Turn on, the adopted version becomes the visible extension chip
of the next request, so the same conversation can go on revising it.

## Identity and visits

The UI controller (`src/leadinglight/adapt/`) holds one native visit per vault visit. Leaving the
vault or a change of account ends the visit, and anything that answers later for it is ignored.

**One Send at a time.** Its attempt and turn id are fixed before anything is awaited, and the attempt
lasts until the turn has a terminal outcome.

**An unanswered Send.** It is cancelled by its own turn id, and is reported "not sent" only after
native proves that id can no longer start.

**Every adoption step is bound.** Store, the preview's Turn on, Try it, Undo and their late completions
are each tied to the originating Adapt visit and E1 visit. Package ids are never treated as vault
identity.

## Native boundary and storage

The desktop host is `src-tauri/src/leadinglight_adapt/`. Its 13 fixed commands are in
`src-tauri/src/commands/adapt.rs`, and they are LeadingLight's own commands. Inside the host:

- visits, admission and turn state are separate from local storage;
- every reply is read by strict readers against the frozen contract
  (`src/leadinglight/adapt/adaptContract.ts`);
- the host never reads a note for Adapt, and never imports, activates or edits anything.

The host is described in `adapt-native.md`.

**Conversations are local.** They are stored per vault under LeadingLight's local app data, beside its
settings:

- not in the vault;
- not in workspace backups.

**Saving is reported as it is.** When native reports a conversation not saved, or not confirmed on
disk, the UI says so. Save again writes locally and never sends.

**Stopping is reported truthfully.** Cancel, closing a visit and signing out close admission at once.
They answer `stopping` until all provider work is proven ended. Then:

- **Unproven.** A provider return that cannot prove its work ended, or a panic in the provider, never
  becomes a confirmed stop. The turn stays `stopping` and admits nothing.
- **After a restart.** It shows as stopped and unconfirmed.
- **In the UI.** An unconfirmed stop or close is shown as unconfirmed, never as stopped. It is asked
  again by its own identity, boundedly, and the person can keep writing meanwhile.

## Providers

**Codex first, through its own app server.**

- **Process.** It runs as a separate local process with a private `HOME` and `CODEX_HOME` under
  LeadingLight's app data, and an allowlisted environment.
- **Credentials.** No developer or personal Codex credentials or settings are reused.
- **Sign-in.** Connect opens the provider's own ChatGPT sign-in for LeadingLight only. No email, plan or
  token reaches the interface.
- **Current design.** It pins Codex 0.162.1 with gpt-5.5, under a qualified effective-authority
  design:
  - the model works only from the explicit context in the Send;
  - it has no effective file or command access;
  - it may advertise a tool request, which is refused and never granted.

  Whether a given binary and transport qualify is the provider documentation's to state; see
  [adapt-provider.md](adapt-provider.md). Until a build's provider is qualified, Codex reports
  unqualified, no composer is shown, and nothing is sent.

**Claude is shown as unavailable.** There is no assumed third-party Claude.ai authorization, no API
key setup and no paid or API-billing fallback.

## Verification and limits

- **Unit and controller coverage.** Vitest covers ordering, identity, expectations, the current-page
  seam and the dialog over the real E1 hooks.
- **Browser coverage.** Headless browser checks run against an explicit deterministic fixture
  ([adapt-browser.md](adapt-browser.md)). That proves the interface only, never a live provider.
  Without a fixture, the browser build reports Codex unavailable.
- **The native desktop window is intentionally not qualified by interactive QA.** This follows the
  owner's browser-only preference.
- **Live authentication and inference are not qualified by these offline checks.** The pinned
  runtime passed the separate loopback qualification; it does not establish live account behavior.

Adapt is the one owner-authorized remote flow; the inherited upstream AI features stay blocked. The
policy is in [local-only-runtime.md](local-only-runtime.md).
