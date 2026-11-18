---
title: Mail
description: Mail reads your new Gmail, says what it will cost you, and takes you through it one mail at a time.
---

# Mail <Badge type="warning" text="Preview" />

Mail is not an inbox. It tells you what your new mail will cost you, takes you through it one
mail at a time, and ends.

::: warning Preview
Mail is being tried for the owner's personal use. Google has not yet reviewed its access to
Gmail, so Google shows an unverified-app notice when connecting. The reader that writes each
mail's lines runs only in the Mac app.
:::

## Connect accounts

Sign into LeadingLight through **Account and sync**, then open **Mail** in the sidebar (or press
<kbd>⌥⌘M</kbd>) and choose **Connect Gmail**. Signed out, the button reads **Sign in to connect
Gmail** and opens **Settings › Account and devices**. On the Mac, Google opens in Safari. Sign into
the same LeadingLight workspace in Safari before connecting. Allow access, and Safari returns to
Mail in the app with the account ready. If Safari waits, choose **Open LeadingLight**. Returning
to the app yourself also refreshes Mail. In the web app, the connection stays in the browser.
If you close Google before finishing, choose **Open Google again** to retry.
If you refuse the permission to put mail away, nothing is connected and Mail says why.

Add a second account with the accounts button in Mail's header (**Mail accounts**), where you can
also mark each account Personal or Work, reconnect it, or disconnect it. Disconnecting removes
saved access; your mail stays in Google. When an account needs signing in again, Today shows a
second row, such as "Work mail needs reconnecting", with **Reconnect**.

The first time, Mail offers to **Start fresh** from the last 3, 7 or 14 days. Older mail stays in
Gmail. This is a one-time starting date for the workspace. Each connected device checks for new
mail every minute and catches up when you return. Your Later choices, account labels and progress
through today’s mail follow you. You can close either Mac.

## Going through mail

Today shows one row: how many mails need you, about how long, the nearest date ("nothing due
before Wed", "one is due today"), and who is upset, when someone is. Press **Go through**.

Each mail starts with the same tags, in the same order:

- What it is: Nothing to do, Quick answer, Needs a reply or Needs work, with the minutes it takes.
- When: **Today** or **Tomorrow** in amber, **By Fri, Nov 20 · 6 days left**, **No deadline**, or
  **Was Fri, Nov 13** for a date that has passed.
- Which account it came to, **Work** or **Personal**, with its colour. Hover it to see the address.
- **New sender** on the first mail from an address.

Then a headline, who wrote it with their address, and three lines: what happened, where it
stands, and your part. The mail itself is underneath; **Show all** (O) opens it with its From,
To and Sent lines. Mail due today or tomorrow comes first.

Four choices, always in the same order:

- **Reply** (R): two short drafts, or write your own. The form shows the address it goes to (the
  mail's Reply-To when it has one) and the account it goes from. Press <kbd>⌘↩</kbd> to send.
  Nothing is sent for 8 seconds, so Undo works.
- **Done** (E): archived and marked read in Gmail.
- **Make a task** (T): a Task page with the title, due date and a link back to the mail. It keeps
  the reader's two lines, never the mail's own text. Tick **Also reply** to tell the sender.
- **Later** (L): stays in Gmail and comes back in your next look. If it has a date, the toast
  says when it is due, and on that day Today's row brings it back.

Enter takes the filled choice. J and K move between mails, Esc goes back, Z undoes. A look holds
five mails at most. After them come **the rest**: receipts, newsletters and notifications, cleared
with one key (E). **Look** beside the rest on Mail home opens them even while mails wait. Hover a
sender to see its address. **Keep** leaves one in Gmail for your next look. The end says how long
it took and the next date you still have. When more mails wait, it offers **Stop here**, which
leaves them for your next look, or **Keep going**.

### When something goes wrong

- A reply that fails says "Didn't send. Your reply is kept.", with **Try again**.
- A mail Gmail won't archive says "Couldn't put this away in Gmail.", with **Try again**, and
  isn't counted as done.
- A mail deleted in Gmail meanwhile says "This mail is no longer in Gmail.", with **Next**.
- Offline, every button that changes Gmail is off until you are back.

## The reader

On the Mac, your own Claude Code or Codex reads new mail and writes each mail's lines. A date is
one the mail states, or the day before the event it is about; it never guesses one. When a date
passes and the mail is still open, it reads the mail once more to say what that means now. It has
no tools and no access to your notes. Whether a sender is new is one search in Gmail, done once
per address. It runs when the app opens or comes to the front, when Today
opens, and at most every 30 minutes. If it cannot run, mail still shows, sorted by sender only, and
each mail is tagged **Not read for you**. In a browser there is no reader, so every mail is. The lines stay on this Mac and are deleted when the mail is dealt
with, and after 14 days.

## Privacy

Google tokens are encrypted on the LeadingLight service. Mail passes through the service when
asked for; it does not store mail. Only the reader on your Mac sees mail text. To revoke access at
Google too, use [Google Account connections](https://myaccount.google.com/connections).
