---
title: What is LeadingLight
description: LeadingLight is a local-first notes app for macOS where every note is an object with a type, written in a block editor and linked to everything else.
---

# What is LeadingLight

LeadingLight is a notes app for the Mac. You write in a calm block editor, and every note is an **object** with a **type**: a page, a person, a book, a meeting, a project, a task, an idea, or a type you make yourself. Notes link to each other in both directions, so what you write keeps its connections.

It is built in the spirit of [Capacities](https://capacities.io), with writing tools after [iA Writer](https://ia.net/writer), and it keeps your notes in a file on your own Mac.

<img class="shot" src="/screenshots/page-header.webp" alt="A Book page for Dune with a cover, an icon, a description and properties for author, rating, status and tags" />

::: warning Early preview
LeadingLight is in early development, and you should expect rough edges. The downloads are previews for Apple Silicon Macs running macOS 13 or later. They are not yet signed or notarized by Apple, so macOS asks you to allow the app the first time. See [Install](/guide/install).
:::

## What you can do with it

**Write.** A block editor with Markdown shortcuts, a slash menu, headings, lists, to-dos, toggles, quotes, code, tables, columns, images, video, audio, files and embeds. Select blocks and drag them anywhere. Paste Markdown and it becomes formatted text. → [The block editor](/write/editor)

**Give notes a shape.** Each type brings its own properties: a Book has an author, a rating and a status; a Meeting has a date and attendees. Add any property to any page, make your own types, and save a page's shape as a new type. → [Objects, types and links](/guide/concepts)

**Connect.** Type `@` or `[[` to link a page inside a sentence. A link alone on its line can show as a card or as the page itself. Every page lists its backlinks, with the line around each, and offers to link mentions you haven't linked yet. → [Links and backlinks](/organize/links)

**See everything of a kind.** Open Books, People or any type as a list, table, gallery or board, sorted and grouped the way you like. → [Lists, tables and boards](/organize/views)

**Capture.** Press <kbd>⌃⌥I</kbd> in any app to note an idea without leaving what you're doing. Save a web page to read offline, or record a voice note, have it transcribed on your Mac, and turn parts of it into tasks. → [Idea capture](/capture/idea-capture)

**Write better, quietly.** Focus mode, parts-of-speech highlighting, a style check for fillers and clichés, an on-device grammar check, and live counts. → [Writing tools](/write/writing-tools)

**Work with Claude or Codex.** Ask about the page you're on, chat with a folder on your Mac, or assign a task to an agent that reports back beside your page. It all runs through the Claude Code or Codex you have installed and signed in to. LeadingLight never asks for an API key and doesn't bill you. → [AI and agents](/ai/)

**Keep it yours.** Pick one of 23 themes, follow the system's light and dark, change any shortcut, and keep a full history of every page with the option to restore it. → [Appearance and themes](/customize/appearance)

## Where it runs

| | What you get |
| --- | --- |
| **Mac app** | Everything. Notes are stored in a SQLite file on your Mac. The menu bar, the global <kbd>⌃⌥I</kbd> capture key, on-device transcription and all agent features need the Mac app. |
| **Web app** | The same editor and notes, kept in your browser's storage. It works offline once loaded, on a computer, a phone or an iPad. Agents run only through a Mac you pair with it. <Badge type="warning" text="Preview" /> |
| **iPad** | A native app that shares the editor and keeps notes offline. It is not on the App Store yet. <Badge type="warning" text="Preview" /> |

Accounts and encrypted sync between these are optional and in private preview. Without them, each device keeps its own notes. See [Accounts and encrypted sync](/sync/).

## Next steps

1. [Install LeadingLight](/guide/install) on your Mac.
2. Follow [Your first ten minutes](/guide/first-steps) to write a page, link it and give it a type.
3. Read [Your data and privacy](/guide/privacy) to see what stays on your Mac and what doesn't.
