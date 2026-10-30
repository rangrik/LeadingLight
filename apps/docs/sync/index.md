---
title: Accounts and encrypted sync
description: Use LeadingLight without an account, or sign in to keep your notes on more than one device with end-to-end encrypted sync.
---

# Accounts and encrypted sync <Badge type="warning" text="Preview" />

LeadingLight works without an account. Your notes live on your device, and everything you write is
saved there first. Sign in only when you want the same notes on another device: your Mac, an iPad,
or the web app in a browser.

Sync is end-to-end encrypted. Your devices encrypt notes before they leave, and a recovery key that
only your devices hold unlocks them. The service stores the encrypted copies, and passes on encrypted
messages between a browser and a Mac you have paired. It can't read either, and it never runs AI
models.

::: warning Private preview
Accounts and sync are in a private preview. You can sign in, but sync stays off until the people
running the service enable your account. Until then, your notes keep working on this
device, and sync says "Cloud access has not been enabled for this account yet."
:::

## Account and sync

Press **Account and sync** in the sidebar. The window, "Your workspace, everywhere", has three tabs:

| Tab | What it is for |
| --- | --- |
| **Account** | Sign in, see who you are signed in as, and sign out |
| **Sync** | Turn on encrypted sync, see its status, and keep your recovery key |
| **Agents** | Connect a browser and a Mac so agents can run from the browser. Not shown on iPad. See [Agents from a browser](/sync/pairing) |

To keep going without an account, press **Continue on this device**.

## Sign in

### In a browser

On the **Account** tab, press **Continue with Google** or **Continue with GitHub**, and sign in.

- Use the same provider on every device. A Google account and a GitHub account are two separate
  LeadingLight accounts, even if they have the same email address.
- Google sign-in is still in testing, so only people added as testers can use it for now.
- If sign-in isn't set up where you opened the app, the tab says "Cloud accounts are not configured
  in this installation yet." Offline, it says sign-in will be there when you are back online.

### In the Mac or iPad app

The installed app signs in through your browser, using the account you already have there:

1. On the **Account** tab, press **Connect your workspace**. Your browser opens.
2. The app shows a code: "Match code … in your browser, approve this device, then return here."
3. In the browser, sign in if you need to, with the same provider you use for your workspace. A
   **Connect your device** window names the device ("LeadingLight on Mac" or "LeadingLight on
   iPad") and shows a code. Check that it matches the code in the app.
4. If this browser already syncs, its recovery key is used. If not, paste your recovery key in
   **Recovery key, if you already use sync**, or leave it blank to set up sync for the first time.
5. Press **Connect this device**. The browser says **Device approved**.
6. Go back to the app. It says "Connected. Your notes are syncing with this account."

The browser hands the recovery key to the device encrypted, so the service never sees it. The
device keeps its sign-in in the system Keychain. A request is good for ten minutes and can be
approved once; after that, start again in the app.

Signing in to your workspace is separate from Claude Code and Codex. Agents keep using the CLI
account already signed in on your Mac. See [Overview and setup](/ai/).

## Turn on sync

On the **Sync** tab:

- **First device.** Press **Set up encrypted sync**. LeadingLight makes your recovery key and shows
  it. Save it somewhere private.
- **Another device.** Paste the recovery key from your other device in **Connecting another
  device?** and press **Connect this device**. (The Mac and iPad apps get the key when you approve
  them, as above.)

Sync then runs in the background. The tab shows its status: **Connecting…**, **Syncing…**, **Up to
date**, **Some pages need attention** or **Needs attention**. Press **Sync now** to sync at once.

### What syncs

- Pages, their properties and their history.
- Images, PDFs, recordings and other attachments, each once, inside the encrypted notes.
- Your types and properties when a new device first joins. A fresh device takes your settings; a
  device where you already changed a type keeps its own.

Linked project folders, agents and this device's app settings stay on the device.

If two devices change the same page while offline, both versions are kept, so nothing is lost. A
page that can't sync (a file that is too large or missing, say) is named, and the other pages
still sync.

## Your recovery key

The recovery key unlocks your encrypted notes on a new device. Press **Show recovery key** on the
**Sync** tab to see it, under "Recovery key — save this somewhere private".

::: danger Keep it safe
LeadingLight can't recover your notes for you. If you lose the recovery key **and** every device
that has your notes, the synced copies can never be opened again. Save the key in a password
manager or another private place. Save it before you clear a browser's storage or replace all your
devices.
:::

If a device has the wrong key, the tab says "The recovery key does not match this account's synced
notes." Paste the right one under **Recovery key from another device** and press **Use this recovery
key**. A wrong key, or a failure while it is checked, never replaces the key that already works.

## Pause sync

Press **Pause sync on this device**. The device keeps its notes and its recovery key, and the
encrypted copies stay in your account. Press **Resume sync** to carry on with the same key.

## Sign out

Press **Sign out** on the **Account** tab. Your local notes stay on the device.

- In the Mac or iPad app, signing out also ends that device's connection, and its saved sign-in is
  removed from the Keychain.
- If signing out fails, your account stays shown so you can try again. Only a sign-out that
  succeeds brings back the sign-in buttons.

A device's notes belong to the account they first synced with. If you sign in to a different
account, sync stays off for those notes, so one account's notes are never sent to another.

## Use the web app on a phone or tablet

The web app works in a phone's or tablet's browser, by touch: you can write and edit pages, open
history, see who wrote what, and open **Account and sync**. No app needs installing.

Once you have opened it, it works offline. Open it again with no connection and you can read and
edit your notes; sync waits until you are back online.

Agents don't run in the browser on their own. Ask explains that agents run in the Mac app with your
own Claude Code or Codex sign-in, and offers **Connect a Mac**. You are never asked for an API key
or charged for usage. See [Agents from a browser](/sync/pairing).

::: info Limits
- Attachments: up to 32 MB a file, 64 MB of new files in one change, and 256 files in one change. A
  larger change stays on the device with a clear error.
- After a device first joins, later changes to types and properties (renaming a type, say) don't
  sync. Page content and property values do.
- Sync keeps every version of history for now; there are no storage controls yet.
- Sync isn't live co-editing: two devices changing one page at the same time keep two copies, not
  one merged page.
:::

## Related

- [Agents from a browser](/sync/pairing)
- [LeadingLight on iPad](/sync/ipad)
- [Privacy](/guide/privacy)
- [History](/organize/history)
