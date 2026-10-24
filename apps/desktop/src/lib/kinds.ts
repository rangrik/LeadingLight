import type { TypeDef } from "~/lib/catalog";
import type { PageIcon } from "~/lib/page-meta";
import type { Space } from "~/lib/space";
import { AGENT, REPORT } from "~/lib/work";

// Settings › Objects (features/objects.feature): each kind LeadingLight keeps or shows, who makes
// it, what can change and where it shows. A kind backed by a type takes the type's current name;
// a task is any type with the Done property, so a space's own task types count.

export type Kind = {
  id: string;
  name: string;
  icon?: PageIcon;
  lucide?: string;
  widget?: boolean;
  purpose: string;
  made: string;
  changes: string;
  shows: string;
  // A type whose pages are its examples.
  type?: TypeDef;
};

export function kinds({ types }: Space): Kind[] {
  const type = (id: string) => types.find((t) => t.id === id);
  const named = (t: TypeDef | undefined, fallback: string) => ({ name: t?.name ?? fallback, icon: t?.icon, type: t });
  const tasks = types.filter((t) => t.props.includes("done"));
  return [
    {
      id: "project",
      ...named(type("project"), "Project"),
      purpose: "A piece of work and its notes. Linked to a folder on this Mac, it has chats with agents that work in that folder.",
      made: "You, from New; Link folder above its title links the folder.",
      changes: "Everything you write. Agents read it and add reports beside it; they never change your words.",
      shows: "Projects, the sidebar, and its chat beside it.",
    },
    {
      id: "task",
      ...named(tasks[0], "Task"),
      ...(tasks.length > 1 && { name: tasks.map((t) => t.name).join(", ") }),
      purpose: "Something to do, ticked off with Done. Any type with the Done property is a task.",
      made: "You. An agent adds subtasks only to the task it was given.",
      changes: "You tick Done. An agent ticks only subtasks it made.",
      shows: "Its type's list, and as a line with a checkbox wherever it is linked.",
    },
    {
      id: "agent-profile",
      name: "Agent profile",
      lucide: "user-cog",
      purpose: "How an agent works: its instructions and model, in Claude Code's own agent files.",
      made: "Three come with the app; the rest are files in ~/.claude/agents or the app's agents folder.",
      changes: "Edit the file. Agents already at work keep what they started with.",
      shows: "The @ menu in Ask.",
    },
    {
      id: "agent",
      ...named(type(AGENT), "Agent"),
      purpose: "One agent at work: the conversation it runs in, the task it was given, and the agent that started it.",
      made: "The app, when an agent first publishes or is given a task.",
      changes: "Notes you write on its page. What it published stays as it was.",
      shows: "Agents, and on its task.",
    },
    {
      id: "report",
      ...named(type(REPORT), "Report"),
      purpose: "What an agent published for you to read: signed, dated and kept beside the page it is about.",
      made: "Agents, with their publish tool. Never from New.",
      changes: "Nothing, once published. A correction is a new report after it.",
      shows: "After the words of the page it is about, and in Reports.",
    },
  ];
}
