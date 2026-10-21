# Adapt: the Codex provider

Adapt's only provider is Codex, run as its own `app-server` over standard input and output. This
page covers what the adapter in `src-tauri/src/leadinglight_adapt/codex/` runs, what it checks, how
it stops, and how the pinned build is qualified. `adapt-native.md` covers the host around it.

## The build and the model

- **One build.** The native binary with SHA-256
  `74c6a6d263f40d65f99c27a815275f5b4ed0bcc2baecc396b4cf3255498bdfc0` (246,642,624 bytes),
  `codex-cli 0.162.1`, the npm `@openai/codex-darwin-arm64` payload.
- **One model.** `gpt-5.5`, named in the configuration and checked on every thread. No other model
  is ever substituted.
- **Finding it.** The adapter looks for the npm native payload under `/opt/homebrew`, `/usr/local`,
  `~/.npm-global`, `~/.local`, and the Node versions of fnm and nvm. It also looks at
  `/opt/homebrew/bin/codex`, `/usr/local/bin/codex` and `/usr/bin/codex`. A file is only measured
  and hashed, never run. The first file with the pinned size and hash is used, and it is checked
  again before every start. If it changes, it is verified again.
- **Anything else** is reported as an unsupported version and is never run, not even for
  `--version`. Nothing is installed or updated, and nothing falls back to another build.

## What the provider process gets

- **Private folders** under LeadingLight's app data (`adapt/provider/codex/`), by their resolved
  paths:
  - `home/` is its `HOME`;
  - `home/codex/` is its `CODEX_HOME`, which holds LeadingLight's configuration, the runtime's own
    files and LeadingLight's own sign-in;
  - `tmp/` is its `TMPDIR`;
  - `run/` is its working folder: always empty and never a vault.
