---
title: Voice notes
description: Record a voice note on any page, get the words written out on your Mac, and turn passages into ideas and tasks.
---

# Voice notes

A voice block records you, keeps the original audio, and writes the spoken words into the page below
it. You can then pick passages from the transcript and keep them as ideas or tasks, while the recording
and its transcript stay as they were.

## Record a voice note

1. On a page, type <kbd>/</kbd> and choose **Voice recording**.
2. Click **Record**. The first time, allow LeadingLight to use the microphone.
3. Speak. The block shows **Recording** with the time.
4. Click **Stop and transcribe**.

The audio is saved in the block first, then the transcript is added as ordinary, editable text just
below it. Reopening the page keeps both.

To record from anywhere instead, use the mic in [Quick capture](/capture/quick-capture#record-a-voice-note).
There the recording starts as soon as you press the mic.

### What the block says

| The block shows | What it means |
| --- | --- |
| **Waiting for microphone…** | The microphone is starting, or waiting for your permission |
| **Recording · 0:12** | Recording, with the time so far |
| **Saving audio…** | The audio is being saved |
| **Transcribing on this Mac…** | The words are being written out |
| **Voice recording · transcript added below** | Done |

## Transcription happens on your Mac <Badge type="info" text="Mac app" />

The words are written out on your Mac with Apple's speech recognition, which needs **macOS 26 or newer**.
Your audio isn't sent anywhere to be transcribed. The first time, macOS may download its speech model,
which can take a moment.

### Recording in a browser <Badge type="info" text="Browser" />

In a browser you can record, and the audio is saved and plays back. The block explains that
transcription needs the Mac app on macOS 26 or newer.

## Cancel a recording

Click **Cancel** while recording, or leave the page. The microphone stops and no transcript is added.

## When something goes wrong

Nothing you recorded is thrown away because of a later problem, and LeadingLight never makes up words.

### The microphone

If the microphone can't be used, the block says why and what to do. Then click **Record** to try again.

| Problem | What the block tells you |
| --- | --- |
| Access is turned off | Allow LeadingLight in **System Settings › Privacy & Security › Microphone**, or allow the site in your browser |
| No microphone is found | Connect a microphone and try again |
| The microphone can't start | Check your input device, and close other apps that are using it |

### Transcription fails or finds no speech

The original audio stays in the block and still plays. The block explains what happened and offers
**Retry transcription**. No text is added.

### The audio can't be saved

The block offers **Save recording**, which tries again with the same audio. Transcription waits until
the audio is saved.

### You leave while the audio is saving

Once you click **Stop and transcribe**, the take is kept, even if you leave the page at once. It finishes
saving into its own voice block. When you reopen the page, you can play it and press
**Retry transcription**.

- Edits you made to the rest of the page are kept.
- If you come back and start writing elsewhere on the page before the save finishes, your cursor stays
  where it is, and undoing your next edit doesn't remove the audio.
- Two takes that finish saving after their page is closed are both kept.
- If you delete the voice block before the save finishes, it doesn't come back.

## Undo a transcript

Press <kbd>⌘Z</kbd> right after the transcript is added to remove only the transcript. The audio stays,
and **Retry transcription** is offered. Press <kbd>⇧⌘Z</kbd> to bring the transcript back, once.

## Turn a recording into ideas and tasks

You choose what to keep from a recording. The original audio and transcript stay intact.

1. On the recording, click **Review transcript**. A window shows the **Original transcript**, and you can
   play the audio. Nothing is made yet.
2. Select the passage you want, such as "Ask Sam about colors", and click **Create from selection**.
3. In **Create from recording**, choose the **Type**, such as Task or Idea. **Title** suggests a title
   from the first words; type your own or leave it blank to use the first three words. Choose a
   **Project** if you like. **Body** shows the passage.
4. Click **Create task** (or **Create idea**, and so on, by the type).

The new page has the passage as its body, the project you chose, and a **Source recording** link back to
the recording. Point at that link to see the key that opens it (<kbd>⌘</kbd>-click). On the recording's
page, a link to the new page appears beside the recording. The audio and the full transcript don't
change.

### Keep the whole transcript as an idea

In **Review transcript**, click **Use whole transcript**, then **Create from selection**. Choose Idea and
leave the title blank: the idea takes the first three words as its title, and its body keeps every word
of the transcript and a source link. The transcript on the recording's page stays editable.

### The review shows the original words

You can edit the transcript on the page like any text. **Review transcript** still offers the original
words, as they were transcribed, so what you create comes from what was said. Your edits on the page are
kept.

### If you cancel, or the save fails

Cancelling, or a save that fails, leaves the audio and transcript as they were. After a failure your
title, type and project choices are kept, so you can try again. Retrying, or double-clicking the create
button, makes only one page.

If the recording's page changes while the review is open, LeadingLight asks you to close the review and
open it again, and makes no page.

### Undo the new link

Undo on the recording's page removes only the link to the new page. The audio, the full transcript and
the new page are kept. Redo puts the same link back, without making another page.

## Recordings in Captures

A recording made in Quick capture shows in [Captures](/capture/inbox) as **Voice recording**. Opening it
shows its page with the audio and the original transcript.

A recording whose transcription failed shows in Captures too, so you can come back to it. When you retry
and it works, **Review transcript** becomes available; nothing is made from it on its own.

Saving a new recording on a page you already reviewed puts that page back in **To review**.

::: info Limits
- Voice blocks recorded with an earlier version of LeadingLight have no **Review transcript**. Their
  audio and text are still there to play and edit.
- If saving the audio fails after you have left the page, it can't be retried from the reopened page.
:::

## Related

- [Quick capture](/capture/quick-capture)
- [The capture inbox](/capture/inbox)
- [Blocks](/write/blocks)
- [Tasks](/organize/tasks)
- [Privacy](/guide/privacy)
