---
title: AI and agents
description: What LeadingLight's AI features do, what you need on your Mac to use them, and what leaves your Mac when you do.
---

# AI and agents: overview and setup

LeadingLight's agents are Claude and GPT, working beside your notes. They run on your Mac through the Claude Code and Codex command-line tools you have installed and signed in to, so there is no key to enter and nothing extra to pay.

## What the agents do

- **Ask on every page.** Each page has Claude beside it. Ask about the page or about words you select, and Claude can read and change the page, find your other pages, make new ones and look things up on the web. See [Ask Claude about a page](/ai/ask).
- **Tail.** A quiet helper that reads along and now and then offers one line you can accept with a single press: file your ideas, give a task its day, link a name. See [Tail and suggestions](/ai/tail).
- **Projects and project chats.** Link a page to a folder on your Mac, or to a GitHub repository, and chat with an agent that works in that folder: it reads and changes files, runs commands, and reads the project's pages. See [Projects linked to folders](/ai/projects) and [Project chat](/ai/project-chat).
- **Tasks for agents.** Give a task to an agent with one Assign. It works in the project's folder and writes a report beside the task. See [Assign tasks to agents](/ai/tasks-for-agents) and [Feed and feedback](/ai/feed-feedback).
- **The browser.** A browser inside the app that you and a project's agents share. See [The browser](/ai/browser).

## What you need

Agents run in the installed Mac app. You need at least one of these on the same Mac, installed and signed in:

| Tool | Gives you | Install | Sign in, in Terminal |
|---|---|---|---|
| Claude Code | Claude models (Fable, Opus, Sonnet, Haiku) | [claude.com/code](https://claude.com/code) | `claude auth login` |
| Codex | GPT models | [developers.openai.com/codex/cli](https://developers.openai.com/codex/cli) | `codex login` |

LeadingLight finds each tool the way your Terminal does, so it uses the same copy you use there. It never asks for an API key and never reads your sign-in. Each question runs on your own Claude or ChatGPT plan, and that plan's limits apply. LeadingLight doesn't bill you for usage.

::: tip
You only need one of the two. With Claude Code alone, everything works with Claude models. Add Codex if you want GPT models too.
:::

### Check that it's set up

1. Open **Settings › AI**.
2. Under **Account**, the **Claude Code** row says **Signed in as** your account, with your plan and version. The **Codex** row says the same for Codex, and how many GPT models it offers.
3. If you've just installed or signed in to one, press **Check again** on its row.

### When a tool is missing or signed out

The app says what to do, in **Settings › AI** and in the Ask panel:

- **Claude Code not installed.** Settings says **Not installed**, with a link to claude.com/code and the sign-in command. The Ask panel says the same, with **Check again**.
- **Claude Code not signed in.** The panel says to run `claude auth login` in Terminal, then check again. You can still type a question, but **Send** stays off until you're signed in.
- **Codex not installed.** In the model picker, the GPT group says **Install Codex to use GPT models**, with a link, and lists no models.
- **Codex not signed in.** The GPT group says **Run codex login in Terminal to use GPT models**. If you chose a GPT model earlier, the panel sends nothing until Codex is ready, and says why.

### In a browser or on iPad

In LeadingLight in a web browser, Ask shows **Agents work on your Mac** with **Connect a Mac**. Pairing the browser with your Mac lets it use that Mac's Claude Code or Codex; see [Pair a browser with your Mac](/sync/pairing). Agents are not available in the iPad app.

## Settings › AI

**Settings › AI** holds everything about the agents, in groups:

| Group | What it holds |
|---|---|
| **Account** | Which account Claude Code and Codex are signed in to, with **Check again** |
| **Command-line tools** | The version of each tool, how it was installed, and **Update** |
| **Projects** | The switch for linked folders and project chats (still in development, so off at first), and the project runtime |
| **Answers** | The **Model**, **Effort** and **Access** that Ask uses |
| **Tail** | Tail's settings; see [Tail and suggestions](/ai/tail) |
| **Agents** | Every agent you can mention with `@`; see [Agents](/ai/ask#agents) |
| **Privacy** | What leaves this Mac |

Under **Answers**:

- **Model**: Claude's models through Claude Code (Fable, Opus, Sonnet, Haiku), then the GPT models Codex offers. Opus is chosen at first.
- **Effort**: how long the model thinks before answering: Low, Medium, High, Extra High or Max. Some GPT models offer more. Medium is chosen at first.
- **Access**: **Ask for approval**, **Approve for me** or **Full access**. Ask for approval is chosen at first. See [Approvals](/ai/ask#approvals).

The model and effort you pick in the Ask panel are the same setting, so a change in either place shows in both.

## Keep Claude Code and Codex up to date

The **Command-line tools** group lists Claude Code and Codex, each with its version and how it was installed, such as "2.1.308 · its own installer" or "0.153.4 · Homebrew". Hover a row to see where the tool is on your Mac.

- A tool installed with npm or Homebrew that has a newer version shows both, such as "0.153.4 → 0.163.0", with an **Update** button. Hover **Update** to see the command it runs. While it works, the button reads **Updating**; then the row reads **Current** with the new version.
- Claude Code from its own installer updates itself. Its row says **Updates itself**, and it has an **Update** button you can press at any time, but the app never prompts you about it.
- A tool that isn't installed reads **Not installed**, with a link to **How to install it**.

### The update toast

About ten seconds after the app opens, and then once an hour, the app looks for newer versions. When it finds one, a toast at the bottom right says so, for example **Codex update available**, with three buttons:

- **Update all** updates every tool that is behind. A toast shows **Updating Codex…**, then **Codex updated** and "New sessions use the new version."
- **Review** opens **Settings › AI** at the tools.
- **Skip** hides it for that version. A newer version brings it back.

Left alone, the toast goes after 15 seconds and comes back at a later hourly check, never sooner, even if you quit and reopen the app. Once you've answered it for a version, it doesn't show again for that version.

If an update fails, a toast reads, for example, **Couldn't update Codex**, with the reason and the command to run in Terminal yourself.

To stop the checks, turn off **Check for updates** in the **Command-line tools** group. The rows still say what is installed.

## See how much of your plan is left

The **Usage** button at the bottom of the sidebar shows a ring for Claude and one for Codex, each with its name and the most-used of its limits, such as "Claude 39%". The outer ring is the weekly limit and the inner ring the five-hour limit; a plan without a five-hour limit has only the outer ring. A ring fills as you use the plan:

| Used | Colour |
|---|---|
| Under 75% | Green |
| 75% and over | Amber, and the percentage too |
| 90% and over | Red, and the percentage too |

In a narrow sidebar the names give way and the rings and percentages stay.

Click **Usage** for the details. For each plan, the card shows a row for each limit, such as "5h 14% used" with "Resets in 59m", and a bar with a tick at what an even pace would have used by now. A bar short of its tick means you're under pace. Under each bar it says how much is in reserve and whether it lasts until the reset, or, when you're over pace, how short you are and when it runs out at this pace. At 100% it reads **Limit reached**. If your Codex plan has credits for use past the limits, the card shows them too.

The numbers come from Claude Code and Codex themselves, so the app never reads your sign-in. They're checked when the app opens, every five minutes while it's open, and when you open the card if the last check is over a minute old. The bottom of the card says when they were last checked, with a refresh button. If a check fails, the last numbers stay, with a line saying they couldn't be checked.

If a tool is signed out, its ring is empty and dimmed, and the card says, for example, "Sign in with claude auth login to see usage."

::: tip
Ask, Tail and project chats all use your plan. Tail's use shows in the same rings.
:::

## What leaves your Mac

Your notes stay on your Mac. Only what an agent needs leaves it, and only when an agent runs:

- **Ask** sends your question, the page you ask from, and the pages the model reads or you mention: to Anthropic for Claude, to OpenAI for GPT.
- **Project chats** also send the files the agent reads in the folder you linked, as it works.
- **Tail**, without being asked, sends the titles of your pages, and the summaries and changed words of the pages it reads on. You choose which types of page those are; see [What Tail reads](/ai/tail#what-tail-reads).
- Your sidenotes stay private: Tail and a project's agents never read them, unless you send them to an agent as feedback.

The same words are in **Settings › AI › Privacy**. For more, see [Privacy](/guide/privacy).

## Related

- [Ask Claude about a page](/ai/ask)
- [Tail and suggestions](/ai/tail)
- [Projects linked to folders](/ai/projects)
- [Pair a browser with your Mac](/sync/pairing)
- [Settings](/customize/settings)
