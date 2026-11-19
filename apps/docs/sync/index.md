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

## Account and devices

Press **Account and sync**, the cloud at the bottom of the sidebar. It opens **Settings › Account and devices**, the one
place for your account:

| Part | What it is for |
| --- | --- |
| **Account** | Who you are signed in as, and **Sign out** |
| **Sync** | Whether this device syncs, its status, and **Sync now** |
| **Devices** | The apps signed in to your account, and **Add a device** |
| **Recovery key** | **Show…** the key, and tick it as saved |
| **Agents from a browser** | Pair a web browser with the agents on your Mac. See [Agents from a browser](/sync/pairing) |
| **Agents from iPhone and iPad** | Let your iPhone or iPad start and answer the agents on your Mac. See [Agents from iPhone and iPad](/sync/mobile-agents) |

The sidebar row also says where sync stands: **Synced**, **Syncing**, **Offline**, **Sync off**,
**Paused**, **Sign in** when a sign-in has ended, or **Check** when something needs a look. It
says nothing if you never signed in.

## Which account am I using?

Under your name the page shows your email and how you signed in, such as
`alex@example.com · Google`. Every device on the account shows the same line.

A Google account and a GitHub account are two separate LeadingLight accounts with separate notes,
even if they have the same email address. Use the same one on every device.

An account that last signed in at leadinglight.app before this was added shows its name alone.
Sign out and in again in a browser once, and every device shows the line.

## Sign in

### In a browser

Press **Continue with Google** or **Continue with GitHub**. The one you used in this browser
before says **Last used here**.

- Google sign-in is still in testing, so only people added as testers can use it for now.
- If sign-in isn't set up where you opened the app, the page says "Cloud accounts are not
  configured in this installation yet." Offline, it says sign-in will be there when you are back
  online.

### In the Mac, iPad or iPhone app

Press **Connect this Mac** (or iPad, or iPhone). The app shows a code of 8 characters and waits.
There are two ways in.

**From a device that already syncs.** No recovery key is needed and no browser opens.

1. On a Mac, iPad, iPhone or browser where LeadingLight already syncs, open **Account and
   devices** and press **Add a device**.
2. Type the code and press **Continue**.
3. It asks "Let LeadingLight on Mac open your notes?" with your account and the code. Check the
   code is the one on the new device, then press **Approve**.
4. It says "LeadingLight on Mac is connected. It will finish syncing by itself." The new device
   appears in **Devices**, marked **New**.

A code nobody is waiting with gets "No device is waiting with that code. Check the code on your new
device." After ten wrong codes in ten minutes it says "Too many codes tried. Wait ten minutes, then
try again."

**Add a device** is off on a device where sync is off or paused, because that device has no key
to hand over.

**From your browser.** Use this for your first device. Press **Continue in the browser** under the
code. On the Mac, this opens Safari.

1. In the browser, sign in if you need to. A **Connect your device** window names the device and
   shows the code. Check that it matches the code in the app.
2. If this browser already syncs, its recovery key is used. If not, paste your recovery key in
   **Recovery key, if you already use sync**. Leave it blank only if you have never set up sync.
   Signing in is not enough on its own: the service never holds your key, so a browser that has
   not synced at this address cannot hand it over.
3. Press **Connect this device**. The browser says **Device approved**.

Either way the recovery key reaches the new device encrypted, so the service never sees it. The
device keeps its sign-in in the system Keychain. A code is good for ten minutes and can be
approved once; after that, press Connect again. An approval link that has expired says so and asks
for nothing; start again on the new device.

Signing in to your workspace is separate from Claude Code and Codex. Agents keep using the CLI
account already signed in on your Mac. See [Overview and setup](/ai/).

## Your devices

**Devices** lists the installed apps signed in to your account: this device first, then the
others with when each was last online. A device that joined in the last day is marked **New**.
Browsers are not listed.

