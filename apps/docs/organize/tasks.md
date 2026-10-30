---
title: Tasks and new objects
description: Keep to-dos as task pages you tick off where you wrote them, and make a task, person or any other page without leaving the one you are writing.
---

# Tasks and new objects

A task is a to-do that is a page of its own. It can have a due date and a project, it is listed with all your other tasks, and you tick it off right in the page where you wrote it. This page also covers two quick ways to make new pages while you write: the slash menu's **New** section, and turning selected words into a page.

## What a task is

Task is a starter type, listed as **Tasks** under Types in the sidebar, after Projects. Each task has these properties, in this order:

| Property | Holds |
| --- | --- |
| **Done** | A checkbox: ticked when the task is done. |
| **Due** | The day it is due. |
| **Project** | One project page. The project lists its tasks. |
| **Tags** | Its tags. |

Task cards show Due and Project. Tasks live in **Tasks**, not in Recent.

A to-do item in the editor is a quick checklist line on one page. A task is a page you can find, list and link from anywhere. Use whichever fits.

## Make a task

- In the sidebar, click **Tasks**, then **New task**, and give it a title.
- In any page, type "/task" and press <kbd>Return</kbd>, then type its name. See [New pages from the slash menu](#new-pages-from-the-slash-menu).
- Type <kbd>@</kbd> and the task's name, then pick **Task** under **Create**. See [Links and backlinks](/organize/links).
- Select words and turn them into a task. See [Turn selected words into a page](#turn-selected-words-into-a-page).

## Tick a task off where you wrote it

A link to a task on its own line, shown as a **Line**, is a task line: a checkbox, then the task's title. It looks and lines up like a to-do item.

- Click the checkbox to tick the task. The title is muted and struck through, as a checked to-do is, and the task's **Done** is ticked too. Click again to untick it.
- Click the title to open the task, as with any link. <kbd>⇧</kbd>-click opens it beside. Clicking the checkbox never opens the task.

Ticking **Done** on the task's own page ticks every line that links it, at once.

Only task lines have a checkbox. A task linked inside a sentence shows its icon and title, and a task shown as a card shows its icon, without a checkbox.

### Any type can be ticked off

The checkbox comes from the **Done** property, not from the Task type. Add **Done** to any type in its **Type settings**, such as Project, and links to its pages on their own line get a checkbox too. If you rename Task, or make your own type with Done, it works the same way.

## See a project's tasks

When a task's **Project** is set, the project's page ends with **Linked tasks** and a small card for each of its tasks, such as **Linked tasks · 1**. See [Links and backlinks](/organize/links).

Tasks are records rather than writing, so **Settings › Writing** suggests turning the writing tools off for them. See [Writing tools](/write/writing-tools).

## Give a task to an agent

A task can be assigned to an agent, which works on it and reports back on the task's page. See [Assigning tasks to agents](/ai/tasks-for-agents).

## New pages from the slash menu

While you write, you can make a task, a person, a project or any other kind of page without leaving the page you are on. It is linked where the cursor was, and you carry on writing.

1. Type <kbd>/</kbd>. The slash menu ends with a **New** section, with one item per type: Page, Tag, Person, Book, Meeting, Project, Task, Idea, Collection, and any type you made. Typing filters it: "/proj" offers **Project**, "/rec" offers your Recipe type.
2. Pick a type and press <kbd>Return</kbd>. The line now reads "@" (or "#" for a tag) and a menu says, for example, *Type a name for the new task*.
3. Type the name and press <kbd>Return</kbd>.

The page is made and linked. You stay on the page you were writing, and nothing else opens.

| Where the cursor was | What you get |
| --- | --- |
| On an empty line | A block link. For a task, a task line, with the cursor on a new empty line below. |
| In a sentence | An inline link, such as "Ask @Sam Lee", and you keep typing. |
| A tag, anywhere | Always an inline tag link, such as "#reading", never a block. |

Daily notes aren't in the **New** section. Type "@today" to link a day.

### Link one you already have

As you type the name, the menu first offers **New task "…"** with what you typed, then the existing pages of that type that match. Only that type is offered: "/project" with "hous" offers the project House, not a page called "Housing notes". Press <kbd>↓</kbd> to pick an existing page, then <kbd>Return</kbd>. It is linked and nothing new is made.

### If you change your mind

- Press <kbd>Esc</kbd> to close the menu. What you typed stays as plain text, such as "@Later", and nothing is made.
- Pressing <kbd>Return</kbd> with no name does nothing; the menu stays open.
- Pressing <kbd>Return</kbd> twice quickly still makes only one page.
- Undo (<kbd>⌘Z</kbd>) right after removes the link. The new page stays, as when you make one from the <kbd>@</kbd> menu.

The **New** section works in the idea capture box too: "/task" there puts a task line in the idea. See [Idea capture](/capture/idea-capture).

## Turn selected words into a page

When something you wrote deserves a page of its own, such as an idea or a task, turn it into one. The words move into the new page, and a link to it takes their place.

1. Select the words, even several paragraphs with formatting and lists.
2. Click **Turn into** in the selection toolbar. The **Turn into** dialog opens.
3. Pick a **Type**. It starts on Idea. You can pick Task, any starter type, or a type you made.
4. Enter a **Title**, or leave it blank to use the first three words.
5. If the type has a project, such as Idea or Task, pick a **Project**.
6. Check the **Body**: it shows the words that will be kept.
7. Click **Create idea** (or **Create task**, and so on).

The new page holds the selected words as its body, with their formatting and lists. In the original page, only the selected words become a link to it; the words around them don't change.

Daily notes and the types the app makes for agents aren't offered.

### Undo and safety

- **Cancel** or <kbd>Esc</kbd> closes the dialog and changes nothing. No page is made.
- If saving fails, the dialog says *Could not create the page* and that your selected text is unchanged. Your title and project stay filled in, so you can try again.
- Pressing **Create** twice while it saves makes only one page.
- Undo in the original page brings your words back; the new page is kept. Redo links the same page again, without making another.
- If the original page changes while the dialog is open, the dialog asks you to close it and select the words again, and changes nothing. If it changes while the new page is saving, the new page is kept and the original is left as it is.

You can't turn words into a page from a page you can only read, such as an agent's report.

## Related

- [Links and backlinks](/organize/links)
- [Types and templates](/organize/types)
- [Assigning tasks to agents](/ai/tasks-for-agents)
- [Block kinds](/write/blocks)
