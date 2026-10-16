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
