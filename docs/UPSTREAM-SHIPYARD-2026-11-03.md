# Shipyard refresh, 2026-11-03

UI and runtime source now pin `a6ee436af12210c00aca4a40f8f69955afd18fc1`,
38 commits past Shipyard's v0.3.31 tag. Its package still reports 0.3.31; this
is a main-branch commit, not the v0.3.31 release itself. The runtime keeps
LeadingLight's patch series and reports `0.3.31-ll.29` plus the patch hash.

The runtime now has upstream's structured-question transcript fix: helper
updates no longer answer a person's question, and a fresh read can look back
past a large run of helper events. Upstream limits that read to 64 MiB. It also
checks for untracked files, stashes and unpushed submodule commits before
removing a worktree without force. Upstream's process cleanup, worktree cache,
and structured-agent relaunch changes are included as part of the source pin;
their inclusion does not make Shipyard's phone API a LeadingLight feature.

Five local patches were rebased where upstream changed their surrounding code:
resume following, plain folders, folder identity, moved-folder resume and
conversation authorship. The lightweight agent-location lookup also uses the
same plain-folder and nested-folder rules as the workspace list. A relinked
Claude chat can resume only if Claude can
find its conversation at the new folder; otherwise the runtime now reports the
provider's failure. It does not move the provider's history. Upstream already
includes the question fix, so it is not duplicated in a local patch. The UI tree remains verbatim; its new upstream
files do not imply every Shipyard screen is used by LeadingLight.

The sync manifest now includes the three fixture groups upstream's existing
unit tests read. The sync script copies files newly added to its manifest even
when the commit is unchanged. Upstream's syntax-color unit test still fails
because its code expects theme rules at the top level while the installed
`@pierre/diffs` returns them under `textmate`; this is being handled separately.
