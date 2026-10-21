# Adapt: the native host

Adapt is a small local chat. It asks a provider for one E1 extension package, a question, or a
plain "not possible", and nothing else. This page covers the desktop host:

- what it sends;
- what it keeps;
- how turns start and stop;
- what is not yet proven.

The transport contract is frozen in `src/leadinglight/adapt/adaptContract.ts`, including amendments
2, 3 and 4. The code is in `src-tauri/src/leadinglight_adapt/`, and the 13 commands are in
`src-tauri/src/commands/adapt.rs`.

## Providers

**Codex** is the only provider, run as its own `app-server` over standard input and output.
[adapt-provider.md](adapt-provider.md) is the authoritative description of the provider adapter
(`codex/`): the pinned build and model, the private folders and environment, the configuration, the
checks before anything is sent, how a turn is stopped, and the offline qualification. In short:

- **One build.** `codex-cli 0.162.1`, the npm native payload, used only with its exact pinned size
  and SHA-256. Any other build is reported as an unsupported version and is never run, not even for
  `--version`. Nothing is installed or updated.
- **One model.** `gpt-5.5`, checked on every thread.

**Claude** is reported `notAuthorized`. There is no other provider and no paid fallback.

**Signing in.**

- Only **Connect** starts a sign-in. It opens the provider's own ChatGPT sign-in page, and only on
  `https://auth.openai.com/`. Reading status never signs anyone in.
- The sign-in is LeadingLight's own: it is stored in a private provider home under LeadingLight's app
  data, never the person's own Codex folder.
- No email, account id, plan or token ever reaches the app's interface.
- The disclosure the person accepted is recorded locally, by version (`adapt/consent.json`).
- An API-key or any other non-ChatGPT sign-in is `refused`, and is never used.
- Cancelling a sign-in (`adapt_cancel_connect`, contract amendment 4) answers one of three things:

  | Answer | Meaning |
  |---|---|
  | `cancelled` | The sign-in was cancelled, its work is proven ended and its credentials cleaned up. |
  | `notConnecting` | There was no sign-in, and no cancellation is still unresolved. |
  | `unconfirmed` | No sign-in can complete any more, but its work ending or its cleanup cannot be proven. It is never reported as cancelled. |

  The provider status stays authoritative and keeps blocking Send. Nothing is retried, and nothing
  signs in again on its own.

## The provider process

[adapt-provider.md](adapt-provider.md) has the exact details. In short:

- **Private folders.** Under LeadingLight's app data (`adapt/provider/codex/`): `home/` as `HOME`,
  `home/codex/` as `CODEX_HOME`, `tmp/` as `TMPDIR`, and `run/` as the working folder. `run/` is always
  empty and never a vault.
- **Environment.** Exactly `HOME`, `CODEX_HOME`, `TMPDIR`, `PATH`, `LANG`, `SHELL`, and a synthetic
  `USER` and `LOGNAME`. Nothing is inherited: no keys, proxies, provider URLs, Node or shell settings.
  It never reads the person's own Codex folder or sign-in.
- **Process group.** It runs in a process group of its own. The whole group is killed and proven
  gone before it is reaped; when that cannot be proven, the turn is `Unconfirmed` (below).

## What a Send sends

Exactly these, and nothing else:

- the person's request;
- the text of each attachment they chose (pasted text, a page snapshot, or an extension package);
- for each earlier turn they name, its request and reply text;
- the identity of the package being changed;
- the built-in extension guide, `docs/leadinglight/extensions-catalog.md`, sent as the thread's
  instructions.

The variable parts travel as one JSON document, and the model is told they are data.

Native never reads a note for Adapt. A vault path, file name or note the person did not attach is
never sent.

Every Send starts a fresh, ephemeral provider thread, so a removed attachment cannot survive in
hidden provider state. Text sent in an earlier turn, and resent because the person named that turn,
is of course not erased.

