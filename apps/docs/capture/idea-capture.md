---
title: Idea capture
description: Press ⌃⌥I from any app to get an idea out of your head and into LeadingLight, with nothing to file.
---

# Idea capture

Ideas come at random times and are lost unless they get out at once. Press <kbd>⌃⌥I</kbd> and a small
box opens with the cursor already in it. What you type is saved as you go, as its own Idea page, and it
shows in Today because you made it today. There is nothing to confirm and nothing to file.

The same box also saves web addresses and voice notes. See [Quick capture](/capture/quick-capture).

## Open the box

- Press <kbd>⌃⌥I</kbd>.
- Or click **Quick capture**, the plus at the bottom of [the bar](/workspace/bar).

Press <kbd>⌃⌥I</kbd> again to close the box.

### From any app <Badge type="info" text="Mac app" />

In the Mac app the box is a floating panel of its own. Press <kbd>⌃⌥I</kbd> while any app is in front,
and the box shows over that app, near the top of the screen, with the cursor in the title line.

That app stays in front: its menu bar stays, and LeadingLight's window doesn't come forward. When you
close the box, the keyboard goes back to that app, and the idea is saved in LeadingLight.

Clicking anywhere outside the box closes it too, and what you typed is saved.

The shortcut keeps working after you close LeadingLight's window with the red button: the app keeps
running, its Dock icon stays, and clicking the Dock icon brings the window back. Only <kbd>⌘Q</kbd>
quits. To have the shortcut work after you restart your Mac, turn on **Open at login** in
**Settings › Capture**.

### In a browser <Badge type="info" text="Browser" />

In a browser there is no shortcut for the whole computer. The box opens inside the LeadingLight
window, from the Quick capture button or from <kbd>⌃⌥I</kbd> while the window has focus.

## What the box shows

- **The header** reads **New idea · In Today · # in-the-middle**, with the project picker at its right
  end, reading **No project**.
- **The title line** is where the cursor starts, with the placeholder "Type your idea".
- **The body** is below it, with the placeholder "It saves as you go and shows up in Today."
- **The footer** has the mic on the left. On the right, **esc Close** always shows, and once you have
  typed something, **⇧⌘↩ Open beside** and **⌘↩ Save** show too.

<img class="shot" src="/screenshots/capture-box.webp" alt="The capture box over a page: New idea, In Today, in-the-middle and a project picker" />

The box wears your theme, light or dark, in the Mac app and in a browser.

## Write an idea

1. Open the box and type the idea in the title line.
2. Within a second the footer shows **Saved** with a check. It stays while you keep typing, and goes
   only if a save fails.
3. Press <kbd>↩</kbd> or <kbd>⇥</kbd> to move to the body, and write as much as you like. <kbd>↩</kbd>
   in the body starts a new paragraph; it doesn't close the box.
4. Press <kbd>⌘↩</kbd> or <kbd>Esc</kbd> when you are done.

The idea is now an Idea page, listed in the sidebar under Pages. Its properties are **Project**,
**Tags** (with "in-the-middle"), **Created** and **Updated**.

If you skip the title and type only in the body, the body's first line becomes the page's title.

A very long title stays on one line and scrolls inside the box. The page keeps the whole title.

::: tip
Clicking the empty space under the body puts the cursor at the end of the body.
:::

## Ideas show in Today

An idea isn't written into the day's note. It shows in Today's **Created this day** list, with its icon,
because it was made that day, like any page. Today's own words stay yours.

If Today is open while you capture, its **Created this day** list shows the new idea at once. Ideas you
make by hand, not from the box, show in their day the same way.

If you used an earlier version of LeadingLight, ideas it added to Today as bullets under an "Ideas"
heading are left as they were, and those ideas aren't listed a second time.

## The body is the full editor

The body is the same block editor as any page:

- Type <kbd>/</kbd> for the block menu. <kbd>Esc</kbd> closes the menu and leaves the box open.
- Lists, to-dos, headings and the other blocks work as they do on a page. <kbd>⇥</kbd> in a list
  indents the item.
- Select words to get the formatting toolbar; <kbd>⌘B</kbd> and the other formatting keys work.

There is no block handle beside the lines, since the box has no room for one.
See [The editor](/write/editor) and [Blocks](/write/blocks).

## Link to other pages

Type <kbd>@</kbd> and a few letters of a page's name, then press <kbd>↩</kbd> to link it, as on any
page. The page you have open in the window is offered too.

