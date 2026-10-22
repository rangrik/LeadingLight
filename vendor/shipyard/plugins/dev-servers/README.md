# Dev servers

A screen (sidebar and status bar) listing everything listening in a worktree
on every box, grouped by worktree, next to the services each repository
declares in `.berth/config.json`. Each server opens in a browser tab of its
worktree ("Open in tab"), beside the terminal, in your browser, or copies its
private URL; declared services can be started and stopped.

SDK used: `addScreen`, `addSidebarItem`, `addStatusBarItem`, `addCommand`,
`api.services`, `api.locations`, `api.request` (worktree services),
`api.serviceUrl`, `openWorktree`, `openBrowser`, `openUrl`, `useBoxes`,
`useCurrentWorktree`, `useEvent`, and the UI kit's `Frame` and `Menu`.
