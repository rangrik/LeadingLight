# Mail in LeadingLight

The design and build spec for Mail. The contract for what is built is `features/gmail.feature`;
this page holds the reasons, the exact words and the sizes. The Mac app and the browser build
follow sections 5.0 to 5.6, 6 and 7. The iPhone (5.7) is not built yet. "He" below is the
person the design was made for, not a rule about who uses it.

## 1. Who this is for

Someone who avoids email and wants to stop avoiding it:

- An inbox shows its weight before its content. It is mostly noise, every mail creates work, it
  never ends, and it lives somewhere else.
- There is no good time for it. Expect him tired, in the afternoon, on any day of the week.
- The first thing he needs from any mail: is this going to burden me or not. Then: what
  happened, where it stands, what he has to do.
- A mail is dealt with when all of these can be true: he has seen it and decided, it became a
  task, he replied from here, and it is gone from Gmail too.

The second round added three things: tags, the sender's email address in view, and how
time-sensitive each mail is.

## 2. What the design does about it

1. **The weight comes before the mail.** He never sees an inbox. He sees one sentence: how many
   need him, about how long, when the nearest date is, and whether anyone is upset.
2. **LeadingLight reads first.** Each mail arrives as a verdict and three short lines: What
   happened, Where it stands, Your part. The mail itself sits underneath as proof.
3. **One mail, one decision.** Four choices, always in the same place. The likely one is filled in
   and Enter takes it. Every choice ends that mail.
4. **It ends.** The set is fixed when he starts. A look is never more than five mails. The end
   says so, and says how long it took.
5. **Work leaves mail.** Anything that needs real work becomes a task with a link back.
6. **Noise never reaches him.** Receipts, newsletters and notifications are one line he clears
   with one key.
7. **Nothing nags.** No unread counts, no red, no streaks, no "overdue". A missed day costs
   nothing: the next look is the same size. A date that has passed is said once, plainly, and
   never counted.
8. **The same facts, in the same place.** Every mail carries its tags in one order: what kind of
   burden, by when, which account, and whether the sender is new. The sender's address sits beside
   their name. He never opens anything to learn who wrote, to which inbox, or how long he has.
