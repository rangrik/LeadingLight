Feature: Mail is a look, not an inbox
  Mail says what my mail will cost me before I read any of it, takes me through it one mail at a
  time, and ends. The design is docs/MAIL.md. Gmail is a separate connection to the
  signed-in workspace, with Google's gmail.modify permission. A reader on my Mac, running my own
  model with no tools and no notes, writes each mail's lines. The lines stay on this device.

  Names used below:
  - personal: "pranav.k@gmail.com" (Personal); work: "pranav@northlane.io" (Work)
  - a normal day: Arjun Rao (Nothing to do), Meera Iyer (Quick answer, by Wed, Nov 18), Sunita
    Kulkarni (Needs a reply, by Fri, Nov 20), Daniel Weiss (Needs work, by Fri, Nov 20), and 22
    others: 9 receipts, 8 newsletters, 5 notifications
  - addresses: arjun@northlane.io, meera@northlane.io, sunita.kulkarni@gmail.com,
    daniel@northlane.io, asha@smiledental.in (Smile Dental, who has never written before)
  - from people: not filed by Gmail under Promotions, Social, Updates or Forums, no
    List-Unsubscribe header, and not from a no-reply address. Everything else is "the rest".

  Background:
    Given I am signed in and both accounts are connected
    And it is Saturday, November 14, 2026, 3:02 PM

  Scenario: Connect two accounts
    When I connect Gmail
    Then Google asks to let LeadingLight read, reply to and put away my mail
    And "pranav.k@gmail.com" is Personal and "pranav@northlane.io" is Work, guessed from the address
    And I can change either, and the change follows the workspace
    And connecting an account again replaces its connection without a second copy
    But if I refuse the permission to put mail away, nothing is connected and Mail says why

  Scenario: Connect from the Mac through Safari
    Given I am signed in to LeadingLight on the Mac
    And Safari is signed in to the same LeadingLight workspace
    And another browser is the Mac's default
    When I press "Connect Gmail"
    Then Google's account chooser opens in Safari
    And after I allow access, Mail updates without signing the Mac in again
    And "Open in Gmail" opens the original mail in Safari
    And connecting Google Calendar or opening device approval also uses Safari

  Scenario: Return from Google to the app that started connecting
    Given I started connecting Gmail in the installed app
    When I finish consent in Safari
    Then Safari opens that installed app at Mail
    And the connected account appears without changing pages or reopening the app
    And reconnecting the same account clears the waiting message too
    And an older account refresh cannot replace the newly connected account
    And Safari offers "Open LeadingLight" if the automatic return is blocked
    And a development app returns to its own window, not the released app
    But cancelling consent returns to Mail without changing existing connections
    And the cancellation notice clears when I leave Mail
    And an expired or unrelated return link cannot change the workspace or claim success
    And a connection started in the web app stays in the web app
    And cancelling in the web app opens Mail with the cancellation notice, even during startup

  Scenario: The deployed service accepts Mail from installed apps
    Given the Gmail service has been configured and deployed
    When the signed-in Mac requests its Gmail accounts
    Then it receives its workspace's accounts without "This native session cannot use this route."
    But a revoked device is still refused
    And native requests cannot use Google's callback or delete mail

  Scenario: Before any account is connected
    Given no Gmail account is connected
    When I open Mail
    Then the title is "Mail" over "LeadingLight reads your new mail and tells you what needs you. Nothing is sent or put away unless you say so." and "Connect Gmail"
    When I press "Connect Gmail"
    Then it says "Finish in the browser window that opened. This page updates by itself." and shows Start fresh once the account is there
    And while waiting the button reads "Open Google again", so I can retry if I closed Google
    But signed out of LeadingLight, the button reads "Sign in to connect Gmail" and opens the account dialog
    And if I cancel at Google, Mail says "Connection cancelled. Nothing changed."
    And if the service is not set up or cannot be reached, it says why with "Try again", and "Connect Gmail" is disabled

  Scenario: Accounts
    When I press the accounts button in Mail's header (tooltip "Mail accounts"), or any "Reconnect"
    Then a dialog lists each address with Personal or Work and Disconnect, then "Add account"
    And it says "Disconnect removes saved access. Your mail stays in Google."

  Scenario: Mail follows the workspace while devices come and go
    Given I chose three days on one Mac and its choice reached the server
    When I quit that Mac and open Mail on another signed-in device the next morning
    Then the second device shows new Gmail and unfinished mail from that starting date
    And it never asks me to pick an import window or switch devices

  Scenario: Two open devices receive changes without touching either device's sync controls
    Given Mail is open on two devices in the same workspace
    When I keep one conversation for later on each before either sees the other change
    Then both conversations are kept for later on both devices
    And a third device returning from offline catches up automatically
    And a slow summary on one device cannot delay fetching new mail there

  Scenario: Start fresh
    Given I have never started Mail
    Then Today's row reads "Mail is connected · start fresh from the last 7 days" with "Start fresh"
    When I open Mail
    Then the title is "Start fresh" and it says "14,236 mails are in your two inboxes."
    And "7 days" is chosen from "3 days", "7 days" and "14 days"
    And "Add another account" is centred on the last account's row
    When I press Enter
    Then the first emails can be opened while the reader prepares their lines
    And mail older than 7 days is never listed, read or changed

  Scenario: The weight comes first
    Given the reader has read a normal day
    Then Today's row reads "4 need you · about 5 min · nothing due before Wed" with "Go through"
    And Mail home's title is "4 need you" over "About 5 minutes. Nothing is due before Wednesday."
    And beside "Go through" it says "Read for you at 2:58 PM · Personal and Work"
    And nothing anywhere shows an unread count or a badge

  Scenario Outline: The sentence follows the day
    Given <day>
    Then Today's row reads "<row>"
    And Mail home's title is "<title>"

    Examples:
      | day                                                      | row                                                                     | title             |
      | one mail needs a reply, by Fri, Nov 20                   | 1 needs you · about 3 min · nothing due before Fri    | 1 needs you       |
      | two mails, neither with a date                           | 2 need you · about 2 min · no deadlines               | 2 need you        |
      | the nearest date is Mon, Nov 30                          | 1 needs you · about 1 min · nothing due before Nov 30 | 1 needs you       |
      | Daniel is frustrated and wants a date today, among 3     | 3 need you · about 4 min · one is due today · Daniel is frustrated      | 3 need you        |
      | one is due tomorrow                                      | 2 need you · about 4 min · one is due tomorrow        | 2 need you        |
      | 11 mails need me after days away                         | 11 need you · start with 5, about 6 min · nothing due before Wed        | 11 need you       |
      | I went through 1 of 4 and left                           | 3 left · pick up where you stopped                                      | 3 left            |
      | only the rest came                                       | Nothing needs you · 22 others to clear                                  | Nothing needs you |
      | nothing new came                                         | (no row)                                                                | Nothing needs you |

  Scenario: Mail home names the nearest date
    Given Daniel is frustrated about the export fix and needs an answer today, among 3 mails
    Then Mail home says "About 4 minutes. Daniel is frustrated about the export fix, and wants a date. One is due today."
    Given 11 need me and nothing is due before Wednesday
    Then Mail home says "Nothing is due before Wednesday. The 5 that matter most take about 6 minutes."
    And the five are mail with a date, soonest first, then an upset sender, then what asks something of me, oldest first
    And "Nothing to do" mail only fills places left over, and the five are shown lightest first

  Scenario: Every mail carries the same tags, in the same order
    When I open Sunita's mail
    Then above the headline are three tags: "Needs a reply · 3 min", "By Fri, Nov 20 · 6 days left" with a clock, and "Personal" with a blue dot
    And under the headline it says "Sunita Kulkarni" and "sunita.kulkarni@gmail.com · 9:05 AM"
    When I hover "Personal"
    Then a tooltip says "Sent to pranav.k@gmail.com"
    When I open Arjun's mail
    Then its tags are "Nothing to do" in green and "Work" with a purple dot, and there is no date tag
    When I open Smile Dental's mail
    Then its last tag is "New sender"
    And a second mail from asha@smiledental.in has no "New sender" tag
    And nothing is red

  Scenario Outline: The date tag
    Given a mail whose date is <due> and whose kind is <kind>
    Then its date tag reads "<tag>" and is <look>

    Examples:
      | due                    | kind           | tag                           | look                     |
      | Sat, Nov 14            | Needs a reply  | Today                         | amber                    |
      | Sun, Nov 15            | Quick answer   | Tomorrow                      | amber                    |
      | Fri, Nov 20            | Needs a reply  | By Fri, Nov 20 · 6 days left  | plain                    |
      | none                   | Quick answer   | No deadline                   | muted                    |
      | none                   | Nothing to do  | (no tag)                      |                          |
      | Fri, Nov 13            | Nothing to do  | Was Fri, Nov 13               | muted                    |
      | Fri, Nov 13            | Needs a reply  | Was Fri, Nov 13               | amber                    |

  Scenario: The date tag beside a note
    Given Mail is open beside a note, narrower than 544 px
    When I open Sunita's mail
    Then its date tag reads "Fri, Nov 20 · 6 days"
    And the address and time sit on a line of their own under "Sunita Kulkarni"

  Scenario: The list lines up account and date
    When I open Mail home on a normal day
    Then each row's second line is what it is, its minutes, and who: "Quick answer · 1 min · Meera Iyer"
    And at the right every row has its account tag in one column and its date in the next
    And Meera's date reads "Wed, Nov 18 · 4 days" and Arjun's is empty
    And a mail due today shows "Today" as an amber tag

  Scenario: Open one email from the list after stopping a look
    Given Mail home says "Mail is done for now" and shows Daniel and Meera under "Waiting for the next look"
    When I click Daniel's row
    Then the list stays on the left and Daniel's mail opens on the right
    And Daniel's full message and mail headers are shown immediately
    When I click Meera's row
    Then the same reading pane shows Meera's full message
    And the look stays closed and neither mail is marked read or archived

  Scenario: Read individual mail in a narrow pane
    Given Mail is open in a pane too narrow to show the list and message side by side
    When I open a mail from "Kept for later"
    Then its full message is shown with "Mail / Message" in the header
    And the header's Back arrow and Mail breadcrumb each return to the list and restore focus to the row
    When I go back and open a different mail
    Then the reading pane shows the new mail, even if the first mail finishes loading later

  Scenario: Open individual emails on iPhone and iPad
    Given a Gmail account is connected and the current look has ended
    When I open "Mail" from Today on iPhone or the sidebar on iPad
    And I tap a waiting mail
    Then its body and headers are expanded
    And on an iPad with a wide pane the list stays beside the message
    When I return with the header's Back arrow and tap another mail
    Then that message opens expanded
    And tapping Done removes it and tapping Undo brings it back

  Scenario: Where a mail came from and where a reply goes
    When I open Sunita's mail
    Then the mail's header reads "To pranav.k@gmail.com" and "Sent Sat, Nov 14, 9:05 AM", and "Cc" when it has one
    And it does not repeat the sender, who is named under the headline
    Given Kavya's mail was sent to everyone@northlane.io, with a Reply-To of people@northlane.io
    When I press R on it
    Then it says "To people@northlane.io · from pranav@northlane.io"
    And the service sends the reply to people@northlane.io

  Scenario: Dates work for me
    Given Daniel's export mail is due today and Sunita's is due Fri, Nov 20
    When I press "Go through"
    Then Daniel's mail comes first
    When I press L on Sunita's mail
    Then the toast says "Kept: Sunita · due Fri, Nov 20"
    When I press L on Daniel's mail
    Then the toast says "Kept: Daniel · due today"
    When the look ends
    Then it says "One thing is still due today."
    And Today's row reads "1 is due today · you kept it for later" with "Go through"
    When I press "Go through"
    Then Daniel's mail is shown again

  Scenario: The end names the next date
    Given I kept Sunita's mail for later and made Daniel's task due Fri, Nov 20, on a normal day
    When the look ends
    Then its sentence ends "Nothing left is due before Fri, Nov 20."
    And so does Mail home's, once the look is done
    But when nothing I kept or made has a date, the sentence has no date
    And a task made from a mail is due on the mail's date unless I change it

  Scenario: Finding the date
    When the reader reads a mail
    Then its date is one the mail states, or the day before the event it is about, and never a guess
    And "Where it stands" says where the date comes from and what happens after it
    When that date passes and the mail is still open
    Then the reader reads it once more, and "Where it stands" says what the passed date means now
    And a date is never counted as days late

  Scenario: One mail, one decision
    When I press "Go through"
    Then the first mail is Arjun's, "Nothing to do", with What happened, Where it stands and Your part
    And the choices are Reply, Done, Make a task and Later, in that order, and Done is filled
    When I press Enter
    Then Arjun's conversation is archived and marked read in Gmail
    And a toast says "Done: Arjun Rao" with Undo
    When I press Z
    Then it is back in the inbox and unread, and Arjun's mail is shown again

  Scenario: Reply
    Given Meera's mail is shown, "Quick answer"
    When I press R
    Then "4 pm works" is chosen and its draft is in the box
    And it says "To meera@northlane.io · from pranav@northlane.io"
    When I press ⌘ Enter
    Then a toast says "Sent to Meera" with Undo, and nothing is sent for 8 seconds
    And after 8 seconds the reply goes to the address in Meera's mail, in her conversation, from my work account
    And the conversation is archived and marked read

  Scenario: The look is a page in the pane
    When I press "Go through" on Today
    Then the look opens in Today's pane, and the pane's Back and Esc go back to Today
    And from Mail home, they go back to Mail home, and the end's button reads "Done" instead of "Back to Today"
    And J or ↓ and K or ↑, or the header's chevrons, move between mails without deciding
    And they stop at the first and last mail; the chevron at an end is disabled

  Scenario: Make a task
    Given Daniel's mail is shown, "Needs work"
    When I press T
    Then Task holds "Send Daniel the Larkfield cost estimate" and Due shows "Fri, Nov 20"
    When I tick "Also reply" and press Enter
    Then a Task page is made, due Fri, Nov 20, whose "From mail" names Daniel Weiss, Work and the subject
    And its first two paragraphs are the What happened and Where it stands lines
    And none of the mail's own text is on the page
    And Daniel is sent "Got it, Daniel. I'll send the estimate before your Friday call."
    And the toast says "Task made, and Daniel told" with Open and Undo
    And on the Task page, "From mail" opens the mail: in Mail while it still waits there, else in Gmail

  Scenario: Later, the rest and the end
    When I press L on Sunita's mail
    Then it stays in Gmail, and the toast says "Kept: Sunita · due Fri, Nov 20"
    And a mail with no date says "Kept for later: Rohan Patil"
    When the four are decided
    Then the rest says "22 others, nothing to do" and "Clearing archives them in Gmail and marks them read. Nothing is deleted."
    And hovering a sender's name in the rest shows its address in a tooltip
    And "Look" beside the rest on Mail home opens the rest even while mails wait; clearing it there, Later or Esc go back to Mail home
    And each toast is as wide as its words
    When I press Keep on "The Pragmatic Engineer" and then E
    Then 21 are archived and read, and The Pragmatic Engineer comes back as a mail in my next look
    And the end says "That's everything" and "1 replied, 1 task, 1 done, 1 kept for later, 21 cleared. It took 4 minutes. Nothing left is due before Fri, Nov 20."
    And Today's row reads "Mail done · 1 replied, 1 task, 1 done, 1 kept for later, 21 cleared · 4 min", greyed
    When new mail comes later today
    Then the row stays as it is, unless the reader marks a new mail as due today

  Scenario: Stopped at five
    Given 11 need me
    When I decide the first 5 and choose "Stop here"
    Then Today's row reads "Mail done for now · 5 handled · 6 for the next look"
    And tomorrow's look starts with those 6, and mail I kept for later comes last

  Scenario: The reader cannot run
    Given the reader could not run because Claude is at its limit until 6 PM
    Then Today's row reads "4 new from people · not read for you yet"
    And Mail home says "LeadingLight could not read these for you. Claude is at its limit until 6 PM."
    And each mail's tags are "Not read for you" and its account, its headline is its subject, and all four choices are outline
    And its sender's name and address still show
    And in the browser build, which has no model, every mail is "Not read for you"
    But a model's answer that is not JSON, names a mail it was not sent, has a draft over 60 words or holds HTML gives that mail no verdict and no draft

  Scenario: The reader stays a reader
    When the reader reads new mail
    Then it sends my model one message with the mail marked as data, and the model has no tools and no notes
    And a mail that tells the model to do something is read as mail, not obeyed
    And it reads only mail that came since it last ran: when the app opens or comes to the front, when Today opens, and at most every 30 minutes
    And its lines are deleted when the mail is dealt with, and after 14 days

  Scenario: Done and Clear all do not wait for Gmail
    When I press E
    Then the next mail shows at once, and Gmail is asked behind it
    When Gmail refuses while I am still on the next mail and have decided nothing since
    Then Arjun's mail comes back with "Couldn't put this away in Gmail." and "Try again"
    But when I have moved on, a toast says "Couldn't put Arjun Rao away in Gmail." with "Try again"
    And when 3 of the rest cannot be cleared, a toast says "3 could not be put away in Gmail. They are back in the rest."
    And Undo waits for Gmail's answer before putting anything back

  Scenario: Failures leave the mail where it was
    When sending fails
    Then the mail says "Didn't send. Your reply is kept." with "Try again", and the reply is still in the box
    When Gmail refuses to put a mail away
    Then the mail says "Couldn't put this away in Gmail." with "Try again", and nothing is counted as done
    When the mail was deleted or archived in Gmail meanwhile
    Then it says "This mail is no longer in Gmail." with "Next"
    When I am offline
    Then the small text reads "You're offline. Read for you at 2:58 PM." and every button that changes Gmail is disabled

  Scenario: An account signed out
    Given Google signed my work account out
    Then Today has a second row, "Work mail needs reconnecting" with "Reconnect"
    And Mail home's sentence ends "This is your personal mail only."
    And personal mail still works

  Scenario: Replies only go where the mail came from
    When the app asks the service to reply to a mail
    Then the service takes the recipient from that mail's Reply-To, else its From, and ignores any address the app sends
    And the subject starts with "Re: " once, and In-Reply-To and References name the mail answered
    And a reply is plain text of at most 20,000 characters
    And the service can add or remove only Inbox and Unread, and never trashes, deletes or marks spam

  Scenario: Keep accounts and workspaces apart
    Given another workspace has connected a Google account
    Then I cannot list, read, move, reply from or disconnect that account
    And Google's sign-in state expires after ten minutes and works once, for its own workspace
    And the installed app can use only the named Gmail routes, never the callback
    When I sign out or switch workspaces
    Then the last workspace's mail and the reader's lines are gone from view, and late answers cannot bring them back
