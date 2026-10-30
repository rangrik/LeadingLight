---
title: Your data and privacy
description: Where LeadingLight keeps your notes, what stays on your Mac, and the few times something leaves it.
---

# Your data and privacy

LeadingLight is local first. Your notes are kept on your device, and nearly everything the app does runs there. This page lists where your notes live and every case where something leaves your Mac.

## Where your notes live

| Where you use it | Where notes are kept |
| --- | --- |
| Mac app | A SQLite file, `leadinglight.db`, in `~/Library/Application Support/com.leadinglight.app/`. Images and files you add are kept in an `assets` folder beside it. |
| Web app | Your browser's storage for that site (IndexedDB). Clearing the site's data in the browser deletes them. |
| iPad | A SQLite file inside the app, as on the Mac. |

Page history and authorship are kept in the same store, next to the pages. Nothing needs an account.

## What runs on your device

These features never send your words anywhere:

- **The editor, links, backlinks, types, lists and search menus.**
- **Writing tools.** Focus mode, syntax highlight, the style check and counts run in the app. The grammar check uses Harper, a checker that runs on your device. **Listen** in the writing coach uses a voice installed on your Mac, never an online voice.
- **Voice transcription** uses Apple's speech recognition on your Mac (macOS 26 or later). Your audio isn't sent away to be transcribed.
- **History and authorship.**

LeadingLight has no analytics or tracking of its own.

## When something leaves your Mac

| When you… | What is sent, and where |
| --- | --- |
| Search Unsplash for a cover | The words you search for, and which photo you pick, go to LeadingLight's small image service, which asks Unsplash. It never receives your notes. Photos load straight from Unsplash. |
| Use a cover or an embed from a link | Your device loads that address, as a browser would. |
| Save a web page | LeadingLight fetches the page and, if you choose, its images and media from that website. |
| Ask Claude or Codex, or use any agent feature | Claude Code or Codex on your Mac sends what the agent reads (your question, the page, and pages or files it is allowed to read) to Anthropic or OpenAI, under your own account and their terms. Agents ask before they change anything, unless you give them more access. |
| Let Tail read along | Through Claude Code or Codex, Tail sends the lines around where you paused and a short digest of what changed. Words and properties come only from the types you tick under **Settings › AI › Tail › Reads on**; the titles and types of all pages go too, so names can be linked. Sidenotes stay private. |
| Check for Claude Code and Codex updates | The app looks up the newest version where your copy updates from (npm or Homebrew). You can turn off **Check for updates** in **Settings › AI**. |
| Use the built-in browser | It loads the sites you or an agent open, as any browser would. Its history, site data and downloads stay on your Mac. |
| Turn on encrypted sync | Your notes are encrypted on your device before they're uploaded. The service stores only encrypted data and can't read it. Your sign-in (Google or GitHub) identifies your account. |
| Use agents from a browser | Your browser and your Mac exchange messages through an encrypted relay. The relay can't read prompts, answers or tool results, and your Claude Code or Codex sign-in never leaves the Mac. |

LeadingLight never asks for or stores a model API key. Agents use the Claude Code or Codex account you already signed in to on your Mac, and that plan's limits apply. The app doesn't read their sign-in secrets either: it asks the tools themselves, for example to show how much of your plan you've used.

## Encrypted sync and your recovery key

If you turn on sync, a **recovery key** encrypts your notes. It is kept on your devices, never sent to the service. New devices join by being approved from a device that already has the key.

::: danger Keep your recovery key safe
If you lose every device and the recovery key, your synced notes can't be decrypted by anyone, including the service. Notes still on a device are unaffected.
:::

→ [Accounts and encrypted sync](/sync/)

## Back up your notes

In the Mac app, quit LeadingLight and copy `~/Library/Application Support/com.leadinglight.app/` somewhere safe, or let Time Machine back it up. To restore, quit the app and put the folder back.

To go back to an earlier version of one page, use its history instead. → [History and authorship](/organize/history)
