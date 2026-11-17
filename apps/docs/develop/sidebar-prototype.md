---
title: Shared sidebar prototype
description: Try notes and browsing in one sidebar with an isolated sample workspace.
---

# Shared sidebar prototype

This browser-only prototype explores a sidebar that changes between Notes and Browser
while the open panes stay in place. It uses LeadingLight's COSS controls and real block
editor, with sample notes and fictional websites. It does not change the installed app.

Start it from this branch:

```sh
pnpm install
pnpm --filter @leadinglight/desktop dev --port 1436 --host 127.0.0.1
```

Open `http://127.0.0.1:1436/sidebar-prototype.html`.

## Try a research session

1. Start in **Trip to Kyoto**. Swipe horizontally over the sidebar, press **⌥⌘B**,
   or use **Notes / Browser** at the foot of the sidebar. The note stays open.
2. **Shift-click Kyoto city guide** to open it beside the note. The row's menu also
   has **Open beside**. The split button in a page header opens a sample partner too.
3. Write in the note. Click another browser tab: only the browser pane changes.
   Switch to Notes and choose **Reading list**: only the note pane changes.
4. Drag the divider to resize. With the divider focused, use **← / →**, or **Home**
   to reset it. Close either pane to give the remaining one the full width.
5. Create a page with **New page** or **⌘N**, edit it, and pin it from its header.
   **Library** contains all types. Title search finds unpinned notes too.
6. Use **New tab** or **⌘T** to try another sample website. Links, the address field,
   Back and Forward work within the samples. Unknown addresses show an explanation.

**⌘\** hides or shows the sidebar. On Windows or Linux, use Ctrl in place of Command.
Vertical scrolling and pinch gestures do not change the sidebar mode.
There is one sidebar toggle: in the sidebar when open, or the first pane when hidden.

## What is simulated

Websites, Mail and Calendar are local sample content. No account connection, remote
website, native webview or sync service is used. The dated examples are a fixed sample week.

Note text, titles, pins, browser history and pane layout are saved under the prototype's
own browser-storage key. They are separate from the app's notes and tabs. Uploaded files
are temporary for the current page session. **Settings & account → Reset sample workspace**
restores the original examples.

This prototype supports up to two panes. In a narrow window, the panes scroll horizontally
so neither becomes too narrow to use. Choosing the interaction does not yet change native
browser placement or the shipping app's sidebar.

## Recorded checks

```sh
QA_PORT=1436 pnpm --filter @leadinglight/desktop exec playwright test \
  -c qa/playwright.config.ts --project=qa sidebar-prototype.spec.ts
```

Playwright records every run, including passing tests.