**Before any of the person's text is sent**, three checks run, described in
[adapt-provider.md](adapt-provider.md):

1. A preflight of the private folders and configuration.
2. A gate on what the started runtime loaded.
3. A check of the new thread. It must report:
   - the pinned model;
   - the `adapt` permission profile, with a read-only sandbox without network;
   - the empty working folder and no instruction sources;
   - approvals routed back to LeadingLight.

A failed preflight or gate reports Codex `unqualified` until a later check passes. A thread that is
not as qualified reports it `unqualified` until the app restarts. Either way, none of the person's
text was sent.

**During a turn:**

- **What the model is offered.** The pinned runtime offers the model `request_user_input` and a
  freeform `apply_patch`, and nothing else, so "Codex has no tools" is not true.
- **Why that grants nothing.** Adapt's instructions tell the model not to use any tool, and
  containment makes them powerless:
  - `request_user_input` is refused by the runtime itself;
  - a patch to an existing file outside `run/` fails, because its read is denied;
  - a patch that adds a file asks for write authority, which Adapt never grants.
- **What stops a turn as `toolRefused`.**
  - **Any proposed patch.** Codex stays qualified.
  - **Anything the qualification never saw**, such as another item kind, a command, hook, process,
    file-system or MCP event, or another request. Codex is then `unqualified` until the app restarts.
- **Requests.** A pending request is answered with its own refusal only after the turn is proven
  interrupted. Otherwise it is left unanswered, and the process group is killed.
- **The boundary.** It is this composition: denied reads, plus a host that never grants authority
  and stops the turn.

**The answer.** Only the final message of a turn that completed successfully is read. It must be one
JSON object of the schema below: no unknown or repeated fields, plain prose, and within the bounds.
Anything else is `invalidOutput` or `outputTooLarge`. Nothing is repaired or retried.

```json
{ "kind": "candidate | question | unsupported", "message": "...", "packageText": "... or null", "choices": ["..."], "alternative": "... or null" }
```

A candidate's `packageText` is untrusted text. The app parses it, and the E1 registry validates it
again before any preview. Native never imports, activates or edits anything.

## Turns, cancelling and boundaries

**Admission.**

- One turn runs at a time in a conversation.
- The interface chooses the turn id. A cancel can name it before the Send arrives, and that Send is
  then refused `cancelled`.
- Reusing an id is refused `replayed`.

**What stops a turn.** Cancel, closing the visit, a window reloading or closing, signing out, a
changed account, and quitting the app. Each one closes admission at once, then asks the provider to
stop: an interrupt, then a kill.

| Answer | Meaning |
|---|---|
| `stopped` | The provider work is proven ended. |
| `stopping` | Not yet proven; poll until it is. |
| `finished` | The turn ended before the cancel, and its outcome stands. |

An answer that arrives after admission closed is never admitted. The transcript records the stop,
with whether it was proven.

**Work that cannot be proven ended.** A provider can return without proving that all of its work for a
turn ended: for example, its process group could not be killed and reaped. The host treats a panic in
the provider the same way. The turn then stays open for the rest of the process:

- its phase is `stopping`;
- no outcome entry is written, and nothing from it is admitted;
- its conversation takes no other turn (`busy`) and cannot be deleted (`running`);
- cancel, close and disconnect waiting on it answer `stopping` at once, never `stopped`, `closed` or
  `disconnected`.

After a restart, it shows as stopped (`appClosed`), unproven.

**Account changes.**
- A disconnect through LeadingLight records `accountChanged` for the turns it stopped.
- If the account changed in any other way while a turn ran, the turn's answer is not admitted, and it
  too ends `accountChanged`.
- A turn that failed on its own keeps its own reason. For example, its sign-in was refused, and the
  provider marked itself signed out while ending it: that is `notConnected`.

**Cancel scope.** A cancel touches only the named conversation's turn. It works through any open visit
of that conversation's vault, from the calling window. A turn with the same id in another
conversation is untouched.

