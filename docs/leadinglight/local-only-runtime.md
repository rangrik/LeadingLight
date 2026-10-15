# Local-only runtime

LeadingLight keeps its desktop note workflow local. Remote services are disabled by product policy, even when a stored preference or build environment asks to enable them.

## Enforcement points

- `src/leadinglight/localPolicy.ts` forces telemetry, AI, Git automation and update settings off before initial render, after loading and before saving preferences. Existing feature-gate functions consult the same policy.
- `src/lib/telemetry.ts` returns before initializing Sentry or PostHog. `src-tauri/src/telemetry.rs` independently prevents native Sentry initialization.
- `src-tauri/src/leadinglight.rs` defines the native command boundary. `with_invoke_handler` in `src-tauri/src/lib.rs` rejects remote Git, AI, MCP bridge, template download, remote image download and updater commands before their retained upstream implementations run.
- Command palette, vault menu and native menu entries for remote services are omitted. The local command registry preserves note, search, save, file, history and export actions.
- The updater plugin is not registered. Frontend update checks and MCP sockets also stop before making a request. Native desktop startup does not start the MCP bridge or discover and migrate an upstream vault.
- The production content security policy restricts webview connections and media to local resources. Custom HTML blocks already have a separate policy denying network access. Local bundled fonts and editor assets remain usable.

Local note reading and saving, note creation, folder operations, image imports from local files, search, local Git history, native menus and PDF export continue through the existing handlers. A user opening an ordinary external hyperlink in their browser is a deliberate OS action; it is separate from background network access by the application.

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
