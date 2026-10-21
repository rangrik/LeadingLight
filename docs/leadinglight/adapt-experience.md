# Adapt: asking for an extension

Adapt turns a request in your own words into an E1 extension you review and turn on yourself. It
asks Codex only when you press Send, and only for a package in the extension format
(`extensions-catalog.md`). Everything after that is the ordinary E1 path: the package is checked,
previewed, turned on and run by LeadingLight (`extensions-experience.md`). Adapt never edits a note,
turns anything on by itself, or retries anything by itself.

## Where things are

- **New page → Adapt LeadingLight…** in the sidebar, and **Adapt LeadingLight…** in the command
  palette (main window only). The sidebar entry is Adapt’s one status: **Adapting…** while a request
  runs, **Extension ready** when a reply arrived while the dialog was closed.
- **Settings → Extensions → Ask for an extension**, and **Adjust…** on any extension with a readable
  version, which starts a fresh request with that version attached.
- One dialog. Closing it, or **Keep writing**, keeps what you typed and lets a request you sent
  keep running. Opening Adapt is the first time LeadingLight asks the native host anything about
  it; nothing is checked at start-up.

## Connecting

Adapt shows what the host reports and nothing else. When Codex is not installed, not a version
LeadingLight has checked, or not yet qualified, the dialog says so and there is no composer.
Qualified means Codex works only from the context you explicitly send and has no effective access
to your files or to commands. It may still ask to use a tool; such a request is refused and fails
the turn, and is never granted. **Sign in with ChatGPT** starts a separate sign-in in
your browser, for LeadingLight only; no email, plan or token is shown. Claude is shown as not
available in this version. Without the desktop host (the browser build), Adapt says Codex is
unavailable.

Signing out stops anything running. When that work is not yet proven ended, Adapt says it is still
stopping and asks again for a while; a new sign-in waits for it. A visit closed when you switch
workspaces is handled the same way, without holding up what you are writing.

## Asking

Type a request, or start from one of three examples. Attachments are chips you can see and remove:

- **Pasted text…** — text you paste into the dialog.
- **Current page** — the page in front when you click, after its pending text is saved. If a
  different page comes to the front while it saves, or the save fails, nothing is attached.
- **An existing extension** — that version’s package text. Attaching an ordinary extension makes
  the request a change to exactly that version, and records which version was on at that moment.

Under the composer, Adapt says what Send includes: this request, the earlier requests and replies
shown in this conversation (when there are any), LeadingLight’s extension guide and the attached
chips. Nothing else from your workspace, and never a file path. Earlier replies may quote things
attached before; removing a chip does not remove those, and **New request** leaves them out.

Only host-known phases are shown: Sending, Working, Checking it, Stopping. **Cancel** stops the
request; “Stopped” is shown only once native confirms it. A failure, a refusal or a stop puts your
request and chips back in the composer, and **Try again** is a new Send.

## Replies

Codex’s words are shown as plain text. A reply is one of:

- **One question**, with up to three answers; choosing one puts it in the composer to send.
- **Not possible with extensions**, with an alternative you can put in the composer.
- **A draft**, followed by a box headed **Checked by LeadingLight**. That box is LeadingLight’s own
  check of the package (the E1 validator and review), never the model’s description: whether it is
  a new extension, a new version of the one you attached, or a new extension based on one that
  comes with LeadingLight; what it does; what it needs that this version can’t offer.

A draft that fails the checks can only be changed. A change to an extension that is no longer
stored, or whose version on is no longer the one recorded with the request, is refused.

## Trying it

**Preview and turn on** stores the draft and opens the E1 preview, which writes nothing; Adapt steps
aside meanwhile. **Turn on** there is the only activation, and it succeeds only if what is on is
still what the request recorded. A preview left open across a workspace switch turns nothing on.
**Keep for later** only stores it; it then waits in Settings → Extensions.

Once on: **Try it** opens that exact version’s form (if another version is on by then, it does not
open), and the note is made through the normal E1 form. **Undo** turns off a new extension, or turns
the earlier version back on; notes it made stay. The version you turned on becomes the visible
extension chip of your next request, so you can keep changing it in the same conversation.

## History and saving

Conversations stay on this computer, per workspace, up to 50; **Earlier requests** reopens one and
**Delete conversation** removes it here (anything already sent can’t be taken back). When native
reports that a conversation is not saved, or not confirmed on disk, Adapt says so and offers
**Save again**, which writes locally only and sends nothing.

## Tests

Controller ordering (one Send at a time, unconfirmed cancels, monotonic reads and status, late
history picks, stopping closes and sign-outs, local saving), candidate identity and expectations,
the current-page seam and the dialog with the real E1 hooks are covered by Vitest in
`src/leadinglight/adapt/`. `tests/smoke/leadinglight-adapt.spec.ts` runs the browser build with and
without the explicit deterministic Adapt fixture (`adapt-browser.md`), which proves the UI only; the
note is created by the real E1 disk bridge on a disposable vault.