9. **Plain facts, never comfort.** The words state what is true and stop: how many, how long,
   by when, who is upset when someone is. They never soothe ("nobody is upset", "no rush", "they
   will keep", "you do not have to"). Comfort points at the fear; plain facts, the same every
   day, let mail become ordinary until he stops noticing it.
10. **Time works for him.** Every mail that needs him says by when and how many days are left, or
   says there is no deadline. The opening sentence names the nearest date, and so does the end.
   A mail with a date cannot slip past unseen.

## 3. His day

**Once.** He connects his two accounts (this exists). Mail shows "Start fresh": how much is
waiting, and that he does not have to read it. He picks 3, 7 or 14 days (7 is chosen) and presses
Start. LeadingLight reads those days. Older mail stays in Gmail, untouched, and never shows here.

**Any day, any hour.**

1. He opens Today, as he already does. One row sits under the day bar, in the same box the
   leftovers card uses: `4 need you · about 5 min · nothing due before Wed` and
   a Go through button. If he ignores it, nothing happens. It never grows a number badge anywhere
   else.
2. He presses Go through. The first mail fills the pane. He reads the tags and three lines:
   about ten seconds.
3. He decides. Enter takes the filled button.
   - **Done** (nothing to do): the mail is archived and marked read in Gmail.
   - **Reply**: two short drafts are ready. He picks one, reads it, sends it. The mail is put away.
   - **Make a task**: the title and due date are filled in. Enter makes a Task page. He can tick
     "Also reply" to send one line saying he has it. The mail is put away.
   - **Later**: it stays in Gmail and comes back in the next look. No date to choose. If the mail
     has a date, the toast repeats it: `Kept: Sunita · due Fri, Nov 20`.
4. After the last mail comes **the rest**: "22 others, nothing to do". E clears them.
5. **"That's everything."** with what he did, how long it took, and the nearest date still open:
   "Nothing left is due before Fri, Nov 20." Enter goes back to Today.
6. Today's row now reads `Mail done · 1 replied, 1 task, 1 done, 1 kept for later, 22 cleared · 4 min`, greyed.
   The task he made is listed under This day, and in Tasks.

**What brings him back tomorrow.** It is already on Today, with the cost stated. It told him the
truth yesterday. It took four minutes and said so. And once a look is done, mail stays quiet until
the next day, so "done" really means done.

**After days away.** The pile is not shown as a pile. `11 need you · start with 5, about 6 min ·
nothing due before Wed`. After five: "5 done. 6 more wait for the next look."
Stop here is the filled button. Keep going is beside it. A date that passed while he was
away is said plainly on that mail (`Was Fri, Nov 13`), with what it means now.

**How the date is used for him.**

- He knows before he starts whether today matters: "nothing due before Wed", or "one is due today".
- Mail due today or tomorrow comes first in the look. After that, lightest to heaviest.
- Later is safe. A dated mail he keeps comes back in every look and leads it on its last two
  days. On the day itself Today's row returns even when the look is done: `1 is due today`.
- A task made from a mail takes the mail's date.
- He leaves knowing the next date, so nothing has to be held in his head.

**On the phone.** Today gets one row, built like Continue writing: `Mail / 4 need you · about 5
min`. A tap opens a sheet, as Capture does, with the same mail, one per screen, and the choices
at the thumb.

## 4. The reader (what makes the lines)

- It runs in the Mac app with the person's own Claude Code or Codex, the same path Tail uses. One
  request in, JSON out. No tools, no access to notes.
- It runs when the app opens or comes to the front, when Today opens, and at most every 30 minutes
  while the app is open. It only reads mail that arrived since it last ran.
- Sorting by rule comes first, with no model. A mail is "the rest" if Gmail filed it under
  Promotions, Social, Updates or Forums, or it has a List-Unsubscribe header, or the sender is a
  no-reply address. Everything else is "from people".
- Mail from people is read in full, with its conversation. The rest is skimmed in one batch
  (sender, subject, first line only) to name its group (Receipts, Newsletters, Notifications,
  Other) and to pull out anything that does need him (a failed payment, a security alert).
- For each mail from people it returns:

  | Field | Rule |
  | --- | --- |
  | `verdict` | `none` Nothing to do, `quick` Quick answer, `reply` Needs a reply, `work` Needs work |
  | `headline` | Up to 60 letters. Starts with who. Says what they want. Not the subject. |
  | `happened`, `stands`, `part` | One or two short sentences each. Plain words. `part` is "Nothing." for `none`. When there is a date, `stands` says where it comes from and what happens after it. |
  | `due` | A date the mail states, or the day before the event it is about. Never a guess. Otherwise nothing. |
  | `upset`, `tone` | `tone` only when upset: "Daniel is frustrated. He is asking for one thing: a date." |
  | `replies` | For `quick` and `reply`: two drafts, each a label of up to four words and the full text, in his voice, under 60 words |
  | `task` | For `work`: a title that starts with a verb, a due date, and a one-line "got it" reply |

- By rule, with no model: the sender's name and address (the From header), who else the mail
  went to (To, Cc), and whether the sender is new. New means no other mail from that address in
  the account: one search through the list route (`from:` the address), remembered per address.
- The app, not the reader, turns `due` into Today, Tomorrow or days left, each time it is shown.
  If a date has passed and the mail is still open, the reader looks at it once more: often the
  verdict becomes Nothing to do, and `stands` says what the passed date means now.
- Minutes: none 0, quick 1, reply 3, work 1 (the time to file it). The total is rounded up and
  never shown as less than "about 1 min".
- Which five a look takes, when more than five wait: mail with a date, soonest first; then an
  upset sender; then the rest that asks something of him (Needs a reply, Quick answer, Needs
  work, not read), oldest first. Nothing to do only fills places left over. Keep going takes the
  next five the same way.
- Order inside a look: anything due today or tomorrow first, then lightest to heaviest (none,
  quick, reply, work) with the sooner date first inside each, then mail kept from an earlier look.
  A kept mail in its last two days moves to the front. A look holds five at most; the others wait.
- The lines for each mail are stored with the workspace (encrypted, synced) so the phone has
  them. They are deleted when the mail is dealt with, and after 14 days.
- If the reader cannot run (the Mac is asleep, the model is at its limit), mail still shows,
  sorted by rule only, and says so. See "Not read for you" below.

## 5. Screens and exact words

Layout rules for all Mail screens on the Mac: the pane header is `PanelHeader` with the lucide
`mail` icon and "Mail" as the current crumb. Content starts 64 px from the pane's left edge (24 px
when the pane is narrower than 576 px) and is at most 632 px wide, the same column as a page.
The first line of content sits 40 px under the header, as a page title does. All controls are COSS
as shipped: Button, Kbd, Input, Textarea, Checkbox, Collapsible, Tabs, Popover + Calendar, Empty,
Toast, Sheet (phone), Badge, Tooltip. Colours are theme tokens only.

