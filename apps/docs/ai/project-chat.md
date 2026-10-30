---
title: Project chat
description: Chat with Claude Code or Codex working in a project's folder, answer its questions and approvals, and see the files each turn wrote.
---

# Project chat <Badge type="info" text="Mac app" /> <Badge type="warning" text="Preview" />

A page linked to a folder has a chat of its own. In it, Claude Code or Codex works in that folder with its own tools: it reads and changes files, runs commands, and reads the project's pages. The chat keeps going when you close it or quit the app, and comes back as it was.

To use it, turn on projects and link a folder first; see [Projects linked to folders](/ai/projects). The chat on a page is separate from [Ask](/ai/ask): Ask still answers about the page itself, not the folder.

## Open a project's chat

Click **Chat** in the page's folder row. A card titled with the page's name and **Chat** opens beside the page, and reads "What should we do in" and the folder's name.

Type in the field, which reads **Ask Claude to work in the folder…** (or **Ask Codex…** in a Codex chat), and press <kbd>↩</kbd>.

The **Browser** button in the card's header opens the browser the chat's agent uses, beside it. See [The browser](/ai/browser).

## Follow the work

Your message shows on the right at once. The agent's words appear as it writes them, under **Working for …**, and each step gets its own line, such as "Ran pwd" or "Read notes.txt", while the timer counts. If you're at the bottom of the chat, the newest words stay in view. The turn ends with **Worked for …**.

Answers keep their line breaks and show tables as rows and columns. When Claude asks one of its own helpers to look at something, the step reads **Asked a subagent**.

### Links in an answer

- A link to a file in the folder opens it in a dialog, as it is now. The chat stays where it was.
- A link to a website opens in your web browser.
- A link to a file outside the folder says so, and opens nothing.

## Files a turn wrote

Each turn lists the files it wrote under it. Click one to open it in a dialog, as that turn left it. LeadingLight keeps that copy, outside your folder, so later changes don't touch it. The dialog has three views:

| View | Shows |
|---|---|
| **Then** | The file as this turn left it |
| **Now** | The file as it is in the folder now, or that it isn't there any more |
| **Change** | What this turn changed: the lines it took out and put in, marked − and + |

If the file has changed since, the dialog says so. A file a later turn deleted shows as deleted, and opens as it last was. A write you declined lists no file.

## Stop

Click **Stop** while the agent works. The turn ends with **Stopped**, and you can send a new message.

## Access and Plan mode

The **access** button in the field's footer sets what the agent may do without asking. Each agent's menu says it in its own words:

| Access | Claude | Codex |
|---|---|---|
| **Ask for approval** | Asks before changing files or running commands | Asks before each command and change |
| **Approve for me** | Claude Code's auto mode: a classifier approves or blocks each action and asks you when unsure | Works freely in the folder and temporary folders, and asks before going elsewhere or online |
| **Full access** | Changes files and runs commands without asking | Runs anything without asking, outside the folder too |

You can change access in a chat that has started; the agent works that way from its next step. Turn on **Plan mode** from **+**, and the agent plans and changes nothing.

A chat's settings are its own. Starting a chat in **Full access** with Sonnet doesn't change Ask's access or model.

## Answer questions and approvals

When the agent needs you, a card shows where the field was.

### Approvals

When the agent asks to write a file or run a command, the card shows the file's path or the command, with three buttons:

- **Allow once** lets it go ahead this time.
- **Always allow in this chat** stops it asking again for this kind of step while the agent runs.
- **Decline** refuses. The agent goes on without it.

With Codex, the card shows the command Codex wants to run, such as `echo … > done.txt`, and an edit shows the file's name and the lines it changes.

### Questions

When the agent asks a question with choices, the card shows it in the agent's words, with numbered options. Press an option, or its number key.

- A question that takes several answers says **Choose one or more.**, and **Next** waits until you've chosen.
- You can type your own answer instead of choosing.
- With several questions, **Next** moves to the next one, and the number keys work there at once.

After you answer, the card says **Sent. Waiting for the agent to take it.**, and then shows the question answered.

An answer reaches the agent exactly once, even if you click and press <kbd>↩</kbd> together, double-click, or the app reloads while it's on its way; then the card comes back showing your answer and where it is.

