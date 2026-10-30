---
title: Ask Claude about a page
description: Ask Claude or GPT about a page or a few words, let it change the page with your approval, and put its answer into your note.
---

# Ask Claude about a page

Every page has Claude beside it. Ask about the whole page or about words you select. Claude can read and change the page, find and read your other pages, make new ones, and look things up on the web. It runs through the Claude Code on your Mac, or through Codex for GPT models; see [AI and agents](/ai/) for setup.

## Open Ask

- Click the **Ask Claude** button (a sparkles icon) in the page's header, beside the Writing menu. Its tooltip reads **Ask Claude ⌘J**. Click it again to close the panel.
- Or press <kbd>⌘J</kbd> with nothing selected. Press <kbd>⌘J</kbd> again while you're in the question field to close the panel and go back to the page.

Ask opens in the bar's panel at the right of the window, and the page narrows to make room, so no words sit under it. See [The bar](/workspace/bar). With no thread yet, it reads "What should we do with" and the page's name.

With pages side by side, each page's header has its own Ask button, shown on hover. In a page too narrow for the button, <kbd>⌘J</kbd> still works.

While a GPT model is chosen, the button and the ask bar read **Ask GPT**.

## Ask about a few words

1. Select the words.
2. Press <kbd>⌘J</kbd> (or click the Ask button). The **ask bar** appears just above the words, which stay marked. Its field reads **Ask Claude about this…**.
3. Type your question and press <kbd>↩</kbd>.

The panel opens with the words quoted above your question, and Claude starts on it. The ask bar moves with the words as the page scrolls. Press <kbd>Esc</kbd>, or click elsewhere in the page, to close it.

### Quote in reply

For a longer question, click **Quote in reply** in the ask bar instead. The panel opens with the words quoted just above the question field, and nothing is sent yet. Write your question there. The quote's **×** takes it away.

::: tip
The ask bar's field is a single line. For mentions and commands, use **Quote in reply** and the panel's field.
:::

## Read the answer

Your message sits on the right, with any quoted words above it. While Claude works, a line reads **Working for 1s**, counting up, and **Stop** takes the place of **Send**. When it's done, the line reads **Worked for** and the time, and the answer is under it.

Claude's work folds under that one line. Click it to see each step on its own row, such as "Thought for 1s" or "Read" and the page's name. Click a step to see what was asked and what came back. A turn that only answered, with no steps, shows just the answer.

Under the answer are **Insert below**, **Replace** and a copy button.

With a GPT model, Codex's running notes and its final answer show as separate messages, outside the folded work. Copy and **Insert below** always use the final answer.

## Put the answer into your note

- **Insert below** adds the answer's paragraphs after the block that held your selection.
- **Replace** swaps the quoted words for the answer, inline when the answer is one paragraph. It then goes away, since those words are gone. If you've typed elsewhere in the page since, it finds the words where they are now. If the words are no longer in the page, nothing changes, and the panel says so.
- The copy button puts the answer on the clipboard as Markdown, and shows a check for a moment.

## Stop

Click **Stop** while Claude works. It stops where it was, the line reads **Stopped after** and the time, and **Send** is back.

## Approvals

The **access** button in the field's footer sets what Claude may do without asking. Reading never asks.

| Access | What it does |
|---|---|
| **Ask for approval** | Claude asks before changing a page or using the web. |
| **Approve for me** | Claude Code's auto mode: a classifier approves or blocks each action, and asks you when unsure. |
| **Full access** | Claude changes pages and uses the web without asking. The button turns the warning colour. |

Your choice is kept, and it is the same setting as **Access** in **Settings › AI**.

### Answer an approval

In **Ask for approval**, a change waits for you. The question field gives way to a card such as "Edit “Cells”?", showing the words taken out struck through in red and the new words in green. The page doesn't change yet.

| Button | Key | What it does |
|---|---|---|
| **Allow once** | <kbd>1</kbd> | Makes this change. |
| **Allow for this thread** | <kbd>2</kbd> | Makes this change, and later changes in this thread without asking. A new thread asks again. |
| **Decline** | <kbd>3</kbd> | Leaves the page as it was. The step is marked declined, and the turn ends. |

The card takes the keyboard, so the number keys answer it, unless you were typing in the page when it came; then the keyboard stays in the page. After you answer, the step reads, for example, "Edited “Cells”", and the field comes back. The turn's time leaves out the time the card waited for you.

A change Claude makes goes through the page's editor, so <kbd>⌘Z</kbd> in the page takes it back in one step.

If Claude asks to change words that are no longer in the page, the step is marked failed, its details say the words weren't found, and the page is unchanged.

## Plan mode

Plan mode lets Claude look and think without changing anything.

1. Click **+** in the field's footer and turn on **Plan mode**. A **Plan** chip shows in the footer.
2. Ask. Claude reads the page, writes a plan, and nothing in the page changes.
3. Under the plan, click **Make these changes**. Plan mode turns off and "Go ahead with the plan." is sent in the same thread.

To turn Plan mode off without going ahead, click the **Plan** chip.

## Other pages and new pages