- **Environment.** Exactly `HOME`, `CODEX_HOME`, `TMPDIR`, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`,
  `LANG`, `SHELL`, and a synthetic `USER` and `LOGNAME`. Nothing is inherited: no keys, proxies,
  provider URLs, Node or shell settings. It never reads the person's own Codex folder or sign-in.
- **Process group.** It runs in a process group of its own.
- **Invocation.** It is started as `codex app-server`, exactly as qualified.

## The configuration

`home/codex/config.toml` is written by LeadingLight before every start, unless it is already exactly
in place. It sets:

- `model = "gpt-5.5"`, `approval_policy = "on-request"` and `approvals_reviewer = "user"`;
- `default_permissions = "adapt"`. That permission profile denies the filesystem root, allows
  reading only the empty `run/` folder, and turns network off. No legacy sandbox setting is used:
  no `sandbox_mode`, and no per-thread or per-turn sandbox override.
- web search off, no project documents, `project_root_markers = []`, and no permission, app,
  collaboration-mode or environment instructions;
- no update checks, no history and no analytics, with credentials stored in the private file;
- every feature this build turns on by default, turned off;
- each bundled system skill turned off by its path.

`controls.rs` is the whole list.

## Checks before anything is sent

1. **Preflight, before every start.** The private folders must be real folders, not links, and
   `run/` must be empty. The private home may hold only:
   - the runtime's own files;
   - LeadingLight's configuration, byte for byte;
   - the runtime's helper links in `codex/tmp/arg0/codex-arg0XXXXXX/`, each one naming the verified
     binary exactly.

   The check refuses:
   - instruction, skill, hook, plugin, memory, prompt, rule or configuration sources;
   - any other link;
   - machine-wide configuration in `/etc/codex/`;
   - `AGENTS.md`, `AGENTS.override.md`, `.agents` or `.codex` in `run/` or any of its ancestors
     below the person's home.

   The person's home itself, and everything above it, is never looked at. The qualification shows
   those are not consulted.
2. **Gate, before any thread.** The started runtime is asked what it loaded. The check refuses:
   - any configuration layer other than LeadingLight's file and an empty system layer;
   - machine-wide requirements;
   - an effective configuration that differs from the above, including a legacy sandbox mode or a
     feature left on;
   - a skill that is not a bundled one, or is not turned off;
   - any hook, plugin or MCP server;
   - any warning.
3. **The thread.** It must report:
   - the pinned model and provider;
   - the `adapt` permission profile and a read-only sandbox without network;
   - the empty working folder and no instruction sources;
   - approvals that come back to LeadingLight.

A failed preflight or gate reports Codex `unqualified` until a later check passes. A thread that is
not as qualified reports it `unqualified` until the app restarts. Either way, none of the person's
text was sent.

## During a turn

With these controls the model is offered `request_user_input` and a freeform `apply_patch`, and
nothing else.

- **`request_user_input` is inert.** In Default mode the runtime refuses it itself, and the model
  sees that refusal.
- **A patch to an existing file outside `run/`** (Update, Delete, Move) fails inside the runtime:
  the profile denies the read it needs, so no content, diff or approval request ever exists. The
  model sees the denial.
- **A patch that adds a file** asks for write authority. Adapt never grants it.

"Codex has no tools" is therefore not true. The boundary is this composition: denied reads, plus a
host that never grants authority and stops the turn.

**What stops a turn.**

- **A proposed patch.** That is a `fileChange` item, a diff, or a request for write authority. It
  stops the turn as `toolRefused`. It is known behaviour of this build, so Codex stays qualified.
- **Anything the qualification never saw.** That includes another item kind, a command, hook,
  process, file-system or MCP event, any other request, or work on another thread. It stops the turn
  as `toolRefused` and leaves Codex `unqualified` until the app restarts.
- **Another model.** A reroute to another model stops the turn as `providerFailed`.

**How a turn is stopped.** This applies to a patch, a cancel or the deadline.

1. Admission closes at once. Nothing read afterwards is an answer, including a late candidate.
2. The turn is interrupted by its accepted thread and turn ids.
3. Pending requests are answered only when two things are both true:
   - the interrupt's own reply came back;
   - this very thread's turn reported `turn/completed` with status `interrupted`.

   Each answer is that request's own refusal: `decline` for a file change, `denied` for the legacy
   approvals, `decline` for an MCP elicitation, and an error otherwise. A `decline` would otherwise
   let the turn continue. Without both proofs the requests stay unanswered.
4. The whole process group is killed. The adapter waits, within a bound, until no process of the
   group is left, then reaps it. Nothing is retried.

**Writes are bounded too.** Each write to the provider goes through a writing thread and has a
deadline. The person's text also stops on cancel. A send that is already cancelled or past its
deadline is refused before anything is handed over, so no thread or turn is started after a known
cancel. A provider that stops reading its input cannot hold the turn: the send fails, and the
process is killed.

**Outcomes.**

| Outcome | When |
|---|---|
| A reply | The turn completed, its final message was read, and the group is proven gone. |
| `failed` | A failure, with the group proven gone. A refused sign-in is `notConnected`: Codex is then signed out, with no new account epoch. |
| `stopped` | The host cancelled it, and the group is proven gone. |
| `Unconfirmed` | The process group could not be proven gone, whatever else happened. Whatever the turn produced is discarded. Codex is `unqualified` until the app restarts. |

## Signing in and out

- **Connect** starts the provider's own ChatGPT browser sign-in, only on `https://auth.openai.com/`.
  The sign-in is stored only in the private `CODEX_HOME`. Reading status never starts one.
- **Cancel** is recorded under the same lock that publishes a sign-in's result. From then on, the
  sign-in cannot end connected:
  - its account read stops;
  - a late success is published as cancelled;
  - whatever it stored is removed;
  - a sign-in cancelled before the browser opens never opens it;
  - a sign-in that is no longer the current one changes nothing.

  A sign-in's end records whether all of its cleanup was proven, separately from its worker having
  ended. Cancel answers:

  | Answer | Meaning |
  |---|---|
  | `cancelled` | It ended within the wait, with all of its cleanup proven, including removing what it stored. |
  | `unconfirmed` | It has not ended yet, a credential it stored or its cancellation marker could not be removed, or some process group is unproven. |
  | `notConnecting` | Nothing is in progress, and no earlier cancellation is unresolved. |

  Asking again retries an unresolved cancellation, and answers `cancelled` once it is resolved.