### 5.0 Tags, the address and the date

These are the same on every screen.

**Tags** are COSS `Badge`, as shipped. A mail has at most four, always in this order:

| Tag | Badge variant | Words |
| --- | --- | --- |
| Kind | `secondary`. `success` for Nothing to do. `outline` with muted text for Not read. | `Nothing to do`, `Quick answer · 1 min`, `Needs a reply · 3 min`, `Needs work`, `Not read for you` |
| When | `outline` with the lucide `clock` icon. `warning` when it is today or tomorrow, or passed and he still has to act. Muted text for No deadline, and for a passed date with nothing to do. | `Today`, `Tomorrow`, `By Fri, Nov 20 · 6 days left`, `No deadline`, `Was Fri, Nov 13` |
| Account | `outline` with a 6 px round dot in the account's colour before the name | `Work`, `Personal` |
| New sender | `outline` | `New sender`, only on the first mail from an address |

- Nothing to do has no When tag, unless a date has passed. Not read has Kind, Account and, since it
  needs no reader, New sender.
- Size `lg` on the mail (22 px tall, 14 px text) and default in lists (18 px tall, 12 px text).
  On the phone both are default, which COSS draws 22 px tall there. Tags sit 6 px apart and wrap.
- Where the pane is narrower than 544 px, and on the phone, the When tag drops "By" and "left":
  `Fri, Nov 20 · 6 days`.
- Colour means three things only: green is Nothing to do, amber is soon, the dot is the account.
  Nothing is red.
- An account's name starts as `Work` for an address on its own domain and `Personal` for a
  gmail.com address. He can rename it and pick its colour where accounts are managed. Colours
  are the `dot` classes of `COLORS` in `apps/desktop/src/lib/page-meta.ts`: blue for the first
  account, purple for the second, then teal, orange. Both are saved with the workspace settings.
- A COSS Tooltip on the mail's Account tag reads `Sent to pranav@northlane.io`. List rows are
  buttons, so their tags have none.
- Renaming an account and picking its colour are put off (`docs/DEFERRED.md`); the Personal or
  Work choice in Mail accounts names it, and the colour follows its place in the list.

**The address.** One line under the headline: the sender's name (14 px medium, text colour),
8 px, then their address and the time the mail came (14 px muted):
`Sunita Kulkarni  sunita.kulkarni@example.com · 9:05 AM`. Under 544 px, and on the phone, the
address and time sit on a second line. A long address cuts with an ellipsis; the time never
does. Clicking the address selects all of it. For mail older than today the time is the day: `Thu`.

**The date** is the reader's `due`. The app writes the words: today `Today`, the next day
`Tomorrow`, later `By <day>, <date> · <n> days left`, passed `Was <day>, <date>`.

### 5.1 Today's row (Mac)

Where: under `DailyBar`, in the same box as `DailyCard` (`mt-3 rounded-lg border px-3 py-2.5
text-sm`, rows built with `Row`). Icon 16 px, muted. The first words are `text-foreground
font-medium`; the remainder is `text-muted-foreground` and cuts with an ellipsis. Buttons are
size `xs`.

| State | Icon | Words | Buttons |
| --- | --- | --- | --- |
| Needs him | `mail` | **4 need you** · about 5 min · nothing due before Wed | Go through (outline) |
| One | `mail` | **1 needs you** · about 3 min · nothing due before Fri | Go through |
| No dates at all | `mail` | **2 need you** · about 2 min · no deadlines | Go through |
| Due today, someone upset | `mail` | **3 need you** · about 4 min · one is due today · Daniel is frustrated | Go through |
| Days away | `mail` | **11 need you** · start with 5, about 6 min · nothing due before Wed | Go through |
| A kept mail's day comes, look already done | `mail` | **1 is due today** · you kept it for later | Go through |
| Started, not finished | `mail` | **3 left** · pick up where you stopped | Continue |
| Only the rest | `mail` | **Nothing needs you** · 22 others to clear | Clear all (outline), Look (ghost) |
| Done | `check` | Mail done · 1 replied, 1 task, 1 done, 1 kept for later, 22 cleared · 4 min (all muted) | none |
| Stopped at five | `check` | Mail done for now · 5 handled · 6 for the next look | none |
| Not read | `mail` | **4 new from people** · not read for you yet | Go through |
| Reading | `mail` | Reading your mail… | none |
| First time | `mail` | **Mail is connected** · start fresh from the last 7 days | Start fresh |
| Account signed out | `circle-alert` (warning token) | Work mail needs reconnecting | Reconnect |
| Nothing new | no row | | |

