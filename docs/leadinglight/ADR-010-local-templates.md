# ADR 010: optional local page templates

## Decision

Reuse Tolaria's local Type document and its resolved `template` metadata for reusable page starting points. Ordinary New page remains the immediate blank capture path. A separate chooser offers preview, creation and explicit template editing without a required setup flow, remote gallery or another template store.

The additive `src/leadinglight/templates` domain and UI modules own this feature. `useNoteActions` exposes a bound controller and a narrow result-bearing template write through the existing page mutation coordinator. The broad inherited property API and unrelated type customization remain compatible. The old fire-and-forget template textarea is hidden in the LeadingLight type customization surface; icon, color and view customization remain available.

## Identity and persistence

A flow captures its receiving vault session and pane reservation before asynchronous work. The source is selected by exact file path, including when two Types share a name. `reload_vault_entry` supplies the resolved template and default properties from one fresh native read. The browser disk adapter preserves that exact-read contract and fails closed for scoped entry/content reads. It does not answer a failed real-file read with in-memory demo data.

Creation repeats source settlement and reading. A changed preview requires another explicit Create. New pages are created beside their source template so note-relative links and images retain their paths. The preview displays the destination and generated type/default metadata; source identity, favorites and unrelated metadata are not copied. The existing name-based type relationship remains unchanged, even when exact source paths disambiguate template selection.

A new template is one complete, exclusively created Markdown Type document. Existing template names and paths stay fixed in this increment; editing changes its starting text through the same page save coordinator used elsewhere. A saved result means a confirmed write; a later listing refresh failure does not erase that acknowledgment. An older acknowledgment cannot clear a newer draft.

Both native and browser page creation use `create_note_content` with create-only semantics. No optimistic listing entry, rollback deletion or opening of a colliding occupant is permitted. Unconfirmed results retain their attempted path. An explicit check reads that same path before any retry, and never silently creates a second file. A confirmed page that cannot attach to its original pane is reported as created with its location.

## Interaction and lifecycle

The chooser and editor use existing shadcn/Radix controls and Phosphor icons. Preview Markdown is passive: links cannot navigate, images are labeled placeholders and HTML is not embedded. This adds no remote resource access.

The UI retains dirty drafts and unresolved attempts. Dismissal requires an explicit discard or an explicit close acknowledging that an unconfirmed file may remain. Save targets the active template draft. Quit, workspace switch and backup synchronously hold or refuse template work before acquiring prerequisite page mutation barriers; they cannot discard a draft or wait on work blocked by their own holds. The other pane and ordinary capture retain their existing behavior.

## Limits

This is optional manual template use, not a templating language. There are no variables, schedules, remote templates, template rename/delete operations or new persistent type identifiers. The app does not lock arbitrary external editors between a fresh read and creation. Native parsing keeps its established malformed-frontmatter fallback; this feature does not claim strict YAML validation. Local history and backup continue to protect the underlying ordinary Markdown files through their existing policies.