- If the agent stops before you answer, the card goes, and anything you typed is back in the field with a line saying why.
- **Stop** on the card stops the turn. The card goes and the field comes back, with what you'd typed.
- Codex sometimes asks a question it isn't waiting on. Its card then shows above the field, which you can keep using.

In a Codex chat, questions with choices come when **Plan mode** is on.

## Pick the model and effort

The model button in the footer picks the model and effort, as in Ask. You can change them in a chat that has started; the next turn uses them. While a turn runs, the menu waits until it ends.

### Chats with Codex

To work with GPT, start a new chat and pick a GPT model. The chat runs Codex in the same folder, with the same steps and answers as Claude's. If Codex isn't installed or signed in, the model menu says so where the GPT models would be, and new chats use Claude.

A chat keeps the agent it started with: a Claude chat's model menu offers only Claude's models, and a Codex chat's only GPT's.

## Several chats in one project

The chat menu in the card's header lists the chats you started, under "In" and the page's name, newest first. Choose **New chat** to start another, or pick one to see its turns and carry on with it. Chats started by an agent, such as workers, aren't listed there.

Close the chat's card, or quit the app, and the chat is there when you open it again. A new message carries on with everything said before.

## Attach files

Choose **+ › Files…** and pick files. Each shows as a chip above the field, with a way to take it off. Send, and your message shows the file names. The files are kept with the chat, never written into your folder. A file over 20 MB is refused, with its size, and nothing is sent.

## The agent's skills and tools

Type `/` in a chat that has started to see the agent's own skills and commands that work in a chat, with their descriptions. Ones that need the agent's terminal aren't listed. Pick one and send, and the agent runs it.

The MCP servers you set up in Claude Code work in a Claude chat too. Ask it to use one of their tools; in **Ask for approval** it asks first. Your Claude Code and Codex settings stay as they were.

Unlike Ask, a project chat's **+** menu doesn't offer pages to mention: the agent reads the project's pages itself (see [What a project's agents can read](/ai/projects#what-a-project-s-agents-can-read)).

## Work on a branch of its own

In a folder that is a Git checkout, you can give a new chat its own branch:

1. Start a new chat.
2. Turn on **+ › Own branch**.
3. Send your message.

The chat's header shows its branch, such as `ll/chat-…`. Its changes go on that branch, in a working copy the project runtime keeps elsewhere. Your checkout's files and branch stay as they were, and nothing new appears beside it. The files each turn wrote stay openable even after that working copy is gone; **Now** then says the file isn't in the folder.

A plain folder, not a Git checkout, doesn't offer **Own branch**.

## When the agent hands work to others

In a project chat the agent can start its own workers, Claude or Codex, in the same folder: it hands each a task, follows up, waits, or stops one. A worker's result comes back to the agent that started it by itself. The agent chooses: for a small change it may just make it.

The turn shows a **Workers** card listing each worker with its agent and what it's doing.

- When a worker finishes, its row says so, with how long it took and its answer, and the lead agent goes on.
- Rows keep the order the workers started in. A worker's failure shows on its own row.
- Click **Stop** on a row to stop that worker. Its row says **Stopped**, the others go on, and the lead is told.
- Click a row to open that worker's own chat, with what it was asked and what it did.
- You can keep chatting with the lead while workers run.

The agent can also keep a worker at a check until it passes, trying again up to three times. These runs show on the Workers card with **Stop**, and how they ended once done.

A worker started by an agent in **Full access** gets full access too.

## When something is wrong

- If the linked folder is gone, the chat says the folder isn't there, and the folder row offers **Relink…**. No agent starts anywhere.
- If the folder moved and you relink it, the chat carries on in the new place. See [When a folder moves](/ai/projects#when-a-folder-moves).

::: info Limits
- A file deleted by a command the agent runs, such as `rm`, isn't shown as deleted, and a file a command writes isn't listed under its turn. Only files written with the agent's own file tools, and files Codex deletes, are.
- Images don't preview in a turn's file view.
:::

## Related

- [Projects linked to folders](/ai/projects)
- [The browser](/ai/browser)
- [Assign tasks to agents](/ai/tasks-for-agents)
- [Ask Claude about a page](/ai/ask)