The signed-out row is a second row in the same box. With one account signed out the sentence
ends `· personal only` in place of the mood.

The sentence has four parts, most important first, because it cuts from the end when the pane
is narrow: the count, the minutes, the date, the mood.

- The date: `one is due today`, `one is due tomorrow`, `nothing due before Wed` (the nearest
  date, as a weekday inside a week and as `Nov 30` beyond it), or `no deadlines`.
- The mood, only when someone is upset: `Daniel is frustrated`. Otherwise nothing.

### 5.2 Mail home

Reached from the sidebar's Mail row. It is the same information as Today's row, with the list.

- Title (page title style, 36 px bold): `4 need you`, `1 needs you`, `Nothing needs you`,
  `3 left`, `4 new from people`.
- One sentence under it (16 px, text colour):
  - `About 5 minutes. Nothing is due before Wednesday.`
  - `About 4 minutes. Daniel is frustrated about the export fix, and wants a date. One is due today.`
    (Someone upset: the minutes, the reader's one-line worry, then the date. Otherwise the
    minutes, then the date.)
  - `Nothing is due before Wednesday. The 5 that matter most take about 6 minutes.`
    (If one is due today: `One needs an answer today. The 5 that matter most take about 6 minutes.`)
  - Started: `Pick up where you stopped.`
- Then a row: primary Button `Go through` with Kbd `↵` (or `Continue`), and beside it in
  `text-xs text-muted-foreground`: `Read for you at 2:58 PM · Personal and Work`.
- The list, 24 px lower. Each row is a button, two lines, at least 52 px tall, 8 px padding,
  `rounded-md`, `hover:bg-accent`, pulled 8 px left so its text lines up with the title.
  - Line 1, 14 px medium: the headline. Cuts with an ellipsis.
  - Line 2, 12 px muted: `Quick answer · 1 min · Meera Iyer`. Needs work has no minutes.
  - Right, two columns that line up down the list, 16 px apart, centred on the row:
    - Account: the Account tag, in a 72 px column, left-aligned.
    - When: a 132 px column, right-aligned, 12 px muted, tabular. `Wed, Nov 18 · 4 days` with
      the days in medium text colour, so the eye can run down them. `No deadline` and
      `Was Fri, Nov 13` all muted. Today and Tomorrow are the `warning` Badge with the clock.
      Empty for Nothing to do.
  - Under 544 px the two move to a third line, left-aligned, 8 px apart.
  - Clicking a row opens the look at that mail.
- The rest, under a hairline the width of the column: line 1 `22 others, nothing to
  do`, line 2 `9 receipts · 8 newsletters · 5 notifications`, then `Clear all` (outline xs) and
  `Look` (ghost xs). Look opens the rest even while mails wait; there, Clear all, Later and Esc
  return to Mail home.
- Days away: the label `Start with these` (12 px medium muted, 32 px tall) over the five, and
  `Waiting for the next look` over the others, which are plain rows.
- `Kept for later`: the same label style, plain rows, line 2 ends ` · back in your next look`.
- A sign-in code: when a mail in the last 10 minutes carries a 4 to 8 digit code, a bordered row
  above the list: `key-round` icon, **GitHub code 481 920** · 1 min ago, `Copy` (outline xs, turns
  into `Copied` with a check). This needs no reader.

Other states:

| State | Title | Under it |
| --- | --- | --- |
| Nothing needs him | Nothing needs you | `Read for you at 2:58 PM · Personal and Work` (12 px muted), then the rest row |
| Nothing at all | Nothing needs you | `There is nothing new.` |
| Done | Mail is done for today | `1 replied, 1 task, 1 done, 1 kept for later, 22 cleared. It took 4 minutes. Nothing left is due before Fri, Nov 20.` (the last sentence as in 5.5) and in 12 px muted: `New mail waits for tomorrow's look. Anything that cannot wait shows up on Today.` |
| Stopped at five | Mail is done for now | `5 handled. 6 more wait for the next look.` with a `Keep going` outline button, then the waiting rows |
| Not read | 4 new from people | `LeadingLight could not read these for you. Claude is at its limit until 6 PM.` Rows show subject, then `Meera Iyer · 2:14 PM`, and the Account tag on the right with no When. The small text reads `Sorted by sender only · Personal and Work`. On the phone the sentence is `Your Mac has not read these yet.` |
| Signed out | as normal, for the accounts that work | a bordered row: `circle-alert` **Work mail needs reconnecting** · Google signed LeadingLight out, `Reconnect`. The sentence ends `This is your personal mail only.` |
| First time | Start fresh | `14,236 mails are in your two inboxes.` Then each account on its own line: its Account tag (72 px column), then in muted text `pranav.k@gmail.com · 11,902 waiting`. Then `Start from the last` and Tabs `3 days`, `7 days`, `14 days`. Then primary `Start` with Kbd `↵` and in 12 px muted: `Older mail stays in Gmail, untouched. It never shows up here.` |
| Reading | Reading the last 7 days | a spinner and `This takes about a minute. Today shows the result.` over three Skeleton rows |
| Offline | as last read | the small text becomes `You're offline. Read for you at 2:58 PM.` Buttons that change Gmail are disabled. |

### 5.3 One mail (the look)

Header: `mail` icon, Mail, then `2 of 4` in the counts slot (`after`). Back goes to Mail home. At
the far end two ghost icon buttons, `chevron-up` and `chevron-down` (disabled at the first and last
mail; nothing wraps round), move between mails without
deciding.

Top to bottom:

1. **Tags** (5.0), size `lg`: `Quick answer · 1 min`, `By Wed, Nov 18 · 4 days left`, `Work`.
2. **Headline**, 24/32 px semibold, 10 px lower: `Meera wants to move Thursday's review to 4 pm`.
3. **Who** (5.0), 6 px lower: `Meera Iyer  meera.iyer@northlane.io · 2:14 PM`.
4. **Tone**, only when upset, 12 px lower, 14 px medium with a `circle-alert` icon in the warning
   token: `Daniel is frustrated. He is asking for one thing: a date.`
5. **Three lines**, 24 px lower. A grid: labels in a 120 px column (14 px muted), text beside
   them (16/25.6 px), 16 px between columns, 10 px between rows, on one baseline. Labels:
   `What happened`, `Where it stands`, `Your part`. When the pane is narrower than 544 px each
   label sits over its text.
6. **Choices**, 24 px lower, default-size Buttons 8 px apart, always in this order, each with its
   key in a Kbd: `Reply` R, `Done` E, `Make a task` T, `Later` L. The reader's pick is the default
   (filled) variant and the others are outline: Done for Nothing to do, Reply for Quick answer and
   Needs a reply, Make a task for Needs work.
7. **The mail**, 32 px lower, in a `rounded-lg border` box. Its header (40 px) shows the subject
   in 12 px medium muted (` · 1 file` added when it has files), and a ghost xs button `Show all` /
   `Show less` with Kbd O. Closed, the body shows about three lines and fades out. Open, it shows
   first the mail's own header as 12 px lines, labels muted: `To` (the address it was sent to,
   which may be a list such as `everyone@northlane.io`), `Cc` when there is one, and `Sent`
   (`Sat, Nov 14, 9:05 AM`). Not From: the sender is already named under the headline. Then
   `2 earlier messages` as a ghost xs row, the text (14/22 px), file names as small bordered
   chips (`paperclip`, name, size), and `Open in Gmail` with `arrow-up-right` at the right.

**Reply** replaces the choices in place:

- A row of outline `sm` buttons, one per draft plus `Write my own`, each with Kbd 1, 2, 3. The
  first is chosen. The chosen one has the ring-colour border and accent fill.
- A Textarea holding the chosen draft. `Write my own` empties it, focuses it, placeholder
  `Write your reply`.
- A row: `Send` (default) Kbd `⌘↵`, `Cancel` (ghost) Kbd `Esc`, and at the right in 12 px muted
  `To meera.iyer@northlane.io · from pranav@northlane.io`. Both are full addresses. "To" is where
  the reply will really go: the mail's Reply-To when it has one. A reply always goes from the
  account the mail came to.
- Send is held for 8 seconds while the toast offers Undo. Closing the app sends it at once.

**Make a task** replaces the choices in place:

