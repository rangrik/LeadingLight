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

The bottom bar keeps **Today**, **Capture** and **Notes** within reach. Pages open one at a time.
The arrows above a page take you back and forward through the pages you opened.

## Capture first, organize later

Tap **Capture**, type your idea and tap **Save**. You do not have to choose a project, tag or type.
Words save as you go. **Close** also keeps your words; **Open note** saves and opens the full page.
**Save** and **Close** stay at the top while the contents scroll above the keyboard, including in
landscape. If saving fails, the box keeps your draft and scrolls the retry message into view.

A lone web address defaults to **Link only**, so keeping the address does not need a connection.
You can choose a downloaded copy instead. The mic records a voice note using the existing recorder.

Find saved ideas under **Notes › Captures**. You can organize or review them whenever you want.

## Find and resume

**Notes** searches titles and saved text on this device. Clear the search to return to recent notes,
or use **Browse by type**. The plus button creates a new page.

Tap **Today** while writing, then **Continue writing** to return. Your editor stays open while you
look around. Page properties sit behind **Page details**, and sidenotes appear below the text.

## Settings and sync

Open **Settings** from Today or Notes. Light and dark follow the device's system setting by default.
**Notes › Account and sync** connects the app to the same encrypted workspace as your other devices.
See [Accounts and encrypted sync](/sync/). Sync is optional; local saving never waits for it.

## Get the app

This is a source preview, with no App Store or TestFlight release yet. Build the universal iOS target
using [Build from source](/develop/#build-for-iphone-and-ipad). A device build needs development
signing and Developer Mode before it can be installed. Native hardware acceptance is tracked in
[the iPhone QA report](https://github.com/rangrik/LeadingLight/blob/main/docs/QA_IPHONE.md).

The phone layout also works in Safari with the web app. Safari keeps notes in IndexedDB; the installed
app uses SQLite. Connect both to your workspace if you want the same notes in both.

Private release builds are named **LeadingLight**, with the cream LeadingLight mark on a dark
background. **LeadingLight iPhone Dev** is a separate app with its own local notes. Connect the
release app to the same workspace before removing a development app. A directly installed build
works until its signing profile expires; it is not an App Store or TestFlight installation.
