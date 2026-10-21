# Local-only runtime

LeadingLight keeps its desktop note workflow local. The remote services inherited from upstream are disabled by product policy, even when a stored preference or build environment asks to enable them: AI agents and chat, the MCP bridge, remote Git, downloads, telemetry and updates. There are two owner-authorized exceptions, and each reaches the network only after an explicit action. Saving a website fetches the one page the person entered when they choose Fetch; see [Saving a website](#saving-a-website-the-owner-authorized-page-fetch). Adapt reaches a provider only after the person's explicit sign-in and explicit Send; see [Adapt](#adapt-the-owner-authorized-provider-flow).

## Enforcement points

- `src/leadinglight/localPolicy.ts` forces telemetry, the inherited AI features, Git automation and update settings off. It does this before initial render, after loading and before saving preferences. Existing feature-gate functions consult the same policy. Adapt does not use these settings, and they cannot turn it on.
- `src/lib/telemetry.ts` returns before initializing Sentry or PostHog. `src-tauri/src/telemetry.rs` independently prevents native Sentry initialization.
- `src-tauri/src/leadinglight.rs` defines the native command boundary. `with_invoke_handler` in `src-tauri/src/lib.rs` rejects these commands before their retained upstream implementations run: remote Git, the inherited AI agents, the MCP bridge, template download, remote image download and the updater. Adapt's own fixed commands are separate (below).
- Command palette, vault menu and native menu entries for remote services are omitted. The local command registry preserves note, search, save, file, history and export actions.
- The updater plugin is not registered. Frontend update checks and MCP sockets also stop before making a request. Native desktop startup does not start the MCP bridge or discover and migrate an upstream vault.
- The production content security policy restricts webview connections and media to local resources. Custom HTML blocks already have a separate policy denying network access. Local bundled fonts and editor assets remain usable.

Local note reading and saving, note creation, folder operations, image imports from local files, search, local Git history, native menus and PDF export continue through the existing handlers. A user opening an ordinary external hyperlink in their browser is a deliberate OS action; it is separate from background network access by the application.

## Saving a website: the owner-authorized page fetch

"Save from website" turns one web page the person enters into an ordinary local Markdown note ([ADR 016](ADR-016-website-capture.md)). Its code is its own:

- the native fetch is `src-tauri/src/leadinglight_web_capture/`, with two fixed commands, `web_capture_fetch` and `web_capture_cancel`, in `src-tauri/src/commands/web_capture.rs`;
- the conversion and dialog are `src/leadinglight/webCapture/`.

**What is remote, and disclosed:**

- **Fetch.** Only the dialog's explicit Fetch sends a request, and only to the exact address shown. It is one plain `GET` over `http` or `https`, with only `Accept`, `Accept-Encoding: identity` and `User-Agent: LeadingLight/<version>`. A site therefore sees one request from the person's network.
- **Bounds.** Redirects are followed by hand: at most 5, never from `https` to `http`. Every address a name resolves to must be public, and local or private addresses are refused before connecting. One attempt is bounded to 5 MiB and 30 seconds. Failures are fixed reasons that never repeat server text, and no URL is logged or kept afterwards. [web-capture-native.md](web-capture-native.md) has the full rules.

**What is never sent or run:**

- cookies, credentials (`Authorization` or credentials in the address), `Referer` or `Accept-Language`;
- a proxy, whether from the environment or the system;
- compression, a cache, a retry or a background fetch;
- the page's JavaScript;
- any subresource: no image, stylesheet, font, frame or media request. Images become text links.

The page is parsed into a detached, inert document that loads nothing. The webview itself still makes no remote connections, and the content security policy is unchanged.

**What stays local:**

- **The note is canonical and local.** The result is ordinary Markdown in the vault, created through the existing exclusive create after the person reviews it, and it can be undone. Its front matter records `source` and `captured`.
- **Never fetched again.** The note is never refetched, refreshed or updated, and opening it makes no request.
- **Nothing is shared.** The page is never sent to a provider or anywhere else. Attaching a saved note to Adapt is a separate, explicit choice there.

**Where it is offered.** Only the desktop app performs `web.capture`. A native switch (`WEBSITE_SERVICES_QUALIFIED`) and the desktop window's own host list (`WEBSITE_FRONTEND_QUALIFIED`) turn it on together. An ordinary browser build has no fetch and never offers it. A dev browser offers it only when a test installed the synthetic fixture. That fixture answers its own pages under a reserved `.invalid` origin and never opens a connection.

**What has not been measured.** Extraction quality on real sites, and how real servers treat an honest user agent and `Accept-Encoding: identity`. Pages that need a sign-in or scripts are refused, or can be saved as a link only.

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
