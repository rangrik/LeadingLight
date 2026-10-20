# ADR 013: local extensions experience (E1)

## Decision

Optional local extensions get one UI controller, one native session per vault visit, standard
dialogs and two entry points beside the existing creators. The frozen contract
(`extensionContract`, `extensionSchema`, `extensionRecipe`, `extensionApi`, `proposalContract`)
stays unchanged; this ADR covers how the app uses it. Packages remain data: the host writes every
sentence, every piece of Markdown structure and every effect.

The additive `src/leadinglight/extensions` UI modules own the feature: strict reply readers and a
closed-table transport, the host Markdown builder, a non-React controller, two hooks and the
Settings, Preview, Import, Chooser and Run dialogs. The integration surface is narrow: one App
seam per boundary (switch, window close, backup), a Settings section after Workflow, one sidebar
entry under From template, one palette command, and an optional caller guard on the existing
pane reservation.

## Transport and text

The transport calls only the declared extension and proposal command names, from a fixed table;
no caller supplies a command name, so package data cannot choose what is invoked. Every reply is
read against exact keys and bounds. A rejected call or an unexpected shape is no reply (`null`),
never success and never proof that nothing was written. Submitted proposals are kept so a query
reply is validated against the exact proposal; querying never submits.

Markdown for a composed document is built by the host from typed blocks: one level-1 title, then
headings, paragraphs, quotes and lists separated by blank lines, with every text value through the
accepted literal encoder in its documented contexts. The page digest is SHA-256 of its UTF-8
bytes. The filename is the app's existing title slug, bounded to one 255-byte segment and never a
Windows device name. A blank composed title falls back to the command's own title. A captured
passage (`source`) block is refused in E1 instead of guessing association serialization.

## Sessions, runs and recovery

A visit is created when a vault becomes ready in the main window and ends when another vault is
shown; A, then B, then A is three visits. Identity is the visit object, never the path. The
visit's session opens only on the first Create, so listing, previews and Settings make no session
calls. Leaving (vault switch, window close, backup) stops admissions synchronously, then waits for
native to confirm the session closed, with a bounded wait. An unconfirmed close refuses the
transition, publishes a visible `unsettled` state and is asked again for the same session on the
next attempt; nothing resumes past it.

Each explicit Create is one run: a fresh invocation, admission, folder handle and operation id.
A run opening in the controller owns its writes. Once a proposal may have reached native it is
recorded as the opening's pending operation; until a query answers with a definite no-write, every
further Create answers that same uncertain operation without allocating anything. A committed
result is final for the opening; abandoning retires it. Recovery honours the recipe's own open
intent: a recipe without `openCommittedResult` never navigates after a recovered commit either.

The committed page opens only in the pane reserved when the dialog opened. The run's liveness is
passed through the reservation to the moment of placement, after the outgoing page's save, with
the reservation's own vault-session, pane and request checks. A revoked, cancelled or moved-on run
places nothing; the note is still reported as created with its location. Without a caller guard
the reservation behaves exactly as before.

## Surfaces

Settings → Extensions lists stored packages from the registry, with text status chips, Preview,
version review, behaviour-only rollback (one question) and an immediate switch. First activation
is always through the preview's Turn on; re-enabling the same reviewed version asks nothing.
Valid packages needing capabilities this version lacks stay visible and unavailable. Import is
paste, Check (local validation first, the validator's own JSON Pointer shown), then the same
preview; it never activates. The section states that workspace backups do not include extensions
or their on/off state yet.

Dialogs carry the Settings portal marker, stack above Settings and keep Escape from reaching the
Settings window listener, so only the topmost surface answers keys. Preview is synthetic: pure
composition from sample answers, the exact bytes rendered by the passive template preview.

## Limits

No passage capture, association, append, providers, network or package code. Extension
preferences and package blobs are outside the existing backup format. Visits that end without a
transition gate (a vault change outside the switcher) are closed without blocking; an unconfirmed
close there is asked again at the next transition but does not block runs in the new vault. The
remembered folder per command is a local UI default, offered only while the host still lists that
folder, and is bound and checked natively for every run.
