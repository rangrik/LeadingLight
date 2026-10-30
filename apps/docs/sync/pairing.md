---
title: Agents from a browser
description: Connect the web app to your Mac so Ask can use the Claude Code or Codex already signed in there.
---

# Agents from a browser <Badge type="warning" text="Preview" />

Agents always run on your Mac, through the Claude Code or Codex you installed and signed in to.
To use them from the web app in a browser, connect that browser to your Mac. Ask in the browser
then sends your question to the Mac, the Mac runs the agent, and the reply comes back to the
browser.

Your own Claude Code or Codex account's usage applies. You are never asked for an API key, and
LeadingLight doesn't charge for model usage.

Until a browser is connected, Ask in the browser says "Agents work on your Mac" and offers
**Connect a Mac**. Your notes, history and sync keep working either way.

## What you need

- The web app, signed in to your workspace, with cloud access enabled for your account. See
  [Accounts and encrypted sync](/sync/).
- The Mac app, open, on a Mac with Claude Code or Codex signed in.

Pairing doesn't turn on note sync. It only connects agents.

## Connect your Mac

1. **In the web app**, open **Account and sync › Agents**. Give the browser a name in **Browser
   name** if you like, and press **Connect a Mac**.
2. A **Pairing code** appears, with **Copy code**. It expires in five minutes. Share it only with
   your Mac.
3. **In the Mac app**, open **Account and sync › Agents**. Check **Mac name**, paste the code into
   **Pairing code from your browser**, and press **Review connection**.
4. The Mac shows **Allow this browser?** with the browser's name and your workspace account. It
   explains that the browser can run page agents with your CLI accounts on this Mac, and that web
   tools use the Mac's network and follow the approval mode chosen in the browser. Check the names,
   then press **Allow this browser** (or **Decline**).
5. **Back in the web app**, the card says **Mac approved**. Press **Done**. Your Mac is listed with
   **Online** and whether Claude Code and Codex are signed in.
6. Press **Use this Mac**.

Now open Ask from a page or a selection, as on the Mac. The Mac's name shows at the top of Ask,
with **Manage**. See [Ask Claude about a page](/ai/ask).

Each browser needs its own pairing. A code works once, only for your account, and not after it
expires.

## What works from the browser

A connected browser uses page agents: Ask about a page or a selection. The reply streams into Ask
in the browser, and any change to your pages goes through the browser's own approvals, authorship
and undo, as on the Mac.

It can't reach your project folders, project chats, terminals or project agents. Those stay on the
Mac.

## What the relay can and can't read

Messages between the browser and the Mac pass through LeadingLight's service, which works as a
mailbox. It keeps only who the message is for and the encrypted message itself.

- **It can't read** your questions, the agent's replies, what its tools read or changed, the
  pairing key, or your Claude Code and Codex sign-in. Those never leave your devices unencrypted.
- **It never runs** a model. The work happens on your Mac.

The browser keeps its key in its own storage, and the Mac keeps its key in the Keychain.

## Keep both open

The browser and the Mac app must both stay open and connected, and the Mac awake, while an agent
works.

- If the Mac is asleep, offline, or LeadingLight isn't running, Ask says which Mac is unavailable
  and how to reconnect it ("Offline — open LeadingLight on this Mac and keep it awake."). Send is
  unavailable, and your draft stays.
- A question sent while the Mac was away never starts later by surprise.
- If the connection drops for long enough, the Mac stops the turn before anything else can run.
- Quitting LeadingLight on the Mac stops its agents, and the browser shows the Mac as offline.

## Stop and revoke

- **Stop a reply** in Ask as usual. Ask says it is stopping until the Mac confirms. From the moment
  you press Stop, the agent can't change or make pages, and no new approval appears. Agents
  running on the Mac itself carry on.
- **Remove the connection** in the web app (**Remove connection**) or on the Mac (**Revoke browser
  access**). New messages are refused at once, and any running turn stops shortly after.

## Reloads and other tabs

- **Reloading the browser** while an agent replies keeps what it wrote so far and marks the turn
  interrupted. Nothing is replayed on its own: reconnect, then ask again.
- After a reload, Ask waits quietly until it knows your saved connection.
- **Another tab** can't use a connection that one tab is using unless you choose **Take over
  connection**, which stops that tab's work.
- **Clearing the browser's storage** removes its key. Connect your Mac again from that browser.
- **Signing out or switching accounts** while a reply arrives discards that reply; it can't change
  pages in the other account.
- A conversation stays with the Mac it ran on. If you switch Macs, the next question starts with
  fresh page context.

::: info Limits
- One agent turn at a time per connection, and up to thirty an hour.
- Up to five pairing codes waiting at once, thirty a day, and ten connections per account.
- A turn doesn't carry on after you close or reload the browser: the browser runs the page tools and
  approvals.
- If the browser or Mac hits a delivery or storage failure it can't recover from, the connection is
  revoked so no edit is repeated. Connect again to carry on.
:::

## Related

- [Ask Claude about a page](/ai/ask)
- [Accounts and encrypted sync](/sync/)
- [Overview and setup](/ai/)
- [Privacy](/guide/privacy)
