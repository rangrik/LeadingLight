# Library baseline — 3 November 2026

The npm registry served the existing React 19.3.1, Vite 8.3.5, TypeScript
6.0.3, Base UI 1.9.0 and ProseMirror view 1.42.6. These were already in the
lockfile. Tauri's Rust lockfile already had 2.12.5. No version was downgraded.

- Updated the TipTap packages together from 3.32.0 to 3.32.2. The explicit
  text-style dependency keeps the details extension's matching peer in sync.
- Updated Tailwind and its Vite plugin to 4.3.4 and the React Vite plugin to
  6.2.1 across the workspace. Tailwind's patch fixes source watching and CSS
  generation; see its [release notes](https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.3.4).
- Updated KaTeX from 0.16.47 to 0.19.1. A narrow override also gives
  `micromark-extension-math` the patched version while its own range is still
  on 0.16. This addresses [GHSA-238p-pmpm-9mq7](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7),
  which requires existing prototype pollution. Version 0.18.11 is deprecated
  upstream because it accidentally contained a breaking change.
- Adapted the file editor's color lookup to the nested TextMate theme returned
  by `@pierre/diffs`; the vendored code remains unchanged. The old lookup
  rendered all roles in the plain text color.
- Connected the read-only Then/Now project previews to that editor. Change still
  shows the diff; neither preview can write the file.
- Connected our note and project reply renderer to Shipyard's math parser and
  lazy KaTeX loading. Browser QA caught that the parser's unit tests alone did
  not establish that formulas appeared in our own conversation UI.

The production npm audit reports no known vulnerabilities. Frozen install,
workspace typecheck, desktop build, desktop unit tests, the existing math
renderer tests and focused browser editor, saving and grammar tests passed.
On a 2,000-paragraph page, 20 typed characters appeared and document-changing
editor dispatch took 1.8–3.2 ms each. Keydown to the next animation frame took
24–36.5 ms, including frame scheduling; it did not establish a sub-16 ms
paint time and needs comparison against the earlier baseline.

Harper 3, TypeScript 7, PostgreSQL 4 and xterm 6 are major migrations and
were not included. The Tauri dialog patch changes native behavior and needs a
separate native verification pass. The existing VitePress dependency uses Vite
5; replacing it needs a docs-tool upgrade rather than forcing the app's Vite 8
into that dependency tree.
