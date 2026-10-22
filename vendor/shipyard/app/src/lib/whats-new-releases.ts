import type { Release } from "./whats-new-model.ts";

// Each release's highlights, newest first, for the What's new card
// (components/whats-new). Not the changelog (docs/changelog.mdx): four to
// six things a person would want to try, in a sentence or two each, and
// one line each for a few smaller ones. A release with nothing worth a card
// gets no entry, and the card doesn't show.
//
// `version` is the version the release ships as (make publish VERSION=…):
// the card shows once to anyone who updates to it or past it.

export const RELEASES: Release[] = [
  {
    version: "0.3.10",
    items: [
      {
        id: "artifacts",
        title: "Artifacts",
        body: "Agents can show their work: charts, tables, diagrams and small pages. Each is a card in the chat that updates as the agent rewrites it, and they collect on the worktree's board.",
        art: "artifacts",
        show: "artifacts",
        docs: "/guides/artifacts",
      },
      {
        id: "visual-diff",
        title: "Visual diffs",
        body: "After a UI change, an agent shoots your pages before and after at three widths. Slide between the two, or step from one change to the next.",
        art: "visual-diff",
        show: "visual-diff",
        docs: "/guides/visual-diffs",
      },
      {
        id: "devtools",
        title: "Console and network",
        body: "The Browser tab shows its page's console and requests in a drawer under it. Send an error or a failed request to the worktree's agent in one click.",
        art: "devtools",
        show: "devtools",
        keys: "⌘⌥I",
        docs: "/guides/browser#developer-tools",
      },
      {
        id: "rename",
        title: "Display names",
        body: "Call a worktree something you can read, such as Refund flow, instead of the name a pasted link gave it. Its branch and folder stay as they are.",
        art: "rename",
        show: "rename",
        keys: "F2",
        where: "on a worktree in the sidebar",
        docs: "/concepts/projects-and-worktrees#display-names",
      },
      {
        id: "agent-messages",
        title: "Messages from other agents",
        body: "A helper's report, a teammate's question or another session's note shows as theirs, with who sent it. They used to look like messages from you.",
        art: "agent-messages",
        docs: "/guides/labs#conversation-view",
      },
      {
        id: "speed",
        title: "Quicker and steadier",
        body: "Chats of 2,000 turns stay quick. With 300 worktrees the sidebar is ready in 0.07 s, not 2.48 s. When the link to a box is slow or drops, Berth says so and reconnects.",
        art: "speed",
        docs: "/concepts/laptop-agent#slow-and-dropping-networks",
      },
    ],
    also: [
      { text: "Agent CLIs installed with npm are found on new boxes.", show: "settings-boxes" },
      { text: "Team setup shows each repo's setup, and when it waits for you." },
      { text: "Drag the sidebar's edge to resize it." },
    ],
  },
];