To link a page that doesn't exist yet, type <kbd>@</kbd> and its name, then pick **Page** under
**Create “…”**. The new page is made and listed in the sidebar. See [Links and backlinks](/organize/links).

## The in-the-middle tag

Every captured idea is tagged **in-the-middle**. The tag page is made the first time you capture
something, and it is listed under Tags. Open it to see every idea that came in on the fly.
See [Tags and daily notes](/organize/tags-daily).

## Put the idea in a project

1. In the box, click **No project** at the right of the header.
2. The picker opens with the search field **Find or create a project** focused. It lists your Project
   pages, most recently changed first.
3. Type part of a name and press <kbd>↩</kbd>, or click a project.

The picker closes, shows the project's icon and title, and the cursor goes back to the title line.
The idea's **Project** is that project. On the project's page, the idea shows under **Linked ideas**
at the end of the page, before Backlinks, as a small card with its title and tag.

- To take the idea out of the project, pick **No project** in the picker.
- To make a new project, type its name and pick **Create project “…”**. The new Project page is made,
  listed under Projects, and chosen for the idea.
- Choosing a project and closing the box without typing makes no page. Each box starts with
  **No project**.

### Use the picker from the keyboard

From the title line, press <kbd>⇧⇥</kbd> to move to the project picker. Press <kbd>↩</kbd> or
<kbd>Space</kbd> to open it. <kbd>Esc</kbd> closes only the picker; a second <kbd>Esc</kbd> closes the
box. The keyboard never leaves the box.

### The project guess

After you type a few words, tail may guess the project. The picker then reads the project's name with a
question mark, such as **Garden?**, and the footer offers <kbd>⌃↩</kbd> to save the idea there.
See [Quick capture](/capture/quick-capture#the-project-guess).

## Save and close

| Key | What it does |
| --- | --- |
| <kbd>⌘↩</kbd> | Saves the idea and closes the box. The page you were on stays in view and gets the keyboard back. |
| <kbd>⇧⌘↩</kbd> | Saves the idea and opens it beside the page in view, with the cursor at the end of its body. |
| <kbd>Esc</kbd> | Closes the box. What you typed is already saved. |

<kbd>⌘↩</kbd> saves even if you press it right after your first key: the box waits for the save before
it closes.

<kbd>⇧⌘↩</kbd> never replaces a page you have open. The idea opens to the right of the page in focus,
and if no page is open, it opens as the only page. If **Settings** is open, Settings closes and the idea
opens beside the page that was in view.

In the Mac app, over another app:

- <kbd>⌘↩</kbd> and <kbd>Esc</kbd> close the box and give the keyboard back to that app. LeadingLight
  stays behind it.
- <kbd>⇧⌘↩</kbd> brings LeadingLight to the front, with the idea beside the page that was open.

After <kbd>Esc</kbd> or <kbd>⌘↩</kbd> in the window, the keyboard goes back to where you were, such as
the body of the page you were writing in.

## When nothing is saved

- Opening the box and closing it without typing makes no page. Pressing <kbd>↩</kbd> in the empty title
  line just moves to the body.
- <kbd>⌘↩</kbd> with nothing typed closes the box and makes no page.
- <kbd>⇧⌘↩</kbd> with nothing typed does nothing; the box stays open.

The box never deletes a page. If you type something, wait for it to save and then erase it, a page
called "Untitled" stays, listed in Today. Delete it like any page.

## Change the key

Open **Settings › Capture**:

- **New idea shortcut** shows the key, <kbd>⌃⌥I</kbd>. Click it and press the key you want, such as
  <kbd>⌃⌥K</kbd>. A reset button, **Use ⌃⌥I again**, brings back the original.
- **Open at login** starts LeadingLight when you log in, so the shortcut works after a restart. It is
  for the Mac app only; in a browser the switch is turned off and can't be changed.

The new key works everywhere the old one did, over other apps too, and the old key no longer opens the
box. **Settings › Shortcuts** shows it as **New idea**. See [Keyboard shortcuts](/customize/shortcuts).

::: info Limits
- The box has a fixed size. A long idea scrolls inside it.
- In the Mac app, <kbd>⌘Q</kbd> while you type in the box over another app quits LeadingLight, not
  the other app.
- The box doesn't use the Idea type's template, and shows no property except Project. Fill in the
  rest on the page later.
:::

## Related

- [Quick capture](/capture/quick-capture)
- [The capture inbox](/capture/inbox)
- [Tags and daily notes](/organize/tags-daily)
- [Keyboard shortcuts](/customize/shortcuts)
