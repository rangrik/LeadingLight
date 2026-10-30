---
title: Quick capture
description: "One box for whatever comes in, from anywhere on your Mac: words become an idea, an address a saved webpage, the mic a voice note."
---

# Quick capture

Quick capture is one box for whatever comes in. Words become an idea, a web address becomes a saved
webpage, and the mic records a voice note. Everything you capture lands in
[Captures](/capture/inbox), ready to review when you have time.

## Open the box

- Press <kbd>⌃⌥I</kbd>.
- Or click **Quick capture**, the plus at the bottom of [the bar](/workspace/bar). Point at it to see
  the key.

### From anywhere <Badge type="info" text="Mac app" />

In the Mac app, <kbd>⌃⌥I</kbd> opens the box over whatever app is in front, without bringing
LeadingLight forward. Everything on this page works the same there. When the box closes, the keyboard
goes back to that app. See [Idea capture](/capture/idea-capture#from-any-app) for how the panel
behaves.

In a browser, the box opens inside the LeadingLight window.

## Words become an idea

Type a thought and press <kbd>⌘↩</kbd>. It is saved as an Idea page, tagged in-the-middle, and
**Captures** lists it, not yet reviewed, as **Captured idea**.

Everything about writing an idea, from the title line and body to links and projects, is in
[Idea capture](/capture/idea-capture).

## An address becomes a webpage

Paste or type a single web address, such as `https://example.com/soil-guide`, in the title line or the
body. The box changes:

- The header reads **Webpage**, with a globe, instead of **New idea**.
- It shows three choices: **Link only**, **Text only** and **Text and media**. **Text and media** is
  picked at first.
- Nothing is saved while you decide. No idea page is made for the address.

Then:

| Key | What it does |
| --- | --- |
| <kbd>⌘↩</kbd> | Saves the webpage and closes the box |
| <kbd>⇧⌘↩</kbd> | Saves the webpage and opens it beside the page in view, as an idea does |

The saved page has the webpage's title and its source address as a link. **Captures** lists it, not
yet reviewed, as **Saved webpage**. What each choice keeps is explained in
[Saving web pages](/capture/web-sources).

### An address with words

If you type words after the address, such as " good for the beds", the box goes back to **New idea**.
The words are saved as an idea, with the address as a link at the top of its body.

### When a webpage can't be saved

While the page is fetched, the box shows **Saving webpage…**. If the website refuses, the box stays
open with the reason and a **Save link instead** button. No page is made until you choose. Press
**Save link instead** to save just the link and close the box.

If the page is saved but some of its pictures or other media couldn't be downloaded, the box stays open
with **Saved** and how many media files the page marks as not saved. Press <kbd>Esc</kbd> or
<kbd>⌘↩</kbd> to close it.

To cancel a slow save, press <kbd>Esc</kbd> while it is saving. The box closes at once and no page is
made.

## Closing never loses what you typed

However the box closes, what you typed is kept.

- Words are saved as you go, so they are kept whether you press <kbd>Esc</kbd>, click outside the box,
  or the panel hides.
- Something that might become an address, such as "ht" or "http", isn't saved while you are still
  typing it. If the box closes at that point, it is saved as an idea, which you can delete like any page.
- A full address is saved as a webpage when the box closes, with the choice you picked. If the website
  can't be copied, its link is saved instead.
- An unsafe address, such as one starting with `javascript:`, is refused as a webpage. Its words are
  kept as an idea, as plain text with no link.

## Record a voice note

1. Open the box and click the mic, **Record a voice note**, at the left of the footer.
2. A voice block opens in the body and starts recording at once. It shows **Recording** with the time,
   a **Stop and transcribe** button and a **Cancel** button.
3. Click **Stop and transcribe**.

The audio is saved in the body, and **Captures** lists the page as **Voice recording**.

- In the Mac app, the transcript follows the audio and names the page.
- In a browser, the block says that transcription needs the Mac app. The audio is still saved.

While the body holds a recording, the mic in the footer is turned off. To record another take, use the
**Record** button on the block itself.

If you press <kbd>Esc</kbd> or click outside the box while it is still recording, recording stops and
the recording is not kept, as when you leave a page that is recording. Words you typed stay saved.

If you close the box right after you stop, while the audio is still saving, the recording still
finishes saving in Captures, even if you typed no title. Open it there to play it, or to press
**Retry transcription**. If you delete its voice block before the save finishes, it doesn't come back.

More about recordings, transcripts and microphone problems is in [Voice notes](/capture/voice).

## The project guess

When you type words, tail may guess which project they belong to. It waits for at least three words.

- The project picker reads the project's name with a question mark, such as **Garden?**, in muted text.
- If the words read like a task, the footer offers **⌃↩ Task in Garden**. Press <kbd>⌃↩</kbd> and the
  box closes; the words are saved as a task in Garden, and Today lists it.
- If they don't, the footer offers **⌃↩ In Garden**. Press <kbd>⌃↩</kbd> to save them as an idea in
  Garden.
- <kbd>⌘↩</kbd> saves as usual, with no project, and ignores the guess.

If you pick a project yourself, the guess gives way: the picker shows your project with no question
mark. For a task, the footer then offers **⌃↩ Task in** your project. For an idea there is no
<kbd>⌃↩</kbd> line, since <kbd>⌘↩</kbd> already saves it in your project.

A webpage gets no guess and no <kbd>⌃↩</kbd>; the guess is for words.

The guess comes from tail. When **Settings › AI › Tail** is Off or Quiet, the box doesn't guess.
See [Tail](/ai/tail).

## Keys

| Key | What it does |
| --- | --- |
| <kbd>⌃⌥I</kbd> | Open or close the box |
| <kbd>⌘↩</kbd> | Save and close |
| <kbd>⇧⌘↩</kbd> | Save and open beside |
| <kbd>⌃↩</kbd> | Save into the guessed project, as a task or an idea |
| <kbd>Esc</kbd> | Close; cancels a webpage that is still saving |

## Related

- [Idea capture](/capture/idea-capture)
- [Saving web pages](/capture/web-sources)
- [Voice notes](/capture/voice)
- [The capture inbox](/capture/inbox)
- [Tail](/ai/tail)
