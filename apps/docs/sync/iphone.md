---
title: LeadingLight on iPhone
description: Capture a thought, return to your writing, and find your notes on iPhone.
---

# LeadingLight on iPhone <Badge type="warning" text="Preview" />

The iPhone app shares the iPad app's editor, local storage and encrypted workspace. It needs
iOS 16.4 or later. No account is needed to write or capture offline.

## Start with one thing

**Today** is a quiet starting point. Capture a thought, continue your last note, or write about
today. Only three recent captures appear here. There are no unread badges or streaks to catch up on.

**Today** and **Notes** sit in a glass bar that floats at the bottom of the screen, with **Search** and
**Quick capture** beside it. The bar hides while the keyboard is open. Pages open one at a
time. The round back button above a page returns to the page before it, or to Today or Notes when
there is none. **⋯** (**Page actions**) at the other end holds the page's actions, including
**History and authorship**.

With **Increase Contrast** on, the bars and round buttons turn solid; with **Reduce Motion** on,
nothing on them moves.

## Capture first, organize later

Tap the round **+** beside the bar, type your idea and tap **Save**. You do not have to choose a
project, tag or type. Words save as you go. The **✕** button also keeps your words; **Open note**
saves and opens the full page. **Save** and **✕** stay at the top while the contents scroll above
the keyboard, including in landscape. If saving fails, the box keeps your draft and scrolls the retry message into view.

A lone web address defaults to **Link only**, so keeping the address does not need a connection.
You can choose a downloaded copy instead. The mic records a voice note using the existing recorder.

Find saved ideas under **Notes › Captures**. You can organize or review them whenever you want.

## Find and resume

Tap the magnifying glass beside **Quick capture** from Today, Notes or an open page. Search finds titles and words in your notes offline. Tap **Pages**, **Types** or **Create** to narrow the same query. With a hardware keyboard, **⌘K** opens search.

Tap **New page** for a blank note. To create a specific type, tap **Create** and its icon, or enter **new meeting Friday review** and tap the result. It opens a Meeting with the title filled in, ready to write. **Notes** keeps your recent notes and **Browse by type** one tap away.

Tap **Today** while writing, then **Continue writing** to return. Your editor stays open while you
look around. Page properties sit behind **Page details**, and sidenotes appear below the text.

### Mermaid diagrams

[Mermaid diagrams](/write/blocks#mermaid-diagram) work in document bodies on iPhone, including
pages created from Markdown. Paste a `mermaid` fence or choose **Mermaid diagram** from `/mermaid`.
The source stays editable above the live preview. Tap **Hide source** for more room to read the diagram.
Diagrams fit the phone's width, follow its appearance and render offline in the installed app.

## Settings and sync

Open **Settings** from Today or Notes. Light and dark follow the device's system setting by default.
**Notes › Account and sync** opens **Account and devices**, where **Connect this iPhone** shows a code to
type on a device that already syncs.
See [Accounts and encrypted sync](/sync/). Sync is optional; local saving never waits for it.

## Agents on your Mac

Connect your Mac in **Settings → Account and devices**, then open **Notes → Remote work** to start or continue
project work. Both devices only need LeadingLight and internet access; your Mac runs the agent and keeps working when the phone
is closed. The phone needs no workspace sign-in. See [Mac agent setup](/sync/mobile-agents).

## Get the app

LeadingLight is a private app, with no App Store or TestFlight version. An iPhone registered to the
project installs the build attached to each
[GitHub release](https://github.com/rangrik/LeadingLight/releases), then updates itself as on
[iPad](/sync/ipad#update-the-app). On any other iPhone, build the universal iOS target using
[Build from source](/develop/#build-for-iphone-and-ipad). A device build needs development
signing and Developer Mode before it can be installed. Native hardware acceptance is tracked in
[the iPhone QA report](https://github.com/rangrik/LeadingLight/blob/main/docs/QA_IPHONE.md).

The phone layout also works in Safari with the web app. Safari keeps notes in IndexedDB; the installed
app uses SQLite. Connect both to your workspace if you want the same notes in both.

Private release builds are named **LeadingLight**, with the cream LeadingLight mark on a dark
background. On iOS 26 and later the mark takes on the system's glass look, including the dark,
clear and tinted Home Screen styles. **LeadingLight iPhone Dev** is a separate app with its own local notes. Connect the
release app to the same workspace before removing a development app. A build you install yourself
works until its signing profile expires.
