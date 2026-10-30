---
title: Saving web pages
description: Keep a webpage as a page of its own, as a link, as readable text, or as text with its pictures, to read offline.
---

# Saving web pages

You can keep a webpage as a source: a page in LeadingLight with the webpage's address and the date you
saved it. Keep just the link, or a readable copy of the article that stays with you offline.

## Save a webpage

1. Open [Quick capture](/capture/quick-capture) with <kbd>⌃⌥I</kbd> or the plus at the bottom of the bar.
2. Paste the address, such as `https://example.com/article`. The box's header changes to **Webpage**.
3. Pick what to keep: **Link only**, **Text only** or **Text and media**.
4. Press <kbd>⌘↩</kbd> to save and close the box, or <kbd>⇧⌘↩</kbd> to save and open the page beside
   the one in view.

The saved page has the webpage's title and its source address as a link you can click. It stays after
a reload, and [Captures](/capture/inbox) lists it as **Saved webpage**.

If you type words after the address, the box saves an idea instead, with the address as a link at the
top of its body.

## What each choice keeps

| Choice | What you get |
| --- | --- |
| **Link only** | A page with the source address. LeadingLight doesn't visit the website at all. |
| **Text only** | The article's readable text. No pictures or other media are downloaded. |
| **Text and media** | The readable text and its pictures, copied into your space. This is the choice picked at first. |

### Text and media

With **Text and media**, the article becomes ordinary blocks you can edit: headings, paragraphs, links,
lists and images.

- The words stay in reading order, and nested lists stay nested.
- Each image is saved once, where it was in the article, with its description.
- The text and images are still there after a reload, without the website.
- Nothing from the website runs: its scripts, forms and embedded frames are left out. Embedded media,
  such as a video player, is kept as an ordinary link.

LeadingLight fetches the page without your browser's sign-ins or cookies, so it sees what anyone
would see without signing in.

## When something can't be saved

### The website can't be copied

If the website returns an error, needs you to sign in, or refuses the request, the box stays open and
says why, for example "The website returned 404. Save the link instead." Click
**Save link instead** to keep just the link. No empty page is made.

Other reasons the box may give: the address isn't a webpage, the download is too large, or no readable
content was found.

In a browser, some websites can't be fetched at all. The box suggests trying in the Mac app, or saving
the link instead.

### Some media can't be copied

If the text is saved but some pictures or other media fail to download, the text is kept and each
missing item becomes a link labelled **Media not saved**. An image with an address that can't be used
becomes a **Media not saved** line of text. The box stays open with **Saved** and how many media files
could not be downloaded, until you press <kbd>Esc</kbd> or <kbd>⌘↩</kbd>.

## Cancel a slow save

While the box shows **Saving webpage…**, press <kbd>Esc</kbd>. The box closes at once and no page is
made. Downloads in progress stop and no more start, and you can save another webpage straight away.

## Unsafe addresses

LeadingLight saves only ordinary `http` and `https` addresses. It refuses, with an explanation, an
address that starts with `javascript:`, `data:` or `file:`, or one with a username or password in it.
No page is made.

If such an address is part of some words, it is saved in an idea as plain text, never as a link.

::: info Limits
- Content behind a sign-in, content that only a page's scripts create, and streamed media can't be
  copied. Missing media stays as a labelled link.
- Tables on a webpage are kept as paragraphs of their text, not as a grid.
- Images embedded right inside the page's code, with no web address, become a counted placeholder.
:::

## Related

- [Quick capture](/capture/quick-capture)
- [The capture inbox](/capture/inbox)
- [Pages](/organize/pages)
- [Privacy](/guide/privacy)
