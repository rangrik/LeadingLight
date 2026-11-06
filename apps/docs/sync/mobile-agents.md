---
title: Agents on your Mac from iPhone and iPad
description: Pair inside LeadingLight and control project agents running on your own Mac.
---

# Agents on your Mac from iPhone and iPad

The installed iPhone and iPad apps can start, read, answer and stop project agents on your Mac.
The Mac runs Claude Code or Codex with your existing sign-in and keeps the project files and
conversation. You only need LeadingLight on each device. Note sync is optional.

## Connect

1. Open LeadingLight on your Mac and mobile device with an internet connection. Sign in to your
   LeadingLight account on the Mac through **Account and sync**. Your mobile device pairs with a
   code; it does not need a separate account or VPN app.
2. On the Mac, enable project chats in **Settings → AI**, then link a page to a project folder.
3. In **Settings → Devices**, choose the projects to share, then enable **Mobile access**.
4. Press **Copy code**. In LeadingLight on your iPhone or iPad, open **Settings → Devices**,
   paste it into **Mac connection code**, and press **Connect Mac**.
5. Open **Agents on Mac** from **Notes** on iPhone, the sidebar on iPad, or Devices settings. Choose a project and a conversation,
   or start **New chat** with Claude Code or Codex. The provider must already be installed and
   signed in on the Mac.

Connection codes are secrets. They authorize control of the selected project agents from devices
through this connection. The mobile app keeps its code in Keychain. **Replace code** on the Mac
invalidates the old code on all devices; copy the new code to reconnect them.

## While an agent works

New agents ask for approval before changes or commands, subject to the provider's normal approval
rules. Questions and approvals appear in the conversation. Mobile approval is for one request;
changing an agent to broader access remains a Mac action. A conversation already using broader
access can be read or stopped, but must return to approval mode on the Mac before mobile replies.

**Stop** interrupts only the selected agent. If the Mac cannot confirm a stop, the conversation
shows the error; reconnect and check it before assuming the agent has stopped.

The agent keeps working when you lock the phone or close the mobile app. Reopen the same project
to see its conversation and any pending approval. A lost start or send acknowledgement leaves
**Check and retry** beside the saved message. That action uses the same request identity, so it
does not create a second agent or send the same follow-up twice. Approval answers are not resent
automatically after reconnection.

If a start cannot be confirmed even after reconnecting, check the Mac's conversation first.
**Dismiss saved request** then lets you edit the draft again after confirmation. It does not
cancel work on the Mac; sending a new request could repeat work that already ran.

## Availability and privacy

Keep the Mac awake and connected to the internet. Closing its window or quitting LeadingLight leaves
the project runtime available while mobile access is enabled. After a Mac restart, open
LeadingLight once. Requests fail visibly while it is unavailable. An unconfirmed request expires after about
30 seconds. Reconnecting never resends it automatically; check the conversation before retrying.

Both apps connect outward to LeadingLight's HTTPS relay. Pairing creates an encryption secret
on the Mac which reaches the mobile app only through your connection code. Requests and replies
are encrypted before leaving either device. The relay sees connection IDs, network addresses,
timing and message sizes, but cannot read prompts, replies or project contents. It does not run
agents. Requests expire, and the Mac records accepted request IDs before executing them so an old
message cannot run again after a restart.

Claude and Codex still send prompts and relevant project data to their model providers; this does
not make the models themselves offline. The relay carries messages, while your Mac executes
commands and keeps the project files.

Only shared project conversations are exposed. The connection does not expose terminals, arbitrary
file browsing, runtime settings, or the Mac's note-tool bridge. Removing a project or disabling
mobile access blocks further requests. Existing work continues on the Mac, where you can review
or stop it.

## Current limits

- One Mac connection at a time. Connecting a different Mac keeps drafts separate.
- This is for project agents in the installed mobile app. The browser's separate
  [page-agent pairing](/sync/pairing) is unchanged. Ask about selected note text, Tail and task
  assignment are not enabled on mobile by this connection.
- Project folders are chosen on the Mac. Mobile cannot create worktrees, attach files, view the
  agent's browser, or change its access mode.
- LeadingLight note tools and publishing still need the Mac app open to handle writes. General
  project work can continue with the window closed or app quit.
- The Mac must remain awake; LeadingLight cannot wake it remotely.

## Permissions and questions

Permission requests and questions stay pending on the Mac until you respond. Approve, decline,
or answer from either device. Claude accepts feedback with Decline or Keep planning. Codex
records the decline first, then offers a separate **Send feedback** message in that conversation.
If delivery is uncertain, your exact response is kept for an explicit retry.

In Devices settings, enable **Agent notifications** to receive a generic alert while the app is
closed. Tap it to fetch the request through the encrypted connection. Commands, file names,
questions and answers never appear in the alert. A request already handled elsewhere stays handled.
iOS controls alert delivery; requests remain available in the app when alerts are denied or delayed.
Privately installed Ad Hoc builds support these notifications; App Store submission is not required.

The conversation and approval controls resize above the keyboard, including in landscape.