- **A blocked credential.** If a cancelled sign-in's credential cannot be removed, it is never read
  or used again, not even to sign out with. This lasts across a restart: a marker file says so.
  Status shows `unavailable` (`failed`), so nothing connects or sends. Removal is tried again on
  each status read, cancel and sign-out. The cancellation resolves only once both the credential
  and the marker are gone. A surviving marker would make a later sign-in's credential look like
  the cancelled one after a restart, so until then no new sign-in starts.
- **No account read after an unproven process.** If a sign-in process's group cannot be proven
  gone, no account read follows, and anything it stored is discarded unread.
- **Sign-out** answers `stopping` in two cases: a sign-in has not ended, or some process group
  could not be proven gone at any time since the app started. It answers `failed` if the
  credential cannot be removed. When Codex has been left `unqualified` at run time, or holds a
  blocked credential, it still signs out locally and starts nothing.

## Tests and the offline qualification

`src-tauri/src/leadinglight_adapt/codex_tests.rs` holds the unit tests. They use synthetic folders,
stand-in files that are never run, and a scripted app-server over pipes. They cover:

- the environment and the group kill;
- discovery and the pin;
- the configuration, the preflight against contaminated folders and helper links, and the gate;
- the turn protocol, including each interrupt case and each request's refusal;
- bounded writes, including no frame written for a send that is already cancelled or expired;
- `Unconfirmed`, and the sign-in races;
- a cancelled credential or marker that cannot be removed, and unproven sign-in cleanup.

`qualification_pinned_codex_through_the_production_adapter` is ignored by default. It runs the
pinned binary through this same adapter, against a loopback stand-in for the Responses API. That
fixture accepts only a dummy key and refuses anything sent through it as a proxy. No credential,
sign-in, network or paid inference is involved. Under a synthetic home with canaries it checks:

- a benign structured reply, with only the instructions and the request sent. Its canned candidate
  carries a complete E1 package from the shared conformance corpus (`quick-note.json`). The
  package must arrive unchanged, and the native E1 admission must accept it as `local.quick-note`.
  This proves the transport delivers a usable candidate. It does not prove what a real model would
  write;
- foreign Update, Delete and Move reads denied, with notes unchanged and no sentinel sent;
- an Add stopped and declined only after its own turn is confirmed interrupted, then killed and
  reaped, with nothing written and no further request;
- a Default-mode question that stays inert;
- a cancel during the response;
- contamination refused before anything starts;
- another build never run, and another model refused before any request.

```sh
LEADINGLIGHT_CODEX_QUALIFICATION_BINARY=/path/to/the/pinned/codex \
LEADINGLIGHT_CODEX_QUALIFICATION_EVIDENCE=/path/to/evidence.json \
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  leadinglight_adapt::codex_tests::qualification_pinned_codex_through_the_production_adapter \
  -- --ignored --exact --test-threads=1
```

The evidence file is optional. It holds only check results, outcomes and labels, with temporary
paths replaced.

## What is qualified, and what is not

**Qualified offline.** The pinned 0.162.1 binary with `gpt-5.5` passed this offline qualification
through the production adapter: 1 of 1, with all of its checks true. That shows, against a
loopback fixture with a dummy key:

- the configuration, the folders and the stop discipline hold with the real runtime;
- the transport delivers a usable candidate.

**Not qualified.**

- **Live use.** A real ChatGPT sign-in and real inference have not been run. Live use is not
  qualified.
- **The native interface.** The native interface is not qualified either.

None of this is a release claim.

## Limits

- **The check-to-start window.** The binary is verified by size, hash and file identity, and
  checked again right before each start. Replacing the file in the instant between that check and
  the start is not detected.
- **The real ChatGPT provider is not exercised offline.** The qualification reaches the loopback
  fixture under a test-only provider id. The `openai` provider id and a real sign-in are covered by
  the same thread and gate checks, but not by an offline run.
- **Ancestors above the person's home are not checked.** The preflight does not look at the
  person's home or anything above it. That they are not consulted is shown by the qualification's
  canaries there, under `project_root_markers = []`.