- **Rename.** Press **Rename** on this device's own row. Your other devices list it by the new
  name. A name can't be empty or longer than 40 characters.
- **Remove.** At **leadinglight.app**, press **Remove** on a device and confirm. It is signed out
  at once and gets nothing new. Notes already on it stay on it. The installed apps do not remove
  other devices; they say "To remove a device, sign in at leadinglight.app."
- **Sign out all devices.** Also at leadinglight.app, under the list. Every installed app stops
  syncing until you connect it again, and a device that was approved but had not finished
  connecting cannot finish. The browser stays signed in. Unless that browser syncs, connecting the
  first device again needs your recovery key, so save it first.

## When a sign-in ends

A device stays signed in while you use it. If it is not opened for 30 days, or it is removed, its
sign-in ends. The sidebar row then says **Sign in**, and the page says "This Mac is signed out of
sync", names the account it was using, and offers **Sign in again**. Your notes and recovery key
stay on the device.

Being offline is not the same thing. The row says **Offline**, the page still shows your account,
and sync carries on when the network is back.

## Turn on sync

- **First device.** Press **Turn on sync**. LeadingLight makes your recovery key and shows it
  once, with **Copy**. Tick **I saved it somewhere safe** to finish.
- **A browser on an account that already syncs.** **Turn on sync** asks for the recovery key.
  On a device that syncs, open **Account and devices**, press **Show…** on **Recovery key**, and
  paste the key. (The apps get the key when you add them, as above.)

Sync then runs in the background. The page shows its status: **Connecting…**, **Syncing…**, **Up
to date**, **Some pages need attention** or **Needs attention**. Press **Sync now** to sync at
once.

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

The recovery key is the only way back in if you lose every device. Adding a device from one that
syncs does not need it. Press **Show…** on **Recovery key** to see the whole key, with **Copy**.
Until you tick **I saved it somewhere safe**, the row reads **Save your recovery key**.

A device that has synced keeps its key after it is signed out, and the row still shows it. Anyone
who can open the app on that device can read the key, as they can read the notes.

::: danger Keep it safe
LeadingLight can't recover your notes for you. If you lose the recovery key **and** every device
that has your notes, the synced copies can never be opened again. Save the key in a password
manager or another private place. Save it before you clear a browser's storage or replace all your
devices.
:::

If a device has the wrong key, the page says "The recovery key does not match this account's
synced notes." Paste the right one under **Recovery key** and press **Use this recovery key**. A
wrong key, or a failure while it is checked, never replaces the key that already works.

## Pause sync

Turn off **Sync this Mac** (or iPad, iPhone, browser). The device keeps its notes and its recovery
key, and the encrypted copies stay in your account. Turn it on to carry on with the same key.

## Sign out

Press **Sign out** and confirm. Your notes and the recovery key stay on the device.

- In the Mac, iPad or iPhone app, signing out also ends that device's connection, and its saved
  sign-in is removed from the Keychain.
- If signing out fails, your account stays shown so you can try again. Only a sign-out that
  succeeds brings back the sign-in buttons.
- A sign-out you chose leaves no warning behind. The page just says which account these notes
  sync with.

A device's notes belong to the account they first synced with. If you sign in to a different
account, the page says "These notes sync with alex@example.com · Google" and which account you
are signed in as, and sync stays off for those notes, so one account's notes are never sent to
another.

## Use the web app on a phone or tablet

The web app works in a phone's or tablet's browser, by touch: you can write and edit pages, open
history, see who wrote what, and open **Account and devices**. No app needs installing.

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
- Sync keeps every version of history. Each account has 500 MB for encrypted sync data. If storage fills, pending edits stay on their original device and retry on the next sync.
- Sync isn't live co-editing: two devices changing one page at the same time keep two copies, not
  one merged page.
:::

## Related

- [Agents from a browser](/sync/pairing)
- [LeadingLight on iPad](/sync/ipad)
- [Privacy](/guide/privacy)
- [History](/organize/history)