- `Task`: an Input holding the reader's title, selected. `Due`: an outline `sm` button with a
  `calendar` icon and the date (`Fri, Nov 20`, or `No date`); it opens the same Popover + Calendar
  the day bar uses.
- A Checkbox line: `Also reply “Got it, Daniel. I'll send the estimate before your Friday call.”`
- A row: `Make task` (default) Kbd `↵`, `Cancel` (ghost) Kbd `Esc`, and in 12 px muted
  `The task keeps a link to this mail.`
- The Task page gets: the title, Due, a `From mail` property (sender, account, subject; opens the
  mail), and the What happened and Where it stands lines as its first two paragraphs. Never the
  mail's own text.

**Toasts** (the app's Toast, where its other toasts appear, as wide as their words), each with `Undo` and Kbd Z for 8
seconds: `Done: Arjun Rao`, `Sent to Meera`, `Task made` (also `Open`), `Task made, and Daniel
told`, `Kept for later: Rohan Patil` (no date), `Kept: Sunita · due Fri, Nov 20` or `Kept: Daniel
· due today` (dated), `22 cleared`, `Kept: The Pragmatic Engineer. It will be in your next look.`

**Not read for you.** The tags are `Not read for you` and the account. The headline is the subject.
The sender's name and address show as always.
There are no three lines. All four choices are outline and Enter does nothing. The mail is open.
Reply opens an empty Textarea with no drafts.

**Errors**, shown as one line of `text-destructive` under the choices, with the mail still there:
`Didn't send. Your reply is kept.` with `Try again`; `Couldn't put this away in Gmail.` with `Try
again`; `This mail is no longer in Gmail.` with `Next`.

### 5.4 The rest

Header: Mail, then `The rest`.

- Headline: `22 others, nothing to do`. When not read: `22 others that look automated`.
- 14 px muted, 6 px lower: `Clearing archives them in Gmail and marks them read. Nothing is deleted.`
- Groups, each a Collapsible row 36 px tall: `chevron-right` (turns down when open), the name in
  medium, the count in muted, then up to three sender names in muted: `Amazon, Uber, Apple and 6
  more`. Open, each mail is a 32 px row: sender (156 px), subject (muted, cuts), time at the
  right. Hovering a row swaps the time for a ghost xs `Keep`, which leaves that mail in Gmail and
  brings it back as a mail in the next look. A COSS Tooltip on the sender's name (side top,
  aligned to its start) shows the address: `no_reply@email.apple.com`.
- Choices: `Clear all` (default) Kbd E, `Later` (outline) Kbd L.

### 5.5 The end

COSS `Empty` with `EmptyMedia variant="icon"` holding a `check`.

| Case | Title | Words | Buttons |
| --- | --- | --- | --- |
| All done | That's everything | `1 replied, 1 task, 1 done, 1 kept for later, 22 cleared. It took 4 minutes. Nothing left is due before Fri, Nov 20.` | `Back to Today` (default) Kbd `↵` |
| Stopped at five | 5 done | `6 more wait for the next look.` | `Stop here` (default) Kbd `↵`, `Keep going` (outline) |

The last sentence names the nearest date among the mail he kept for later and the tasks he made
in this look: `Nothing left is due before Fri, Nov 20.`, `Nothing left is due before tomorrow.`,
or `One thing is still due today.` It is left out when none of them has a date.

Beside a note the button reads `Done` and Mail home shows its done state. After the end, the look
is closed for the day: new mail waits for the next day's look. Two things bring Today's row
back the same day: a new mail the reader marks as due today (`1 new needs an answer today`), and
the last day of a mail he kept for later (`1 is due today · you kept it for later`).

### 5.6 Beside a note

Mail opens as a second pane like any view (Shift-click, or drag). Checked at 448 px wide. Nothing
changes except what the rules above already say: 24 px side padding, labels over their text, the
header shows only Mail and the count, rest rows drop the time, group rows drop the sender names.
From 5.0: the When tag drops "By" and "left", the address sits under the name, and a list row's
Account tag and date move to a third line.

### 5.7 iPhone

- **Today**: the first button in "Pick up where you left off", built exactly like Continue
  writing (outline, at least 64 px tall, icon, two lines, chevron). Top line `Mail` in muted
  14 px. Second line: `4 need you · about 5 min`, `3 need you · 1 due today` (the date takes the
  place of the minutes when something is due today), `3 left`, `Nothing needs you · 22 to clear`,
  `4 new · not read yet`, `Done for today`, `Done for now · 6 waiting`, `Start fresh`. A
  signed-out account is a second button: `Work mail` / `Needs reconnecting`.
