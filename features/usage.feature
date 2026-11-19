Feature: How much of each plan is used
  The bottom of the sidebar shows how much of your Claude and Codex plans is used, one thin bar
  each, and a click shows each limit with when it resets and whether, at this
  pace, it lasts. A bar fills with what is spent, as a person reads a full bar. The numbers come from the two tools themselves (Claude Code's /usage and
  Codex's app server), so the app reads no sign-in secrets. In a browser build a stand-in
  answers: Claude Max, 5h 14% used resetting in 59m, Weekly 39% and Fable 29% used resetting
  in 1d 17h; Codex Pro, Weekly 4% used resetting in 6d 2h. ?usage=out puts Claude's 5h at 96% used;
  ?usage=signed-out signs both out.

  Names used below:
  - the usage button: button "Usage", one line above the sidebar's toolbar
  - the usage card: the popover it opens

  Scenario: At a glance
    Then the usage button shows "Claude 39%" and "Codex 4%" side by side, each over a bar half
      the row wide
    And each bar and percentage is the most used of that plan's limits
    And a bar is grey under 75% used, amber from 75%, red from 90%, and the percentage takes
      the same colour once it is amber or red
    When the sidebar is at its narrowest, 200 px
    Then the names, bars and percentages all stay whole

  Scenario: The details
    When I click the usage button
    Then the usage card opens beside it, with "Claude" and "Max" at the top
    And a row "5h 14% used" with "Resets in 59m", a bar 14% full, and a tick at what an even
      pace would have used by now (about 80%), so a bar short of its tick is under pace
    And under it "66% in reserve" and "Lasts until reset"
    And rows for Weekly and Fable the same way, then "Codex" and "Pro" with a Weekly row and
      "62,500 credits for use past the limits"
    And at the bottom when it was last checked, and a refresh button
    And while the card stays open, "Checked …" and the countdowns move on

  Scenario: Running out
    Given ?usage=out
    Then Claude's line reads "96%" in red over a red bar, the 5h row reads "96% used", its bar is red and past its tick,
      and under it a deficit and when it runs out at this pace, or "Limit reached" at 100%

  Scenario: Not signed in
    Given ?usage=signed-out
    Then the bars are empty and dimmed, with no percentage
    And the card says "Sign in with claude auth login to see usage." and "Sign in with codex
      login to see usage."

  Scenario: Kept fresh, but not too often
    Then the numbers are checked when the app opens, every 5 minutes while it is open, and when
      the card opens if the last check is over a minute old
    And a check that fails keeps the last numbers, with a line saying they couldn't be checked
