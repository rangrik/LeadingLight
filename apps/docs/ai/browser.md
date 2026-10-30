---
title: The built-in browser
description: Browse the web beside your notes, watch an agent's tab live, point an agent at a page, and leave comments on what you see.
---

# The built-in browser <Badge type="info" text="Mac app" />

LeadingLight has a browser of its own, beside your notes. You and your agents use the same pages:
you can browse by hand, watch an agent click through a site live, hand it the exact tab you are
looking at, and comment on parts of a page for it to fix.

The browser runs on your Mac, with its own profile, separate from Safari or Chrome. Websites never
load inside your notes, and nothing of the browser's is written into your project folders.

## Open the browser

- Press **Browser** in the sidebar. The browser opens beside your notes. No project is needed.
- In a [project chat](/ai/project-chat), press **Browser** in the chat's header. The browser
  opens beside the chat, for that project's folder.

A new browser shows an address field and **New tab**. No website opens until you enter an address.

## Go to a page

Type in **Address** ("Search or enter address") and press <kbd>↩</kbd>.

- An address, such as `localhost:1420`, opens that page.
- Words that aren't an address open a DuckDuckGo search for them.
- As you type, pages from your history that match show below the field. Choose one with the
  arrow keys and <kbd>↩</kbd>, or press <kbd>esc</kbd> to dismiss them.

**Back**, **Forward**, **Reload** and **Stop loading** sit beside the address. Following a link
updates the address and title. A slow page can always be stopped, and a page that fails to load
shows an error while the controls keep working.

For safety, `javascript:`, `data:` and `file:` addresses, and addresses with a user name or password
in them, are refused.

### Allow a public site

Pages on your Mac, such as a site an agent serves from its folder, open straight away. The first
time a tab tries to open a public website, the browser asks first: "Allow example.com for
browsing? This also allows agents to reach this site." Press **Allow** and the page loads.

To see or take back what you allowed, open the **Browser menu** (the **…** button) and choose
**Site permissions**, then **Revoke** beside a site. Revoking blocks new requests to it; a page
already shown, or kept in the browser's cache, may still appear. A refused site never opens in
another browser behind your back.

## Use the page

Click, type, paste, select, scroll and drag in the page as you would in any browser. Right-click
for **Copy selection**, **Cut selection**, **Paste text** and **Select all**.

- **Dialogs.** When a page shows an alert, a confirm or a prompt, the browser shows "This page
  says" with the message and **OK** or **Cancel** (and a field for a prompt).
- **Uploads.** When a page asks for a file, the browser asks you to choose it. Only the files you
  choose are uploaded, and only to that page. **Cancel upload** sends nothing. If the page moves
  on or asks for a different file first, your earlier choice isn't used.

## Tabs

The tab strip shows your own tabs and any agent's tabs, which are labelled **Agent**.

- **New browser tab** (the **+** button) opens a tab of your own.
- <kbd>⌘</kbd>-click or middle-click a link to open it in another tab.
- Closing your last tab shows a new-tab view.
- **Reopen closed tab** in the **Browser menu** brings back the last tab you closed.

Your tabs and the sites you sign in to are kept when the app restarts: open the browser and choose
**Restore saved tabs**. Each project's browser has its own sign-ins. Agent tabs keep their own
cookies, apart from yours and from each other's.

## Bookmarks, history and downloads

All three are in the **Browser menu**.

- **Bookmarks.** Press **Bookmark this page** (the bookmark icon beside the address). Bookmarks stay
  after a reload. Open one, or remove it with **×**.
- **History.** Lists the title and address of each page you visited, with a search field. Open a
  page, remove one visit, or press **Clear history**.
- **Downloads.** Shows each file, and whether it is downloading, completed, or cancelled. Cancel a
  running download, or press **Save…** to save a completed one where you choose.

Opening a bookmark or a history entry opens it in the tab you have selected.

### Where downloads go

In **Settings › Browser › Downloads**:

- **Download location**: **Choose folder…** to pick a folder. Completed downloads from your own tabs
  are copied there. A file already there is never overwritten, and a download that failed is never
  reported as saved. **Reset to Downloads** goes back to your Downloads folder.
- **Ask where to save downloads**: when on, each completed download opens a Save dialog, starting
  in the chosen folder. Only one opens at a time, and cancelling it doesn't bring it back later; the
  file stays available through **Save…** in Downloads.

Downloads an agent makes in its own tabs are never copied out on their own.

## Find, zoom and page size

From the **Browser menu**:

- **Find in page**: type a word, then use **Next match** and **Previous match**. "No match" says
  when there is none.
- **Zoom in**, **Zoom out** and **Actual size** (which shows the current percentage).
- **Fit page to pane**: shrink a wide page to fit. With it off, a wide page starts at its left edge
  and you can scroll across.
- **Phone viewport** and **Desktop viewport**: show the page at that size. You and the agent both
  see that layout. The size stays fixed until you choose **Use pane size**, which makes the page
  follow the pane's width again. The current size shows at the bottom of the browser.

## Clear browsing data

Choose **Clear browsing data…** in the **Browser menu**, or in **Settings › Browser**. Choose what to
remove:

- **Browsing history**, for a **History time range**: **Last hour**, **Last 24 hours**, **Last 7
  days** or **All time**.
- **Cookies, website data and cache**. This is always for all time: it signs this workspace out of
  its sites and closes its own tabs.

Press **Clear browsing data** to confirm, or **Cancel** to keep everything. Bookmarks and downloaded
files always stay, and other projects' browsers are not changed. If an agent tab is open in this
workspace, clearing website data is refused until you close it.

**Settings › Browser › Personal browser history** also lists the pages you visited in the browser
you open from the sidebar, with a search field and **Remove** for each. Project browsers keep their
own history in their **Browser menu**.

