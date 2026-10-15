# ADR 002: Local recent visits and one finder

Date: 2026-10-15
Status: accepted

## Context

Title lookup and body search were separate upstream surfaces. The empty title-search query
used modification order, which does not represent pages revisited without editing. LeadingLight
needs a direct way to find a page and return to prior work, while preserving local Markdown files
and minimizing changes to shared editor and backend code.

## Decision

Use an additive finder under `src/leadinglight/`, integrated at App and sidebar boundaries.
Reuse the upstream title matcher and native local `search_vault` command. Deduplicate by note
identity and show plain-text snippets. Treat query, vault and dialog session as request ownership
boundaries, and retain a visible retry path for failed body searches.

Store a bounded per-vault list of visited paths and timestamps in local app storage. Resolve
current titles from authoritative vault entries rather than copying metadata or bodies into this
store. Record a visit only for the focused, loaded page, not merely a requested navigation.
Storage corruption or unavailability must not prevent writing or searching.

## Consequences

No remote service, new database or dependency is required. Recents are a convenience layer;
losing them does not affect canonical Markdown. Rename and deletion handling must reconcile
against current entries. Finder navigation remains subject to existing save-before-replacement
and single-editor ownership rules. Imported upstream search changes can be adopted without
rewriting this fork's history or page storage.
