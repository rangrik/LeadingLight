---
title: LeadingLight on iPad
description: Write offline on an iPad with the same pages and editor as the Mac, and connect it to your encrypted workspace.
---

# LeadingLight on iPad <Badge type="warning" text="Preview" />

The iPad app has the same pages, types and editor as the Mac app. Your notes are stored on the
iPad itself, so you can write anywhere, with or without a connection. Connect it to your workspace
to have your Mac's notes there too.

It needs iPadOS 16.4 or later.

The same iOS target also supports [iPhone](/sync/iphone), with a capture-first phone interface.

## How to get it

There is no App Store or TestFlight version yet. Today there are two ways to use LeadingLight on
an iPad:

- **Build it yourself** and install it on your own iPad from a Mac with Xcode. See [Build it
  yourself](#build-it-yourself) below.
- **Use the web app in Safari.** It works by touch at iPad size and keeps working offline once
  opened. See [Accounts and encrypted sync](/sync/#use-the-web-app-on-a-phone-or-tablet).

## Write without a connection

Everything you write is saved on the iPad straight away. Saving never waits for the network. Create
a page with no connection, leave the app and come back: the page and its words are there.

## Narrow windows

The app fits the window it is given, including a narrow window beside another app.

- Open the sidebar and choose a page: the sidebar closes and the page fills the space.
- In **Settings**, choose a section such as **Appearance**: the settings sidebar closes and the
  section shows.
- The page, its toolbar and Quick capture stay inside the window.

Light and dark follow the iPad's own appearance setting.

## The look

The app follows iPadOS's glass design. The sidebar runs from the top edge of the screen to the
bottom, and the page fills the rest with no frame around it. Toolbar buttons sit on round glass
buttons: the sidebar button on its own, Back and Forward together, and the page's actions together.
Text fades out under the toolbar as you scroll. Dialogs dim what is behind them without blurring it.

## The onscreen keyboard and rotation

When the onscreen keyboard opens, the app shrinks to the space left above it, so you can scroll the
page and keep the line you are writing in view. Controls stay clear of the status bar and the home
indicator.

Above and below the sidebar its colour reaches the screen's edges; above and below the page, the
page's colour does, in both light and dark appearance.

Rotate the iPad while you write and the cursor stays in view above the keyboard, with your text,
selection and focus kept. You don't need to type or tap again. If you scroll up to read right after
rotating, the app doesn't pull you back to the cursor. Coming back to the app from the background
works the same way.

## Quick capture by touch

Tap **Quick capture**, type an idea such as "Remember this", and tap **Save**. The idea is saved and
the box closes. Everything works by touch, with no hardware keyboard:

- Tap **Close** to close the box without saving.
- **Save** and **Open beside** work for a webpage too.
- An idea opened beside a page in a narrow window still leaves the sidebar button on the page.

Quick capture opens inside the app. See [Quick capture](/capture/quick-capture).

## Attachments

Images, audio, video and PDFs you add are saved in the app's own storage on the iPad.

- Tap a PDF or another file to preview it with the system's Quick Look, even with no connection.
  Close the preview to return to the same page.
- If a file is missing or can't be previewed, you see a clear error and stay on the page.
- After an app update, your images, covers, icons, recordings and PDFs still open from the same
  saved files. Nothing needs adding again.

## What stays on the Mac

The iPad app has your pages and editor, but not the parts that run on a Mac:

- **Agent execution.** Connect to a Mac in **Settings → Devices** to start and control shared
  project chats through an encrypted connection inside LeadingLight. Agents keep running on the Mac. See
  [Agents from iPhone and iPad](/sync/mobile-agents). Ask about selected note text, Tail, task
  assignment and the Feed remain Mac features.
- **The built-in browser.**
- **Global shortcuts** such as <kbd>⌃⌥I</kbd> for idea capture, the menu bar, and opening at login.

## Connect to your workspace

To see your Mac's notes on the iPad, connect both to the same workspace account:

1. On the iPad, open **Account and sync › Account** and press **Connect your workspace**.
2. Your browser opens your workspace at **leadinglight.app**. Sign in with the same provider you use on your Mac, check that the
   code matches the one on the iPad, and press **Connect this device**.
3. Go back to LeadingLight. Wait for **Sync** to say **Up to date** before you go offline.

Your notes, history, images and files then download to the iPad and stay there for offline use.
Offline edits sync when the app is open and online again. The Mac doesn't need to stay awake once
it has uploaded its changes. The full steps, and what to do with your recovery key, are in
[Accounts and encrypted sync](/sync/#in-the-mac-or-ipad-app).

The iPad keeps its sign-in in the Keychain. **Sign out** ends that connection and keeps the notes
on the iPad.

::: info Limits
- Attachments sync up to 32 MB a file.
- Changes to types and properties made after the iPad first joins don't sync; page content and
  property values do.
- Very long pages and multitasking resizes pass in testing, but haven't yet been checked on a real
  iPad.
:::

## Build it yourself

You can build the iPad app from source on a Mac with Xcode, CocoaPods, pnpm and Rust. The commands
(`pnpm ios:init`, `pnpm ios:build` and the rest) are in [Build from source](/develop/).

- A build signed with a free Apple account can be installed on your own iPad, after you turn on
  Developer Mode there. It shows as **LeadingLight Dev**, keeps its own notes apart from any other
  copy, and opens without a development server. Its signing lasts seven days; then build and
  install it again.
- A TestFlight build needs a paid Apple Developer membership and an App Store Connect record.

## Related

- [Accounts and encrypted sync](/sync/)
- [Quick capture](/capture/quick-capture)
- [Build from source](/develop/)
- [Install LeadingLight](/guide/install)
