---
title: Projects linked to folders
description: Link a page to a folder on your Mac or a GitHub repository, so its agents can work on the files and read the project's pages.
---

# Projects linked to folders <Badge type="info" text="Mac app" /> <Badge type="warning" text="Preview" />

Link any page to a folder on your Mac, and the page holds the project's thinking while the folder holds its files. The page then gets a [project chat](/ai/project-chat): an agent that works in the folder and reads the project's pages.

Linking never copies, moves or writes anything in the folder.

## Turn on projects

Linked folders and project chats are still in development, so they're off at first.

1. Open **Settings › AI**.
2. Under **Projects**, turn on **Linked folders and project chats**.

## Link a folder to a page

1. Hover above the page's title and click **Link folder**, beside **Add icon**, **Add cover** and **Add description**.
2. In **Link a folder**, choose **On this Mac**.
3. Type the folder's path, such as `~/Documents/Garden`, or click **Choose…** to pick it.
4. Click **Link folder**.

The page now shows a folder row under its title, with the folder's name and path, a **Chat** button and a **···** menu. Your files are exactly as they were.

If there's no folder at that path, the dialog stays open and says **No folder at** and the path.

A folder can be linked to only one page. LeadingLight knows a folder by what it is, not by its path, so another path to the same folder (an alias, or different capital letters) is still the same folder. If it's already linked, the dialog says **That folder is already linked to** and that page's name, with a button to open it.

The link belongs to the page, so renaming the page keeps it.

## Clone a repository from GitHub

1. Click **Link folder** and choose **From GitHub**.
2. In **Repository**, type `owner/name` or the repository's address.
3. **Clone into** shows where the copy goes, `~/Developer` at first. Change it if you like.
4. Click **Clone**.

Git's progress shows under the field while it copies. When it's done, the page is linked to the new folder, and its chat works there.

- **Private repositories** work through your Mac's own Git sign-in (its credential helper or SSH key). If Git in Terminal can reach the repository, LeadingLight can clone it, and it never asks you for a password.
- **Cancel** stops a clone and leaves no half-made folder behind.
- If the folder is **already there**, the dialog says so and offers **Link it**. Your changed files stay as they were.
- If the repository can't be found, the dialog says so, and nothing is made or linked.

## When a folder moves

If you rename or move a linked folder, the folder row says **Folder not found** with the old path, and offers **Relink…**.

1. Click **Relink…**.
2. Enter or choose the folder's new place.

If it's the same folder, LeadingLight says **Same folder, moved**, the row shows the new name and path, and everything kept for the page is still there. The project's chats carry on in the new place and remember what was said. A chat whose agent was still working when you relinked stops; send it a message to pick it up again in the new place.

If you relink to a different folder, LeadingLight asks first: "This is a different folder from the one linked before", with **Link anyway**.

## Unlink a folder

Choose **Unlink** from the folder row's **···** menu. The folder row goes, and the page and the folder both stay as they were. **Relink…** is in the same menu.

## What a project's agents can read

A project's agents (in its chats and in [tasks you give them](/ai/tasks-for-agents)) can read the project's pages in LeadingLight, so they can answer from your notes without you pasting them in. Ask a chat "What does Plan say about shipping?" and its steps show it reading the project page and Plan, and the answer names Plan.

An agent reads, a few steps out from the project page:

- the project page itself,
- the pages it links to,
- pages that link to it through a property, such as its tasks and meetings,
- pages that mention it,
- and their reports and essays.

When it reads a page, the agent gets its title, type, properties, text, links in and out, and attachments. A long page comes a part at a time. To open an attachment, such as a PDF on a page, the agent gets a copy kept with its chat, outside your folder.

Agents can read these pages, but they can't edit or delete them.

### What they can't read

- **Pages outside the project.** An agent asking for one is told it isn't part of the project, and gets none of its text. A search finds nothing from outside.
- **Your whole space through a tag.** Reading a tag page doesn't open every page with that tag, and neither does a daily note.
- **Your sidenotes.** They stay private, unless you send them to the agent as feedback (see [Feed and feedback](/ai/feed-feedback)). Reading a Thoughts page tells the agent how many notes are private, and shows none.

An agent can't name another project or person to read theirs: the project runtime tells LeadingLight which agent is asking.

### With LeadingLight closed

Agents keep working with the app quit, but your pages live in the app. If an agent tries to read a page while LeadingLight is closed, it is told within a few seconds that LeadingLight isn't open, and can still read the folder's files. A report an agent writes meanwhile appears when you next open the app.

## The project runtime

Project chats run their agents in the project runtime, a helper that comes inside the Mac app. You don't install anything else for it, beyond Claude Code or Codex. It keeps its own state, and doesn't change your Claude Code or Codex settings.

**Settings › AI › Projects › Runtime** shows how it is:

- **Starts when a project chat first needs it.** It isn't running yet. Click **Start** to start it now.
- **Running**, with its version, and "Agents in project chats keep working while the app is closed." The row also says where its state is kept. Click **Restart** to restart it; an agent in the middle of a turn carries on and finishes.
- **Not running**, with the reason.

### Agents keep working with the app closed

Quit LeadingLight while an agent is in the middle of a turn, and the turn carries on. Open the app again and the turn's end is there. If no agent is working when you quit, the runtime stops too, and your chats are still there the next time you open the app.

When you update LeadingLight, the new version takes over from the old runtime, and agents that were running carry on.

::: info Limits
- Projects work only in the Mac app, not in a web browser or on iPad.
- When Codex works in a Git checkout, Codex itself records the folder as trusted in its own settings file, `~/.codex/config.toml`.
:::

## Related

- [Project chat](/ai/project-chat)
- [Assign tasks to agents](/ai/tasks-for-agents)
- [The browser](/ai/browser)
- [AI and agents: overview and setup](/ai/)
