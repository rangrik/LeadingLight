---
title: FAQ and known limits
description: Common questions about LeadingLight, and what it doesn't do yet.
---

# FAQ and known limits

## About the app

### Is LeadingLight free?

Yes. LeadingLight is open source under the [MIT license](https://github.com/rangrik/LeadingLight/blob/main/LICENSE). The AI features use your own Claude Code or Codex plan; LeadingLight adds no charge of its own.

### Which Macs does it run on?

Apple Silicon Macs (M-series) with macOS 13 or later. Transcribing voice notes needs macOS 26. There are no Intel builds yet, because the helpers the app bundles are built for Apple Silicon only.

### Why does macOS warn me when I open it?

The previews aren't signed with an Apple Developer ID or notarized by Apple yet. Allow the app once in **System Settings › Privacy & Security**. See [Install](/guide/install#allow-the-app-to-open).

### Does it update itself?

Not yet. Quit the app and replace it with the newest release. Your notes stay where they are.

### Is there a Windows, Linux or iPhone app?

No. LeadingLight is made for the Mac first. The web app runs in any modern browser, including Safari on an iPhone, and a native iPad app is in preview. See [LeadingLight on iPad](/sync/ipad).

### Can I use it without an account?

Yes. Everything works without one. An account is only needed for encrypted sync between devices, or for using agents from a browser through your Mac.

## AI

### Do I need Claude or Codex?

No. Notes, links, types, capture and writing tools all work without them. The AI features work once [Claude Code](https://claude.com/code) or the [Codex CLI](https://developers.openai.com/codex/cli) is installed and signed in on your Mac. See [AI and agents](/ai/).

### Do I need an API key?

No, and LeadingLight never asks for one. Agents run through the command-line tool you already signed in to, and your plan's own limits apply. The bottom of the sidebar shows how much of each plan you've used.

### Can agents change my notes without asking?

Not unless you allow it. By default an agent asks before each change to a page, and you can decline. You can give a thread more access, or use **Plan mode**, where nothing changes until you say so. Every agent action can be undone as a whole from the page's history, as long as you haven't changed those pages since. See [Ask Claude about a page](/ai/ask#approvals).

### Why don't agents work in the web app?

Agents run on your Mac, through its Claude Code or Codex. The web app can use them only through a Mac you've paired with it, while that Mac is awake and LeadingLight is open. See [Agents from a browser](/sync/pairing).

## Your notes

### Where are my notes, and how do I back them up?

In the Mac app, in `~/Library/Application Support/com.leadinglight.app/`. Quit the app and copy that folder to back up. See [Your data and privacy](/guide/privacy).

### What happens if I delete a page?

It's removed from your lists at once, after you confirm. There is no trash view to restore it from yet, so back up before deleting anything you might want.

### Can I import from Notion, Obsidian or Capacities?

Not as a file import. You can paste Markdown into a page and it becomes formatted text, headings, lists, code and all; paste into the title of a new page and its first heading becomes the title. See [Pasting Markdown](/write/markdown).

### Can I export my notes?

There is no export command. Your notes are in a standard SQLite file you own, and you can copy text out of any page.

### Does sync merge edits made on two devices at once?

Sync is in preview. If two devices change the same page while apart, one of the changes is kept as a separate copy rather than merged word by word. See [Accounts and encrypted sync](/sync/).

## Not there yet

These are known gaps. Each has a reason and a plan to come back to it.

- **Search across all notes** (⌘K), and a **trash** with restore.
- **Math blocks**, **block references** and **saved queries**.
- **A graph view** of links.
- **Stickers**, images as pages, and opening the same page twice side by side.
- **Editing values inside lists**, and editing an embed in place.
- **Intel builds**, **signed and notarized downloads**, and **automatic updates**.
- **Sync for everyone.** Accounts and sync are in private preview, and Google sign-in is in testing.
- **iPad on the App Store or TestFlight.**

## Get help

- Report a bug or ask for a feature in [GitHub Issues](https://github.com/rangrik/LeadingLight/issues).
- See what changed in each version in the [changelog](https://github.com/rangrik/LeadingLight/blob/main/CHANGELOG.md).
