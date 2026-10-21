# Dependency status

Audit date: 2026-10-15. Tauri Rust/API is 2.12.4; CLI is 2.12.3, the stable registry versions checked for this milestone. Compatible direct dependency upgrades and the Rust lockfile were refreshed.

The capture-and-resume candidate adds `yaml` 2.9.1 as a direct dependency, verified against
the stable registry release. It validates Favorite frontmatter before a narrow patch, without
reformatting the document. The lockfile also normalizes inherited Tiptap peer resolutions to
the already declared 3.22.5 version; this does not upgrade the editor to its latest major.

The safer-save native increment adds `sha2` 0.11.1 for request binding and copy verification.
Its minimal lockfile changes preserve Cargo lock format 3. The October 16 native checks use the
existing Rust toolchain and pass with `--locked`; the compatibility exceptions below still apply.

## Deliberately held for compatibility

These are not claimed to be latest. Updating the editor requires rebasing the inherited correctness patches; other major upgrades need separate migration and regression verification after the first usable split-pane milestone.

| Package | Current | Registry latest |
|---|---|---|
| @blocknote/code-block | 0.46.2 | 0.56.0 |
| @blocknote/core | 0.46.2 | 0.56.0 |
| @blocknote/mantine | 0.46.2 | 0.56.0 |
| @blocknote/react | 0.46.2 | 0.56.0 |
| @eslint/js | 9.39.2 | 10.0.1 |
| @ironcalc/wasm | 0.5.4 | 0.8.4 |
| @ironcalc/workbook | 0.5.7 | 0.8.3 |
| @mantine/core | 8.3.14 | 9.7.2 |
| @sentry/react | 10.47.0 | 11.7.0 |
| @shikijs/langs | 3.23.0 | 4.5.0 |
| @testing-library/jest-dom | 6.9.1 | 7.0.1 |
| @tiptap/pm | 3.22.5 | 3.32.0 |
| @tldraw/assets | 4.5.10 | 5.5.2 |
| @types/node | 24.10.13 | 26.6.5 |
| @vitejs/plugin-react | 5.1.4 | 6.1.2 |
| @vitest/coverage-v8 | 4.1.10 | 5.0.4 |
| eslint | 9.39.2 | 10.12.0 |
| globals | 16.5.0 | 17.13.0 |
| jsdom | 28.0.0 | 30.1.2 |
| katex | 0.16.28 | 0.19.0 |
| mermaid | 11.17.2 | 12.2.0 |
| react-day-picker | 9.13.2 | 10.0.2 |
| tldraw | 4.5.10 | 5.5.2 |
| typescript | 5.9.3 | 7.0.2 |
| vite | 7.3.5 | 8.3.4 |
| vitest | 4.1.10 | 5.0.4 |

Page relocation adds `pulldown-cmark` 0.13.4 with default features disabled. The Cargo registry
reported 0.13.4 as latest when checked on October 16, 2026. It supplies CommonMark source spans
for local destination edits; it does not serialize or reformat entire pages. Its lockfile adds
`unicase` 2.10.0. This addition does not change the compatibility exceptions listed above.

## Website capture (0.14.0)

Website capture adds one direct dependency, `@mozilla/readability` 0.6.0. It extracts the article
from the fetched page inside a detached document. Existing direct dependencies do the rest:
DOMPurify 3.4.17, BlockNote 0.46.2 (held above) and `yaml` 2.9.1.

- **Exact pin, by exception.** `package.json` names `0.6.0` with no range, and `pnpm-lock.yaml` adds
  only its three entries. The conversion's synthetic fixtures and exactness checks were written
  against this extractor's output. A newer Readability is therefore adopted only after they pass
  with it, never by a routine refresh.
- **License.** Apache-2.0, which is compatible with distributing LeadingLight under
  AGPL-3.0-or-later. Its `LICENSE.md` ships with the package. It has no runtime dependencies and
  ships its own type definitions.
- **Version.** 0.6.0, published 2025-03-03, was the registry's latest stable release when checked
  read-only with `pnpm view` on October 20, 2026. The installed and tested version is 0.6.0.

The native fetch adds no Cargo package:

- `Cargo.toml` names `encoding_rs` 0.8 directly, for its documented charset decoding. It is locked
  at 0.8.42 and was already in the lockfile.
- tokio's `net` and `time` features are enabled (tokio 1.53.3), for the pinned lookups and
  timeouts.
- The HTTP client is the existing reqwest 0.12, locked at 0.12.28. The fetch configures it to use
  rustls 0.23.46 with its bundled WebPKI roots (`webpki-roots` 1.0.9).

These Rust versions were not checked against the registry for this release. The compatibility
exceptions listed above still apply.
