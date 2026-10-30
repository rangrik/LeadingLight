---
title: Assigning tasks to agents
description: Give a task to Claude or Codex, follow the work on the task, read its reports and evidence, and accept the result.
---

# Assigning tasks to agents <Badge type="info" text="Mac app" /> <Badge type="warning" text="Preview" />

Give a task to an agent with one press, then carry on with your own work. The agent works in the
project's folder on your Mac, shows what it is doing on the task itself, and publishes what it did
as a report beside the task. The task is done only when you accept it.

Agents run through the Claude Code or Codex you have installed and signed in to on your Mac. There
is no key to enter and nothing to pay LeadingLight; the usage counts against your own Claude Code or
Codex account.

## Before you start

- Turn on **Settings › AI › Projects › Linked folders and project chats**. It is marked
  "In development".
- The task needs a project with a linked folder. See [Projects linked to folders](/ai/projects).
- For a GPT model, Codex must be installed and signed in on this Mac.

A task is any page whose type has the **Done** property. The starter Task type works, and so does
a type of your own (a "Chore", say), as long as it has Done and a Project relation. Assigning keeps
the page's type and properties as they are.

## Assign a task

1. Open the task. Set its **Project** to a project with a linked folder.
2. Press **Assign** (the robot icon) in the line under the title, beside **Add property**.
3. In the dialog, choose:
   - **Agent**: a Claude model (Fable, Opus, Sonnet, Haiku) or, when Codex is signed in, a GPT model.
   - **Profile**: **None**, or one of your agent profiles.
   - **Access**: **Ask for approval**, **Approve for me** or **Full access**.
   - **Anything to add**: an optional note for the agent.
4. Press **Assign**.

The dialog closes and says, for example, "Assigned to Claude: Write the summary". The line under the
title now names the agent and how the work is going, and **Assign** is gone from the task.