- **The sheet**: built like the capture sheet (rounded top under the status bar, reaches the
  bottom and sides, page behind dimmed, no line under its header). Header: a round 44 px button
  at the leading end (`x` closes; `chevron-left` while replying or making a task), in the middle
  `2 of 4`, `The rest`, `Reply to Meera` or `New task` in muted 14 px, and at the trailing end a
  filled rounded button `Send` or `Make task` only while replying or making a task.
- **One mail**: the same content as the Mac in one column, 20 px side padding. Tags first, in
  the short form, wrapping to a second line when they need to. Headline 22/28 px. The sender's
  name, and under it their address and the time. Labels (13 px muted) sit over their text
  (16/24 px). There is no hover on a phone, so `Show all` is where he sees the account's own
  address (`To`).
- **Choices** are fixed at the bottom of the sheet, above the home indicator: the reader's pick
  as a full-width default button, and under it the other three side by side as outline buttons.
  All 44 px tall. With no pick, a two by two grid of outline buttons.
- **Replying**: the mail is replaced by its headline on one muted line, the drafts as outline
  buttons that wrap (44 px tall), the Textarea, and two 12 px muted lines:
  `To meera.iyer@northlane.io` and `From pranav@northlane.io`.
  The bottom buttons are hidden. **Making a task** is laid out the same way, with Task and Due
  stacked.
- **The rest**: rows are two lines with `Keep` always shown. Line 1 is the sender, then their
  address in 13 px muted, which cuts. Line 2 is the subject. Bottom: `Clear all` (default),
  `Later` (outline).
- **The end**: the same Empty, with `Done` at the bottom, which closes the sheet.
- Toasts sit just above the bottom buttons.

## 6. Keyboard (Mac)

Single keys work when no field has focus. Every key is shown on its button.

| Where | Key | Does |
| --- | --- | --- |
| Mail home | Enter | Go through, Continue or Start |
| One mail | Enter | The filled choice |
| One mail | R, E, T, L | Reply, Done, Make a task, Later |
| One mail | O | Show all or less of the mail |
| One mail | J or ↓, K or ↑ | Next or previous mail, without deciding; stops at the first and last |
| Reply | 1, 2, 3 | Choose a draft, or Write my own |
| Reply | ⌘ Enter | Send |
| Make a task | Enter in the title, or ⌘ Enter | Make task |
| Reply, Make a task | Esc | Cancel |
| One mail, The rest | Esc | Back to Mail home (nothing is lost) |
| The rest | E or Enter, L | Clear all, Later |
| The end | Enter | The filled button |
| Anywhere in Mail | Z | Undo, while its toast shows |

To add in `features/shortcuts.feature` and the keymap: a key that opens Mail. ⌥⌘M fits the
pattern of ⌥⌘F, ⌥⌘K and ⌥⌘S.

## 7. Motion

- A new mail fades in and rises 6 px over 180 ms, ease-out. The old one is simply gone.
- Reply and Make a task open the same way. Hover fills take 150 ms. A group's chevron turns in
  150 ms. The phone sheet rises over 200 ms.
- With Reduce Motion on, nothing moves.

## 8. What it needs beyond today's service

Read again on November 14, after the first version of this spec. The service
(`apps/cloud/src/gmail.mjs`) now has what the first version asked for: Google's `gmail.modify`
permission; a list route that returns each mail's Gmail labels and whether it can be
unsubscribed from, and can list mail since a time; `thread`; `modify` (Inbox and Unread only);
`send` (a reply only); `counts`. Decision 48 was changed the same day to allow the one fixed
reader, and a task that keeps the sender, subject, link and two lines.

**Must have, for tags, addresses and dates (5.0). In this order.**

1. **One more field from the reader: `due`**, by the rule in section 4, and the rule that
   `stands` explains the date. Days left is worked out in the app. Nothing new at the service.
2. **The Reply-To address.** The list and `message` routes return From, To and Cc already.
   `send` answers to the mail's Reply-To when it has one, so the reply form must show that
   same address before he presses Send. The two routes should return it.
3. **Account names and colours**, saved with the workspace settings. Nothing at the service.
4. **New sender**: one search through the existing list route (`from:` the address), kept per
   address. Nothing new at the service.

No new Google permission, and no reconnecting.

