# Themes

LeadingLight's 23 themes, as data we own: four of our own (`src/builtin.ts`) and
nineteen ports of VS Code themes (`src/vscode.ts`), begun from Shipyard's and kept
under their MIT notices in `THIRD_PARTY_THEMES.md`. Nothing is read from disk or
from Shipyard's agent; the app ships these.

Edit a palette, or add one to the lists, then `pnpm check:themes`: every theme must
keep body and muted text at 4.5:1, focus rings at 3:1, and its state colours apart.

The check is ours too (`src/contrast.ts` and `src/color.ts`, begun from Shipyard's), so a
rule of our own, such as the Delete button's white on `--destructive`, can join it. What
applies a theme at runtime stays Shipyard's (`vendor/shipyard/app/src/themes/apply.ts`).
The app reaches our list through the alias `@/themes/builtin`, so the vendored hook and
the Appearance section read it unchanged.
