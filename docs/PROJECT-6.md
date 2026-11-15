# Project 6 — One door

2026-11-14. Follows Project 5 (the task is the place) and the UX review of 2026-11-08, which built
eighteen options for six issues as separate branches. Why: with many agents at work, every badge,
dot and list that shows state is a pull to switch. The six issues are one: state shown in too many
small places. This project picks the options that remove places to look, makes them work together,
and designs the three areas that come next.

## The rules

- One number in the window: the Inbox's. One colour with a meaning: amber, "an agent waits for you".
- One project at a time: the rail scopes the sidebar, tabs and panes; each project keeps its place.
- Every list has a cap. Nothing moves by itself: agents queue in the Inbox and never open a pane.
- Every page says where you stopped; every project says what changed since.

## Built (the unified branch)

Nine of the eighteen options, merged and made to work together. Contracts are their feature files.

| Issue | Taken | Contract |
|---|---|---|
| 1 Sidebar | 1B project rail, 1C Resume rows (scoped to the project inside one) | `project-rail.feature`, `sidebar-resume.feature` |
| 2 Today | 2A where things stand | `today-strip.feature` |
| 3 Reading | 3A "Your words" column, 3C Recall | `reading-layout.feature`, `recall.feature` |
| 4 Review | 4A the card answers, 4B Review mode | `task-work.feature`, `review-mode.feature` |
| 5 Attention | 5A one Inbox | `bar.feature` |
| 6 Search | 6B search with content | `search.feature` |

Left out, each with its branch kept: 1A (every project's dots at once), 2B (a second home), 2C (a
record with no next step), 3B (a map to wander, a fifth panel), 4C (two headers; its "Review next"
is wanted), 5B and 5C (still three places to poll), 6A (titles only; its commands and "New page" row
are wanted in 6B's panel), 6C (needs the sidebar open).

## Designed, not built

1. **Quiet pass.** The Inbox number counts only what blocks an agent; the header shows "46 words"
   and the rest on a click; working and ready become words where a dot stood.
2. **Work view.** In a project: tasks in flight, then every worktree (branch, who is in it, files
   changed, dev server) with Changes, Open preview, Accept and open PR, Remove. One "New work" box
   replaces the three ways to start (Chat, Assign, own branch), after Shipyard's composer: prompt,
   where (this checkout, a new worktree, from a branch or PR), agent with model and effort, or no
   agent for a bare worktree. First slice built (`work-view.feature`, DECISIONS 54): the view,
   the box and Remove; the rest is in DEFERRED.
3. **Review next.** Review mode walks the Inbox, so a round is one sitting.
4. **Studio.** An asset is a page of type Asset (Site, Slides, Document, Image) with a folder of
   its own that is not a repository. "Make" on any page starts one with that page as the brief. The
   page shows the folder live, keeps each turn's files as versions, and is reviewed like a report.
   Export first; a public link needs the owner's yes (it would be the first unencrypted surface).
5. **Other machines.** A Mac pairs as a client in Settings › Account and devices, through the relay
   the phone uses (DECISIONS 41, 50). A second grant level, Work, adds starting tasks, worktrees and
   changes; a third carries the agent's browser frames. A terminal waits for a direct link. A
   machine with no window waits until the runtime can answer page tools without the app.

The full design, with the day it is built around, is the "LeadingLight, One Door" page linked from
the pull request.