**One thing to settle.** Decision 48 now says the reader's lines stay on the Mac. The phone
screens in 5.7 show the tags and the three lines. Either the lines travel in the workspace's
encrypted sync, as section 4 asks, or the phone shows every mail as "Not read for you" (5.3)
with only its Account tag and address. The first is the design. The second is what he gets
if nothing changes.

**Later.**

5. A check while the app is closed, and at most one phone notification a day ("3 mails need you.
   One is due today."). Today the reader needs the Mac app open.
6. Opening and saving attachments. Today only their names are known.
7. Unsubscribing from a sender in the rest.
8. "Add to calendar" when a mail proposes a time (the calendar connection can already write).
9. Remembering his corrections per sender ("mail from Asha never needs me").
10. Tags from his own notes: the sender's People page, and the Project a mail belongs to.
11. Search, older mail, and writing a new mail that is not a reply.

**If nothing is added.** Without `due`: every mail still shows its Kind and Account tags and
the sender's address, which need nothing new. The date stays inside the "Where it stands"
sentence, where the first version had it, and the opening sentence goes back to
`4 need you · about 5 min`. He can read a date, but nothing sorts by it,
warns him on the day, or tells him what is next when he leaves.

**Without the reader at all** (the Mac is asleep, the model is at its limit): mail is sorted by
rule only. Each mail shows `Not read for you`, its Account tag, `New sender` and the sender's
address. He has to read it himself to learn whether it will burden him and by when, which is
the one thing he asked not to do.

## 9. Left out, and why

- **Unread counts, badges, a number on the sidebar or the bar.** They are what he avoids, and the
  iPhone spec already bans them on Today. Today's row is the one door.
- **An inbox list, folders, labels, stars.** That is Gmail. The look is the product.
- **Filtering or sorting by tag.** A look is five mails. Tags are there to be read at a glance,
  not to manage a list.
- **Tags he makes himself, and topic tags (Money, Home, a project).** The headline already says
  what a mail is about. They earn a place only with search or a longer list. See Later, 10.
- **Counting days late.** A passed date reads `Was Fri, Nov 13`, once, with what it means now.
  Never "3 days overdue".
- **A tag for "someone is waiting".** It is true of most mail and would turn into blame. The
  "Where it stands" line says it in words when it matters.
- **The address in every row of the rest on the Mac.** Those mails are there to be cleared, not
  read. It is one hover away, and on the phone it is shown.
- **Rules for work hours and personal hours.** He works odd hours. One look holds both accounts
  and each mail says which it came to.
- **Putting the rest away without asking.** Trust first. It is one key.
- **Sending a draft he has not seen.** Every reply is shown before Send.
- **A date for Later.** Choosing a date is a decision. Later means the next look. A mail that
  has its own date cannot slip: see "How the date is used for him" in section 3.
- **Swipes on the phone.** Buttons are easier to find and harder to hit by accident.
- **Streaks and scores.** A missed day would turn them into blame.
- **Showing a mail's original formatting.** Text only, as decision 48 says. Open in Gmail is there.
- **A settings screen.** Accounts (connect, reconnect, disconnect) and the start date should sit
  in a dialog like Calendar's "Your calendars". Not drawn here.
- **Mail in the bar's panel.** A 320 px panel is too narrow to read a mail in, and a second home
  for Mail would split the habit.

## 10. Not checked

- Drawn and checked in headless Chromium only, at 1280×800, at 448 px beside a note, and at
  390×844, in the default light and dark themes. Not in WebKit, not in the Mac app's window, not
  on a real iPhone, and not with the onscreen keyboard up.
- The prototype imitates COSS's components in plain CSS, with sizes copied from the running build.
  The real components may differ by a pixel.
- Only the default theme. The other 22 need `pnpm check:themes` once this is built.
- The error lines (5.3), the offline state, `Tomorrow`, `no deadlines`, a Cc line, and the two
  rows that bring Today back (5.5) are given in words only. They are not drawn in the prototype.
- The Badge and Tooltip are imitated in CSS like the other controls. The green and amber tags
  use the theme's success and warning tokens, so they need the same theme check.
- Whether the reader finds dates well: a wrong date is worse than none. Count its misses on a
  week of real mail before trusting `Today` on the row.
- Long subjects, very long conversations, mail in other languages, and mail with only pictures.
- How good, how fast and how costly the reader is on his own model plan. Everything in section 4
  should be tried on a week of his real mail before the screens are built on top of it.
