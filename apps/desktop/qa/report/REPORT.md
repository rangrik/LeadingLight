# QA report: Claude and GPT on every page, CLI updates, and plan usage

Run by the QA subagent (Sonnet 5.5, xhigh) in the worktree's Berth browser, browser build, 1280x800,
in five rounds, 2026-10-23, plus a run against the real tools. Screenshots are in `shots/` (not kept in git). Features:
`features/ask.feature`, `features/composer.feature`, `features/cli-updates.feature`,
`features/usage.feature`. The native window was not driven; in the browser, stand-ins play Claude
Code and Codex.

## Round 1: the agent panel and composer

Every scenario held except as below; fixed after the round.

| Found | Fixed |
|---|---|
| The approval card never took the keyboard; keys reached the page after reopening with ⌘J | The card takes focus when focus was in the panel, gives it back to the field once answered, and never takes it from the page |
| The Plan chip made the composer's footer overlap | The access button drops its words while Plan is on; below 352 px the model drops the effort and the chip drops "Plan" |
| Clicks in the footer's popups jumped focus to the field, so Escape closed the whole panel | Popups keep their clicks; the panel's Escape ignores keys from its menus |
| The user bubble was invisible in dark mode | `dark:bg-foreground/10` |
| A reload mid-turn lost the steps | Threads save within a second of any change |
| Time waiting on an approval counted as work | The turn's clock skips the wait; the line reads "Waiting for you" meanwhile |
| Mentions looked like plain text | COSS chip tokens with an icon |
| Nits: a lone comma, a wide gap before "· declined", a tiny "Open", no way to drop a quote, Insert/Replace under a plan | All fixed |

Not reachable with the stand-in: Approve for me's classifier, an agent's prompt and model, a mentioned
page's text, a broken agent file. With two pages side by side the panel doesn't belong to a pane
(in `docs/DEFERRED.md`).

## Round 2: the round 1 fixes

All nine items pass. Three small ones found and fixed: the live timer counted the wait, and focus
was lost after removing a quote and after "Make these changes".

## Round 3: CLI updates and usage

Every scenario passes, except amber rings and a failed usage check, which the stand-ins can't reach.
Fixed after the round: the update toast sat over the Ask panel's composer with no visible close
(now Skip, and it goes after 15 s); a toast stayed after updating from Settings; the sidebar footer
clipped below 253 px; Codex drew an empty inner ring; the open card's times went stale; the card
overlapped the sidebar; the credits line had no label.

## Round 4: the round 3 fixes

Six of eight passed. The toast came back on every reload while unanswered, and names hid at the
default 256 px sidebar. Both are fixed: at most one prompt an hour, even across relaunches, and
the names show from 256 px (checked headless: 224 px button, no overflow; 240 px hides the names).

## Against the real Claude Code and Codex

The project rules forbid driving the native window. So a throwaway local bridge (not kept) played
`agent.rs` for a browser build: same flags, same first lines, same end of turn. The webview's
code met the real CLIs on this Mac (Claude Code 2.1.308, Codex 0.164.0, Haiku and GPT-6-Luna at
low effort), and both runs passed:

- GPT: read the page, asked with the approval card, made "powerhouse" bold, answered a follow-up
  in the same Codex thread, and searched the web ("Canberra").
- Claude: the same edit, then GPT answering in the same thread, then Plan mode with "Make these
  changes" and the page untouched until it was clicked, then the change after approval.

Found and fixed: two text blocks running together ("…approve.Waiting…"), and the update toast
covering the composer's model button.

## Round 5: GPT through Codex

Every scenario passes (GPT edits with approval, web search, switching providers in a thread,
Codex missing or signed out, the model picker's groups and per-model efforts, Plan mode). Fixed
after the round: footer buttons overlapping at 280 px with Plan on and a long GPT name (checked
headless: no overlap at 280, 320 or 360 px with either provider); Settings text that described
Claude only; toasts that could still cover a wide or left-docked panel (now on the edge away
from it); the usage stand-in ignoring ?codex; "Ask Claude" names while GPT is chosen.

## Regression specs

`qa/ask.spec.ts` (now with a GPT run through the Codex stand-in), `qa/composer.spec.ts`,
`qa/usage.spec.ts`: 59 specs pass across the suite.
