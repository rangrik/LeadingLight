# Activity

A screen with a timeline of what happened on every box, written as
sentences: agents starting, finishing and asking for you, worktrees and
setup, sessions, flows, services, boxes coming and going. It marks what is
new since you last looked, filters by kind and box, and searches. Agent
events name the worktree they happened in, mapped from their folder.

It keeps the last 300 events on this computer, so a restart doesn't lose
"while you were away". The Automations page still shows every raw event.

SDK used: `on("*")`, `addScreen`, `addSidebarItem`, `addCommand`, `storage`,
`useStorage`, `api.locations`, `openTerminal`, and the UI kit's
`ToggleGroup`.
