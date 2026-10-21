# Local-only runtime

LeadingLight keeps its desktop note workflow local. The remote services inherited from upstream are disabled by product policy, even when a stored preference or build environment asks to enable them: AI agents and chat, the MCP bridge, remote Git, downloads, telemetry and updates. The one exception is Adapt, an owner-authorized flow that reaches a provider only after the person's explicit sign-in and explicit Send. It is described under [Adapt](#adapt-the-owner-authorized-provider-flow) below.

## Enforcement points

- `src/leadinglight/localPolicy.ts` forces telemetry, the inherited AI features, Git automation and update settings off. It does this before initial render, after loading and before saving preferences. Existing feature-gate functions consult the same policy. Adapt does not use these settings, and they cannot turn it on.
- `src/lib/telemetry.ts` returns before initializing Sentry or PostHog. `src-tauri/src/telemetry.rs` independently prevents native Sentry initialization.
- `src-tauri/src/leadinglight.rs` defines the native command boundary. `with_invoke_handler` in `src-tauri/src/lib.rs` rejects these commands before their retained upstream implementations run: remote Git, the inherited AI agents, the MCP bridge, template download, remote image download and the updater. Adapt's own fixed commands are separate (below).
- Command palette, vault menu and native menu entries for remote services are omitted. The local command registry preserves note, search, save, file, history and export actions.
- The updater plugin is not registered. Frontend update checks and MCP sockets also stop before making a request. Native desktop startup does not start the MCP bridge or discover and migrate an upstream vault.
- The production content security policy restricts webview connections and media to local resources. Custom HTML blocks already have a separate policy denying network access. Local bundled fonts and editor assets remain usable.

Local note reading and saving, note creation, folder operations, image imports from local files, search, local Git history, native menus and PDF export continue through the existing handlers. A user opening an ordinary external hyperlink in their browser is a deliberate OS action; it is separate from background network access by the application.

## Adapt: the owner-authorized provider flow

Adapt asks a provider to draft an E1 extension package ([ADR 014](ADR-014-adapt-extension-authoring.md)). Its code and commands are its own, not the inherited AI features:

- the UI is `src/leadinglight/adapt/`;
- the host is `src-tauri/src/leadinglight_adapt/`;
- the 13 fixed commands are in `src-tauri/src/commands/adapt.rs`.

**What stays local:**

- **Using Adapt locally.** Opening Adapt, reading provider status, history, deleting and Save again run on this machine only.
- **Storage.** Conversations are stored per vault under LeadingLight's local app data, beside its settings. They are not in the vault and not in workspace backups.
- **The webview.** It still makes no remote connections, and the content security policy is unchanged.

**What is remote, and disclosed:**

- **Connect.** Only an explicit Connect starts the provider's own ChatGPT sign-in, in the system browser. The sign-in is private to LeadingLight: the provider runs with a private `HOME` and `CODEX_HOME` under LeadingLight's app data. It never reuses a developer's or the person's own provider credentials or settings.
- **Send.** Only an explicit Send runs remote provider inference. A Send carries only what the dialog says it includes: the request, the attachments the person chose, the earlier turns shown, the identity of the package being changed and the built-in extension guide.
- **Disclosure.** It is shown at Connect and beside Send.

**What never happens:**

- background uploads;
- telemetry, sync or update checks;
- automatic retries;
- reads of notes the person did not attach;
- broad vault access grants for the provider;
- installing or updating the provider.

**The provider has no effective file or command access.**

- The model works only from the explicit context of each Send.
- It may advertise a tool request; such a request is refused and never granted.
- Whether a given provider binary and transport qualify is stated in [adapt-provider.md](adapt-provider.md). An unqualified provider is never started for a Send.

**Claude is unavailable.** There is no paid or API-billing fallback.

**Stopping is truthful.** Cancel, closing a visit and signing out close admission at once. They report `stopping` until the provider's work is proven ended. A provider that cannot prove this, or that panics, never yields a confirmed stop.

**What has been checked.** The browser build reports Codex unavailable unless an explicit test fixture is installed. That fixture proves the interface only. The native desktop window has intentionally not been qualified by interactive QA.

## Storage isolation

`mcp-server/app-config-policy.json` is shared with the native config resolver. Its current namespace is `dev.rangrik.leadinglight`, with `dev.rangrik.leadinglight.dev` for development. Only the current namespace is read. The app does not import Tolaria or Laputa settings, vault registries or saved window state.

The default new-vault location is `~/LeadingLight Vault`, outside the commonly cloud-managed Documents folder. Existing folders are opened only through explicit selection or LeadingLight's own saved registry. Startup never scans or migrates `~/Laputa`.

The vault index cache is stored in `cache/` under the same LeadingLight config namespace. It does not read the historical `~/.laputa/cache` location. The upstream `LAPUTA_CACHE_DIR` environment override remains for isolated tests.

## First-release document ownership

`MULTI_WORKSPACE_ENABLED` and `SEPARATE_WINDOWS_ENABLED` are explicit local feature gates, independent of remote-service policy. Version 0.1 keeps one writable workspace at a time and both editing panes in one native window. Normal folder switching remains available and waits for pending saves. Stored preferences cannot enable the multi-workspace graph; native IPC and webview capabilities prevent separate window creation, and UI commands are omitted.

These local features are deferred until save ownership safely spans scope changes and multiple windows. They are not cloud features. In particular, removing a mounted workspace must flush its pending edits before changing the writable scope, and separate editors of the same document need shared revision ownership.

## Upstream integration

The remote feature implementations remain in the source to keep upstream merges manageable. They are unreachable through the LeadingLight native invocation boundary and cannot be enabled through settings. Adding a new upstream command or background service requires auditing this boundary before release. A frontend-only switch is insufficient: native requests and external process launches must be blocked independently.

The policy test suite exercises the real disabled policy, including saved opt-ins, embedded telemetry credentials, update checks and socket construction. Selected upstream implementation tests use a test-local policy override to retain coverage of dormant code; the application has no runtime override.

Native QA must use a disposable vault and isolated config root. Keep public evidence free of personal note content and local account information.
