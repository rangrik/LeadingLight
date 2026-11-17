---
title: Publish a page
description: Share a read-only copy of a page and its sidenotes using an unlisted link.
---

# Publish a page

Choose **Publish page** in the page header, or **Page options → Publish page…**. Sign in through
**Account and devices** if needed, then press **Publish**. Copy the **Share link** and send it
to anyone. Readers do not need LeadingLight or an account.

The copy includes the title, description, text, formatting, attachments and anchored sidenotes.
Sidenotes sit beside the text on a wide screen and follow it on a phone. Readers cannot change
text, tick tasks, change sidenotes or run agents. Linked page titles are included as plain text;
linked pages, unanchored thoughts, history, workspace properties and agent conversations stay private.
Notebook handwriting uses its saved preview, followed by its text, photos and audio in reading order.
Publish related pages and reports separately when you want to share them too.
YouTube and Vimeo videos stay embedded; other embedded websites become links. External images,
audio and videos load from their original hosts, which can see the reader's network address.

## Updating or removing a link

Edits stay local until you choose **Update published page**. The link stays the same.
**Unpublish** removes the online copy. Publishing again gives you a new link; the old one
stays unavailable. Removing a local page does not unpublish it. Use **Account and devices → Manage published pages**
to copy or revoke any of your links, including pages deleted from this device.
You can still unpublish existing copies if cloud publishing access is disabled for your account.

A rejected upload leaves the previous copy available. If the connection drops after saving, the
dialog checks the current status so you can still manage the link. The page and attachments together must fit
within 3.5 MB. Reduce large attachments if needed. Each account can keep up to 100 published pages
and 100 MB. Missing attachments must finish syncing before you publish.

If the installed app says “This native session cannot use this route,” the cloud service needs
updating. Signing out or reinstalling will not fix that message. After the service is updated,
press **Try again** in the same dialog.

## Privacy and search

Published pages send a `noindex` instruction in both their HTML and HTTP headers. Search engines
that follow it, including Google, exclude them from results. There is no public directory or
sitemap of published pages. Crawlers must be allowed to read the instruction, so robots.txt does
not block them. See [Google's noindex documentation](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

Anyone with the link can read, copy or forward it. Publishing sends a readable copy to our cloud
service; it is separate from encrypted sync. Noindex is not a password or a guarantee against
crawlers that ignore it. Unpublishing stops future reads; it cannot remove copies a reader saved.
Shared pages need an internet connection and are not saved for offline reading.
