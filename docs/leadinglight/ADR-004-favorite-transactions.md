# ADR 004: Favorite changes preserve page content

Status: accepted for the capture-and-resume milestone; release qualification is recorded separately.

## Context

A Favorite changes two frontmatter fields in the same Markdown file that the editor saves.
Treating it as an independent whole-file write can discard newly typed text. A permissive
line matcher can also mistake nested YAML or block-scalar text for those fields. Failure after
replacing a file must not be reported as if nothing reached disk.

## Decision

The native Favorite command changes only the top-level `_favorite` and `_favorite_index`
fields. It validates the complete YAML mapping before and after its byte-preserving patch.
Unrelated fields, comments, body text and line endings remain intact. Invalid YAML and valid
representations outside the supported patch subset are refused rather than rewritten.

The frontend uses the direct `yaml` dependency for equivalent validation. Shared synthetic
fixtures exercise both implementations, including nested fields, scalar content, malformed
closed blocks and unsupported root flow mappings. Neither implementation serializes the
whole frontmatter mapping to perform this operation.

Native publication stages a complete copy beside the page, syncs it, rechecks the original
and replaces it on the same volume. On macOS, Foundation replacement preserves the original
file metadata. The other-platform fallback has a narrower guarantee and needs platform QA.
Final symlinks and multiply linked files are refused by this operation.

Every result distinguishes a committed write, a refusal, a proven unchanged failure and an
uncertain outcome. A directory-sync failure after publication remains a committed write with
reduced durability. Uncertain copies are retained for recovery. Staging folders establish their
Git exclusion before containing page bytes; discovery, link rewriting and migrations exclude
the reserved recovery directories.

The editor coordinates the operation with its per-page save queue. A newer draft is rebased
by changing only the two Favorite fields. If that draft cannot be merged safely, the draft
remains in memory and further saves are held visibly until it can be reconciled. A stale
operation may not settle a newer operation or update a different vault session.

## Limits

This change does not replace every inherited filesystem writer. It is not a filesystem
compare-and-swap: an outside editor can still race the final recheck and publication. Recovery
copies are local to the same disk, and are not a backup. Ordinary page history and a broader
ordinary-save transaction are separate work.

## Integration surface

The native boundary is `frontmatter/favorite.rs`, the vault command and the small
`vault/atomic_replace.rs` platform adapter. The frontend patch is additive under
`src/leadinglight/favoriteTransaction.ts`; editor and entry-action hooks coordinate admission,
settlement and current-vault ownership. These seams should receive explicit review when
bringing in upstream save, frontmatter or rename changes.