## Inspect a page

The **Browser menu** has:

- **Console**: the page's messages, with a filter.
- **Network failures**: the requests that failed.
- **Page text**: the text the agent sees, with the references it uses to click.
- **Save screenshot** and **Open in default browser**.

Reading these doesn't take anything away from the agent: it still sees the same messages.

## Full view and keys

Press **Enter full view** (the arrows at the end of the tab strip) to give the browser the whole
window. **Return to split view**, or <kbd>esc</kbd>, brings it back, with the same tab and chat open.

While the browser has the focus, these keys act on the browser, not on your note tabs:

| Key | What it does |
| --- | --- |
| <kbd>⌘L</kbd> | Select the address |
| <kbd>⌘T</kbd> | New browser tab |
| <kbd>⌘W</kbd> | Close the browser tab |
| <kbd>⇧⌘T</kbd> | Reopen the last closed tab |
| <kbd>⌘F</kbd> | Find in page |
| <kbd>⌘R</kbd> | Reload |
| <kbd>⌘[</kbd> <kbd>⌘]</kbd> | Back and Forward |
| <kbd>⌘+</kbd> <kbd>⌘−</kbd> <kbd>⌘0</kbd> | Zoom in, zoom out, actual size |
| <kbd>⌃⇥</kbd> <kbd>⌃⇧⇥</kbd> | Next and previous tab |
| <kbd>⇧⌘B</kbd> | Enter or leave full view |

The **Edit** menu's Undo, Redo, Cut, Copy, Paste and Select All also act on the page while it has
the focus, and on your note again when you switch back.

## Watch an agent's tab

When an agent in a project chat uses the browser, the chat's header shows **Browser**. Press it to
watch the agent's tab live beside the chat: the page at its address, changing as the agent clicks.
What you see is what the agent saw: its screenshots and the **Console** show the same tab.

- If the agent opens more than one tab, choose which to watch in the tab strip.
- Each chat's agent has its own tab, with its own page and cookies, and each chat's **Browser** opens
  on its own agent's tab.
- If the agent's browser is kept from a public site, the view says so, with **Allow**.
- If the browser closes (it was idle, or it crashed), the view says so rather than showing a frozen
  picture, and offers to reopen a tab. When the agent opens a page again, the view shows it again.
- If the live picture stops arriving, the view says it is reconnecting.

You can click and type in the agent's tab too: you and the agent share the same page.

## Point the agent at your page

1. Open the page you want help with in one of your own tabs.
2. Press **Ask about page** (the speech bubbles beside the address).

The chat opens with that tab attached above the message box. Your next message names that exact tab,
and the agent can read and use it with its browser tools. You can remove the attachment before
sending. The tab goes only to that chat: switching to another chat doesn't share it.

**Copy agent instructions** in the **Browser menu** copies text that names this workspace and tab,
to paste to an agent yourself.

## Comment on part of a page

1. Choose **Comment on an element** in the **Browser menu**. The browser says "Click an element or
   drag an area to add feedback without activating the page."
2. Either:
   - **Click an element**, such as a button. It is outlined as you move over it, and clicking selects
     it without pressing it. You can still scroll while you choose.
   - **Drag across an area.** The area is captured as a screenshot, with its address and size.
3. Describe what should change.
4. Choose **Save comment** to keep it for this page, or **Ask with feedback** to send it to the
   chat now.

Press **Cancel selection** or <kbd>esc</kbd> to stop choosing.

### Try a style change

For an element, you can try a change before asking for it. Pick a **Style** (such as **Text
color**, **Background**, **Font size**, **Padding** or **Corner radius**), enter a **Value**, and
press **Preview**. The live page shows the change. **Reset** puts the element back as it was, while
leaving any other changes the page made itself. Previews are temporary: saving the comment or
closing the feedback resets them. <kbd>esc</kbd> closes an open menu first, then the feedback.

### Send saved comments

A page's saved comments are listed under it, with their screenshots. They stay when you close the
tab and come back to the same page. Remove one you no longer need, or choose **Ask about
comments** to send them all to the selected chat, with their addresses and screenshots. What you
send is frozen: later changes to the page don't change it.

To free space, **Settings › Browser › Saved feedback** shows how many comments are saved across all
projects, with **Remove saved comments…**. Comments already sent to a chat stay in that chat.

## Developer access for agents

An agent can ask for deeper access to a page (its structure, styles, network and performance)
through Chrome's developer tools protocol. This is off until you turn it on, and then each page
still needs your approval.

1. Turn on **Settings › Browser › Developer tools › Allow page developer access**.
2. When an agent asks, the browser shows "Developer access requested for …" with **Review access**.
   You see the website and the agent's reason.
3. Press **Allow for this page** to let it inspect this page, or **Deny**.

Until you allow it, nothing runs. An approval covers that one page, for up to 15 minutes. It ends
when the tab moves to another page or closes, when you press **Revoke access**, or when you turn the
setting off, which takes back every approval. The agent can't reach another tab, your browser
profile, its cookies or your files this way. Open **Developer tools** in the **Browser menu** to
review a request, revoke access, or see the same results yourself.

::: info Limits
- The browser plays no sound, and doesn't offer camera or microphone access.
- No extensions, and no importing a profile from another browser.
- Comments: up to 20 per page and 200 in all. When the store is full, the browser asks you to remove
  old ones.
- Style previews can't replace an element's text, and don't work inside a frame that is rotated,
  skewed or mirrored.
- Up to 24 open tabs per workspace; uploads of up to 20 files and 32 MB at a time.
:::

## Related

- [Project chat](/ai/project-chat)
- [Projects linked to folders](/ai/projects)
- [Saving web sources](/capture/web-sources)
- [Settings](/customize/settings)
