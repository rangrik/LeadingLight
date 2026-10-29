# Browser research

2026-10-28. The goal is a browser the person and the agent can both operate,
inside LeadingLight. This records the research behind decision 31 in
`docs/DECISIONS.md`. Behavior is specified in `features/agent-browser.feature`.
The verification table distinguishes implemented behavior from remaining parity gaps.

## Reference and scope

[OpenAI's Browser documentation](https://learn.chatgpt.com/docs/browser) describes
a shared page beside a chat, a separate browser profile, tabs, address-bar search
and history, downloads, full/split view, page annotations and style feedback.
Agents can navigate, click, type, inspect and take screenshots. Website permissions
and sensitive-action confirmations remain separate. Full CDP inspection has its
own developer-mode permission. The documented built-in browser cannot automate
file uploads; the extension for existing browser profiles is a separate product.

That is the public reference, not evidence of OpenAI's private implementation.
This work does not assume its internal APIs, Chrome-extension support, cloud
computer, password protection, or profile-import behavior can be copied. Bookmark,
find and zoom controls are LeadingLight's ordinary browsing requirements, not
features inferred from an undocumented GPT interface.

## How the projects were checked

Read the actual license, current source and default-branch commits, then compared
the engine, process model, profile ownership and integration surface. GitHub stars
were not a maintenance test. Dates below are the repositories' UTC commit dates;
the evidence was checked on October 28. A repository's recent `pushed_at` alone
does not show that its default branch is maintained.

## MIT shortlist

| Project | License | Verified maintenance | Role in LeadingLight |
| --- | --- | --- | --- |
| [Shipyard](https://github.com/cosscom/shipyard) | [MIT](https://github.com/cosscom/shipyard/blob/main/LICENSE) | [Human v0.3.31 release commit, Oct 27](https://github.com/cosscom/shipyard/commit/2b008f7fd6769c1a7bd7ff8301bbf1a062fe1f1e) | Extend the existing runtime and browser transport. Same Tauri, React and COSS stack. |
| [Wry](https://github.com/tauri-apps/wry) | [Apache-2.0 OR MIT](https://github.com/tauri-apps/wry/blob/dev/Cargo.toml), [MIT text](https://github.com/tauri-apps/wry/blob/dev/LICENSE-MIT) | [macOS upload fix, Oct 28](https://github.com/tauri-apps/wry/commit/ba7e1dadfd6fccb3e19669a3c44c276d7bcff9b9); [0.57.1, Oct 23](https://github.com/tauri-apps/wry/releases/tag/wry-v0.57.1) | Native alternative already underneath Tauri; not the selected website engine. |
| [Browser Harness](https://github.com/browser-use/browser-harness) | [MIT](https://github.com/browser-use/browser-harness/blob/main/LICENSE) | [Human response-handling fix, Oct 25](https://github.com/browser-use/browser-harness/commit/1cc5536b70befffebd7d8b1ce236a6e7c7b37324) | Reference for persistent CDP sessions and agent operations; no new Python service. |
| [Stagehand](https://github.com/browserbase/stagehand) | [MIT](https://github.com/browserbase/stagehand/blob/main/LICENSE) | [Human commit, Oct 27](https://github.com/browserbase/stagehand/commit/737480022acbf5ec3450885f120fc33ee561a9b4); [server v3.7.7, Oct 23](https://github.com/browserbase/stagehand/releases/tag/stagehand-server-v3/v3.7.7) | Reference for locators, page understanding and process cleanup; not a browser shell. |
| [Browser Use](https://github.com/browser-use/browser-use) | [MIT](https://github.com/browser-use/browser-use/blob/main/LICENSE) | [0.13.14 release commit, Oct 26](https://github.com/browser-use/browser-use/commit/2cc71890e65056b67fdb29d98bb407749c15bb08) | Agent orchestration reference; avoid coupling to the outgoing Python runtime. |
| [BrowserCode](https://github.com/browser-use/browsercode) | [MIT](https://github.com/browser-use/browsercode/blob/main/LICENSE) | [Transport-recovery fix, Oct 8](https://github.com/browser-use/browsercode/commit/757645b9474818eb672297cf9adf99ad7b60a269); [release](https://github.com/browser-use/browsercode/releases/tag/v0.1.21-transport-recovery.2) | TypeScript CDP reference; adopting its whole OpenCode fork would duplicate our agent system. |

### Shipyard: closest fit, with two different browsers

Shipyard's [native browser](https://github.com/cosscom/shipyard/blob/main/app/src-tauri/src/browser.rs)
creates child webviews, follows pane bounds, handles navigation and SPA addresses,
and provides console output and WebKit Inspector. Its
[browser guide](https://github.com/cosscom/shipyard/blob/main/docs/guides/browser.mdx)
explains the native view and the limited iframe fallback.

Its [agent browser](https://github.com/cosscom/shipyard/blob/main/docs/guides/agent-browser.mdx)
is different: Chromium in the runtime, named tabs, snapshots, element references,
screenshots and a live cast. LeadingLight already wraps that transport. The
existing pane only watched it; this work adds input and browser controls to the
same page. Reuse the runtime, leaving `vendor/shipyard` unchanged and recording
additive runtime patches through the project's existing build mechanism.

### Wry: strong native browsing, different automation engine

[Wry](https://github.com/tauri-apps/wry) uses WKWebView on macOS, WebView2 on
Windows and WebKitGTK on Linux. Its MIT option is real even though GitHub's API
selects Apache as the displayed license. A child view would avoid frame-stream
input translation, but Chromium CDP tools cannot operate that WKWebView.
Adding one now would split the person's page from the agent's page, including
forms and sign-in state. This is why it was not selected for website rendering.

### Browser Harness: useful small control surface

Its [helpers](https://github.com/browser-use/browser-harness/blob/main/src/browser_harness/helpers.py)
cover navigation, tabs, click/fill/type/key/scroll, screenshots, waits, JavaScript,
iframe targets and uploads. A persistent daemon keeps the CDP connection alive;
CLI and MCP serve existing coding agents. Its
[package manifest](https://github.com/browser-use/browser-harness/blob/main/pyproject.toml)
requires Python and CDP dependencies. Replacing our working runtime with it would
add packaging and lifecycle work without adding the browser UI. Its personal
Chrome connection also grants a wider scope than an app-owned browser profile.

### Stagehand: rich automation during an API transition

The [current source](https://github.com/browserbase/stagehand/blob/main/README.md)
describes a v4 extension driver with persistent local Chrome, deterministic page
methods and `observe`, `act` and `extract`. The release list still has v3 server
artifacts, so examples must be pinned to one actual version. The
[local launcher](https://github.com/browserbase/stagehand/blob/main/packages/sdk-ts/src/browser/localBrowser.ts)
is a useful reference for profile ownership, cancellation, failed-start cleanup
and closing a process only once. Those ideas fit our existing runtime; adopting
the whole framework would introduce a second automation layer and model setup.

### Browser Use and BrowserCode: active, but not replacements

Browser Use's [release commit](https://github.com/browser-use/browser-use/commit/2cc71890e65056b67fdb29d98bb407749c15bb08)
explicitly marks 0.13.14 as the last Python runtime before its Pi migration.
The library is MIT; its [cloud service](https://github.com/browser-use/browser-use/blob/main/CLOUD.md)
is not open source. Neither requires LeadingLight to adopt the hosted service.

BrowserCode's [architecture](https://github.com/browser-use/browsercode/blob/main/README.md)
ports Browser Harness to TypeScript inside an OpenCode fork. One persistent
`browser_execute(code)` operation gives the agent direct CDP access. Its session
recovery is relevant, but importing a whole coding agent would replace machinery
LeadingLight already has. Arbitrary execution also needs a broader permission
boundary than a fixed set of browsing commands.

## Exclusions and license traps

- [agent-browser](https://github.com/vercel-labs/agent-browser/blob/main/LICENSE)
  is Apache-2.0, not MIT. It is active: [Oct 27 fix](https://github.com/vercel-labs/agent-browser/commit/5801a50d262a4d3e1a2381996a962b22000d8289).
- [Min](https://github.com/minbrowser/min/blob/master/LICENSE.txt) is Apache-2.0,
  not MIT. Its [Aug 23 Electron update](https://github.com/minbrowser/min/commit/51087ba5661bb4f44f1ecc5220684ce3f0aa5a3e)
  shows maintenance, but adopting it would also introduce Electron.
- [chromiumoxide](https://github.com/mattsse/chromiumoxide) offers MIT, but its
  last inspected main-branch commit was April 3 and release February 25. It did
  not meet the same recent-maintenance bar as the shortlist.
- [Browser Use Desktop](https://github.com/browser-use/desktop) is MIT, but its
  recent repository push time masked a default branch ending May 26. It was not
  ranked as an actively updated browser shell on that evidence.

MIT applies to the listed project code. Browser binaries, bundled dependencies
and hosted services have their own notices and terms. Keep attribution for any
copied source; a project license is not a license for every dependency it loads.

## Decision and verification boundary

Use the existing Chromium/CDP runtime for both manual and agent interaction.
Keep personal tabs in an app-owned persistent profile; keep agent-only contexts
isolated. The agent can address a personal tab explicitly. Do not import the
person's regular Chrome profile or create a second website engine. Do not add
another agent framework while upstream APIs and runtimes are migrating.

| Area | Intended behavior | Verification state |
| --- | --- | --- |
| Shared page | Manual input and agent actions affect exactly the same tab and form state | Passed: real-agent runtime probe and real Chromium UI smoke |
| Navigation and tabs | Address/search, back/forward/reload/stop, close/reopen and stale-response protection | Passed: browser UI regressions and runtime tests, including popup URLs |
| Persistence | Restore personal tabs and cookies; history/bookmarks stay local | Passed: real profile restart and app reload; clearing refuses active agent tabs |
| Reading and inspection | Find, zoom, viewport sizes, page text, console and failed requests | Passed: Chromium and headless surface checks, including non-consuming logs |
| Permissions | List and revoke allowed sites; preserve workspace network restrictions | Passed: proxy, private-address and revocation tests |
| Downloads and dialogs | Track/cancel/save downloads; answer page alert/confirm/prompt | Passed: real download bytes/dialogs and native export harness; native save dialog awaits manual check |
| Chat layout | Full/split view and browser-scoped keyboard shortcuts | Passed: 360px, light/dark and shortcut regressions; native Edit menu awaits manual check |
| Annotation and style feedback | Saved element/area comments, frozen screenshots, batch chat attachments and reversible previews | Implemented: nested cross-origin frames, viewer leases and additional font/spacing/opacity controls; see verification record |
| Developer mode | Separate setting and approval for DOM, CSS, runtime, network and profiling | Implemented: page-scoped CDP with expiring document grants; unrestricted browser-wide CDP remains a deliberate gap |
| Browser preferences | Address history suggestions, searchable/removable history, selective clearing and download destinations | Implemented: website data clearing is explicitly all-time, while history supports time ranges |
| Other browser integrations | Extension attachment, profile import, cloud browsing and password handling | Outside the selected local-runtime architecture |
| Media and accessibility | Sound, device permission prompts, and a semantic page for assistive tools | Gap: the current transport sends images and input, not audio or a native page accessibility tree |

A frame stream must prove pointer scaling, keyboard selection, paste, drag,
scroll and reconnection behavior before being called interactive browsing.
Persistent cookies must be checked after a real runtime restart. Ordinary UI
tests cannot prove the native file dialog or OS keyboard handling; those need the
isolated development app checks required by AGENTS.md. The runtime itself is also
tested as a real process with real Chromium and agent commands.

## Follow-up parity pass

The [current public Browser guide](https://learn.chatgpt.com/docs/browser) was checked
again for saved comments, drag-area annotations, Browser settings and developer
access. Decision 33 records the implementation boundaries. Saved annotations retain
the captured image rather than pretending that a live page remains unchanged.

The remaining architecture gaps are extension attachment to existing browser profiles,
cloud browsing, unrestricted browser-wide CDP, audio transport, device permission flows
and a native page accessibility tree. The last three are limitations of our frame
transport; they are not claims about undocumented GPT behavior. A text snapshot does
not establish native accessibility parity.

Synthetic media probes used Chromium 156.0.8078.4 with fake devices only. Full Chromium
created audio/video tracks; headless-shell returned NotSupportedError. Exact-origin
permission changes stayed within their browser context and revocation ended the fake
tracks. [CDP Browser permissions](https://chromedevtools.github.io/devtools-protocol/tot/Browser/)
provide permission overrides, while [CDP Media](https://chromedevtools.github.io/devtools-protocol/tot/Media/)
provides diagnostics, not audio output transport. No physical device or audible audio
was used in these probes.