**Closing a visit.**
- **`closed`** is the answer once every turn the visit started is proven ended.
- **`stopping`** is the answer until then. The visit stays closing: it answers nothing but close and
  admits nothing. Asking again with the same id answers `closed` once its turns have ended.
- A window that reloads or closes ends its visits at once, without waiting.

**Disconnecting.**
1. Provider admission closes first, before running work is collected.
2. Every running turn is cancelled (`accountChanged`).
3. The host waits for that work, then signs out.

During all of it, no Send is admitted. That includes a Send that read provider status before the
disconnect began: a host generation number catches it.

The answer is `disconnected` once every turn is proven ended, `stopping` if signed out but not yet
proven. A sign-in that began before a sign-out can never complete as connected.

**Phases.** Only phases the host knows are reported: `sending`, `working` (the provider started the
turn), `checking` (reading the final answer) and `stopping`.

**Revision numbers** come from one counter per process, so they only increase. A poll that names the
current one gets `unchanged`.

## What is kept

Conversations are stored in `adapt/conversations/<hash of the vault path>/<conversation>.json`, under
LeadingLight's local app data:

- never in a vault, and never sent anywhere;
- written atomically: a synced temporary file, one rename, then the folder is synced. A failed rename
  or unlink changes nothing. A failed folder sync after one is reported as a change that is in place
  but not confirmed durable, never as no change;
- private to the user, with folders `0700` and files `0600`;
- each record read within 16 MiB, and checked against the contract's rules. A record that breaks a
  rule is left on disk untouched and not shown.

**What a record holds.** Each request and its outcome: the request text, attachment summaries (kind,
label, size and SHA-256, never the attachment text), the named earlier turns, the package being
changed, and the guide version.

**The package being changed** is `packageId`, `baseSha256` and `expectedActiveSha256` (contract
amendment 3). The last is the version that was active when the person attached the extension, or
`null`. It is required, stored exactly as given and returned unchanged, so the UI's activation
compare-and-set uses that original value, never one re-read later. It is never sent to the provider,
and a record without it is unreadable.

**Retention.**

- At most 50 turns per conversation; then Send answers `conversationFull`.
- At most 50 conversations per vault. A conversation with any entry is never removed automatically.
  At the limit, only an empty, never-sent conversation may be reclaimed; otherwise New answers
  `conversationLimit` until the person deletes one.

**Whether it is saved.** Every snapshot carries `storage`:

| `storage` | Meaning |
|---|---|
| `saved` | Written and synced. |
| `unconfirmed` | Written, but the folder sync failed. |
| `unsaved` | The write failed. |

What happens when a write fails:

- **An answer.** It stays shown and in memory as `unsaved`. It is never dropped when a visit closes,
  and the app tries one more local save when it quits.
- **A request.** If the request cannot be written, nothing is sent (`storageUnavailable`). If it was
  written but not synced, it is in place, so its turn runs, and the conversation says `unconfirmed`.
- **A delete.** A delete whose file is gone answers `deleted`, even if the folder sync failed.

`adapt_save_conversation` writes the conversation as shown again. It is local only: it never contacts
a provider and never repeats a turn.

**After a restart**, history comes back without contacting any provider. A turn that was still
running when the app quit shows as stopped (`appClosed`), unproven.

## Verification and limits

- **The pinned runtime passed offline qualification.** The ignored test runs Codex 0.162.1 through
  the production adapter against a loopback stand-in for the Responses API. All 67 checks passed,
  including usable E1 candidate admission, scoped context, denied foreign reads and confirmed
  interruption with process cleanup. See [adapt-provider.md](adapt-provider.md).
- **No live provider has been qualified.** The real ChatGPT provider, a real sign-in, and network use
  during sign-in or account reads are not exercised offline. The `openai` provider id is covered by
  the same thread and gate checks, not by an offline run.
- **Host tests use a scripted provider**, and provider unit tests use a scripted app-server. Neither
  is the real runtime.