Claude can search your pages: a step such as "Searched pages for “powerhouse”" lists what it found in its details. It can make a new page, which shows as a step "Created" with the page's name and an **Open** button. The page appears in the sidebar, and the panel stays on the page you asked from. Making a page counts as a change, so it asks first in **Ask for approval**.

## The web

Claude can look things up on the web. The step reads "Searched the web for" and what it searched, with a globe icon. In **Ask for approval**, Claude asks before it searches.

## GPT through Codex

With Codex installed and signed in, the model picker lists its GPT models under **GPT**. Pick one and ask as usual: the steps are the same as Claude's, and a change asks with the same card.

Two things differ with GPT:

- Codex searches the web on its own servers, so a web search never shows a card.
- Codex has no classifier for the app's tools, so with **Approve for me**, GPT still asks before changing a page, as with **Ask for approval**.

### Switch between Claude and GPT in one thread

You can change the model in the middle of a thread. Pick a GPT model and ask a follow-up: GPT answers in the same thread, after being sent the note afresh. Pick Claude again and Claude carries on its own conversation from where it was.

## Threads

Each page keeps its own threads, and they're kept when you quit and reopen the app.

- To start over, open the thread menu in the panel's header and choose **New thread**.
- The same menu lists earlier threads by their first question. Pick one to bring it back; a follow-up carries on that conversation.
- A thread stays with its page. Switch to another page while an answer is coming, and when you come back the answer is there.

Ask follows the page you're on. Open another page from the sidebar, or make one, and Ask shows that page's thread, while the keyboard stays in the page. Press <kbd>⌘J</kbd> to move to the question field. On a list such as **Pages**, Ask reads "Open a page to ask Claude about it." With two pages side by side, click into the other page, or its Ask button, to see its thread.

Press <kbd>Esc</kbd> in the panel to close it and go back to the page. <kbd>⌘J</kbd> brings back the same thread. Nothing you type in the panel ever reaches the page.

## The question field

The field sits at the bottom of the panel, in one rounded card. It reads **Ask about this page…**, or **Ask about the selection…** with words quoted. <kbd>↩</kbd> sends, and <kbd>⇧↩</kbd> starts a new line. **Send** is off until you type something.

Under the field, from the left:

- **+** opens a menu with **Page or agent** (types `@` and opens the mention menu), **Command** (the slash commands) and the **Plan mode** switch.
- The **access** button, such as **Ask for approval** with a hand icon.
- At the far end, the **model** button, such as **Opus Medium**, and the round **Send** button.

In a narrow panel the access button keeps only its icon and the model button drops the effort. With Plan mode on, the access button shows only its icon, to make room for the chip.

### Pick the model and effort

Click the model button. A list shows Claude's models under **Claude** (Fable, Opus, Sonnet and Haiku, with <kbd>⌘1</kbd> to <kbd>⌘4</kbd> while the list is open), and under **GPT** the models your Codex offers. Under the list, a slider sets the effort, with that model's stops: Low, Medium, High, Extra High and Max for Claude; some GPT models add more. The button then reads, for example, **Sonnet Extra High**, the next question uses them, and **Settings › AI** shows the same.

### Mention a page

Type `@` and start the page's name, then choose it. A chip with the page's icon sits in your text, and that page's text goes along with the question. In a thread that has started, it goes again only when the page has changed.

### Slash commands

With words quoted, type `/` for things to do with them: **Explain**, **Summarize**, **Shorten**, **Expand**, **Fix grammar**, **Rewrite** and **Translate**. Choosing one sends it at once, such as "Shorten this". **Translate** writes "Translate this into " and waits for you to name the language.

Use the arrow keys to move through a menu, and <kbd>↩</kbd> to pick.

## Agents

An agent is a set of instructions, with its own model, that you can call on in a question. Type `@` in the field to see them: first the three that come with the app, then yours, each with its description, then your pages.

| Agent | What it does |
|---|---|
| **Editor** | Tightens prose without changing its meaning or voice |
| **Summarizer** | The shortest faithful summary |
| **Critic** | Finds the gaps, weak claims and missing evidence |

Choose one and a chip with the agent icon sits in your text. That question follows the agent's instructions and uses its model.

### Add your own agents

Agents are Claude Code's own agent files, so any you already have work here. LeadingLight reads them from `~/.claude/agents` and from the app's own agents folder. An agent file is a Markdown file with its name, description and model at the top, and its instructions below:

```md
---
name: Fact checker
description: Checks each claim against the page's sources
model: sonnet
---
Read the page and list every claim that has no source.
```

**Settings › AI › Agents** lists every agent with where it came from: **Built in**, or the file's name. **Show folder** opens the app's agents folder, where you can drop in a file. A file with no name is left out, and the rest still show.

::: info Limits
- Ask works on your notes and the web. It can't read or change other files on your Mac; for that, link a folder and use a [project chat](/ai/project-chat).
- **Send** waits while a turn runs. You can't add to a question while Claude is still answering it.
- Threads you have with GPT are ordinary Codex conversations, so they also show in Codex's own list of past sessions.
:::

## Related

- [AI and agents: overview and setup](/ai/)
- [The bar](/workspace/bar)
- [Project chat](/ai/project-chat)
- [Sidenotes](/write/sidenotes)