An Agent page is made for the work, named after the agent and the task ("Claude: Write the
summary"). It is listed in Agents, and its **Task** is your task.

### Assign a page that isn't a task

A page of a project, such as a brief, can be assigned too. Press **Assign** on it and assign it as
above. LeadingLight makes a task with the page's name, linked to the page and to its project, and
gives that task to the agent. The page then says "Assigned as the task …", with a link to the task.
Assigning the page again finds that task rather than making another.

### Assign starts work only once

- Pressing **Assign** twice quickly, reloading, or quitting while it starts still makes one Agent
  page and one conversation.
- Mentioning a task with **@** in a page, or mentioning an agent in Ask, never starts any work.
  Only **Assign** does.

### When Assign isn't there

- A page that isn't part of a project with a linked folder shows no **Assign**. The dialog says to
  set its project or link a folder first.
- With **Linked folders and project chats** turned off, no page shows **Assign**.
- If you pick a GPT model and Codex isn't ready, the dialog says "Codex isn't on this Mac or isn't
  signed in."

## The brief

The agent's brief is the task as you wrote it when the work starts: its title, its words and its
project, plus anything you added in the dialog. The agent can read the project's pages and the
files in its folder as it works.

## Follow the work

An assigned task shows a work panel under its title. Everything in it comes from the agent and the
runtime that runs it; you don't need to open the chat.

| Part | What it shows |
| --- | --- |
| State | **Working**, **Needs your input**, **Ready for review**, **Idle** (its turn ended, nothing to review), **Stopped** (its agent process ended), or **Done** (you accepted it) |
| Now | What the agent says it is doing, such as "Reading notes.txt", and when it said so |
| Steps | "1 of 2 steps done", from the checklist the agent keeps. Click it to see the steps |
| Workers | Other agents it started, such as "Codex worker, working", then how each ended |
| Evidence | Small views of the images and files in its reports; each opens where it sits in its report |

A count shows only for steps the agent listed. There is never a guessed percentage. These lines
change in place as the work goes, and they never move the words you are reading: if you have
scrolled down to read a report, a growing checklist leaves the text where it is on screen.

### Subtasks

An agent can split the work into subtasks. They are ordinary Tasks whose **Subtask of** is your
task, listed on it as Subtasks and shown in the checklist with their ticks. The agent can tick its
own subtasks. It can't tick your task, or a task you made: it is told that only you mark it done.

### Workers

When the agent starts a worker (another Claude or Codex agent, to review a file, say), the panel
lists it under the agent. Each worker has its own Agent page, "Started by" the agent that started
it, and that page stays after the worker's session is gone.

### Stop and carry on

- Press **Stop** in the panel while the agent works. It stops, and the panel says **Idle**.
- Press **Continue** to have it carry on with the task. The panel says **Working** again.
- Press **Chat** to open the project's chat beside the task, on that agent's conversation and
  titled with the task's name. The chat is there when you want detail; you never need it.

## Reports

What an agent wants you to read arrives as a report: a new page shown after the task's own words,
with a byline naming the agent and when ("Claude · just now"), and **Open** to see it as its own
page.

- **Your words are never touched.** A report is its own page, not part of the task's text. You can
  keep typing while one arrives: your unsaved words, the cursor and where you are scrolled stay as
  they were, and after a reload both your words and the report are there.
- **Published while a page is closed.** The report is there the next time you open the page.
- **Published while LeadingLight is quit.** The agent is told the report is kept and will show when
  LeadingLight opens. When you open the app, it shows once on its page.
- **The same report sent twice** (a retry) shows once.

### A report never changes

You can read and select a report's words, but not edit them, and it has no properties to change.
Ask can't change it either, and the agent has no tool that edits or deletes. To correct itself, the
agent publishes a new report, which shows after the first and says it corrects it. The byline
links to the agent's page, and the agent's page lists its reports.

### Sources are checked

A report can name the pages it rests on, with the words it quotes. They show under the report as
"Rests on …", each opening where its words are. A publish that quotes words a page doesn't have, or
names a page outside the project, is refused, saying which source is wrong, and nothing shows.

### Reports are pages

Reports lists every report. Search finds a report's words, you can link to one, and other agents in
the project can read it. Neither the **@** link menu nor Reports offers to make a report or an agent
by hand: only agents and the app make them.

## Evidence

An agent shows its work with files: a screenshot, a recording, a document. It names them when it
publishes, from its folder or from the outputs the runtime kept, including files a shell command
made. LeadingLight keeps its own copy inside the report.

- **Images** show after the report's words, with the agent's caption under them. Click one to see
  it larger.
- **Videos** play inside the report.
- **Documents**, such as a PDF, show as a file card that opens the file.

The copy is the version the agent published. If the agent later changes or deletes the file in its
folder, or the folder is cleaned up, the report still shows what you reviewed. A new version of the
file comes with a new report; the first stays as it was. This holds even when the agent publishes
while LeadingLight is quit.

A file that can't be kept, such as one that doesn't exist or lies outside the agent's folder, is
refused when the agent publishes, saying which file and why. A report never shows a gap.

## Review and accept

When the agent given the task publishes its report as ready:

- The panel says **Ready for review** and "Read Summary, then accept it or send feedback.", where
  "Summary" is the report's title and opens it.
- The [Feed](/ai/feed-feedback) lists "“Write the summary” is ready for review", with **Accept**.

Read the report, then either send feedback (see [The Feed and feedback](/ai/feed-feedback)) or
press **Accept**. Accepting ticks the task's **Done**, the panel says "Accepted just now", and the
Feed item goes.

If the agent answered your feedback without saying it is ready and then stopped, the panel says
"Its latest report is …. Accept it when you're satisfied.", with **Accept**.

### Only you accept

Nothing an agent does marks the task done. If it tries to tick the task with its task tool, it is
refused and **Done** stays unticked. A worker's report marked ready doesn't make the task ready
for review either; only the report of the agent you gave the task to does.

### Later work doesn't undo it

If the agent publishes another report after you accepted, **Done** stays ticked. The panel says
"Accepted … · a report since", with a link to it, and the Feed says "Claude published after you
accepted “Write the summary”".

### Reopen a task

Untick **Done** to reopen an accepted task. The panel shows how the work stands again, and you can
ask the agent to carry on. Only you can reopen it.

Tasks no agent was given are as before: their checkbox ticks and unticks them, with no work panel.

## What everything is

**Settings › Objects** lists every kind of object LeadingLight keeps, with what it is for, who makes
it, what can change and where it shows: Project, Task, Agent profile, Agent, Report, Evidence,
Feedback and Question or approval, and the parts shown on a task and in the Feed (Question,
Activity, Checklist, Evidence and Review). **Show** on a row opens its pages, such as every report.
If you renamed Task or made your own task types, the row uses your names ("To-do, Chore").

::: info Limits
- To add sidenotes to a report, open it as its own page with **Open**. Notes can't be added to a
  report inside the task's stream.
- While LeadingLight is quit, an agent can't read your pages (it can still read its folder's
  files). What it publishes is kept and appears when you open the app.
- Evidence must come from the agent's folder or its kept outputs, up to 50 MB a file. A screenshot
  saved to another place, such as Downloads, can't be published.
:::

## Related

- [Projects linked to folders](/ai/projects)
- [Project chat](/ai/project-chat)
- [The Feed and feedback](/ai/feed-feedback)
- [Tasks](/organize/tasks)
- [Sidenotes](/write/sidenotes)
