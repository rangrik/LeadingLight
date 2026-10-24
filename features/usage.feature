Feature: How much of each plan is used
  The bottom of the sidebar shows how much of your Claude and Codex plans is used, after
  synara's usage rings, and a click shows each limit with when it resets and whether, at this
  pace, it lasts. A bar or ring fills with what is spent, as a person reads a full bar. The numbers come from the two tools themselves (Claude Code's /usage and
  Codex's app server), so the app reads no sign-in secrets. In a browser build a stand-in
  answers: Claude Max, 5h 14% used resetting in 59m, Weekly 39% and Fable 29% used resetting
  in 1d 17h; Codex Pro, Weekly 4% used resetting in 6d 2h. ?usage=out puts Claude's 5h at 96% used;
  ?usage=signed-out signs both out.

  Names used below:
  - the usage button: button "Usage" at the bottom of the sidebar
  - the usage card: the popover it opens

  Scenario: At a glance
    Then the usage button shows a ring for Claude and one for Codex, each a 16 px ring with
      the weekly limit outside and the 5h one inside, filled by what is used, with its name and
      the most used of its limits ("Claude 39%", "Codex 4%")
    And a ring is green under 75% used, amber from 75%, red from 90%, and the percentage takes
      the same colour once it is amber or red
    And a plan with no 5h limit (Codex's) has only the outer ring
    When the sidebar is narrower than 256 px
    Then the names give way and the rings and percentages stay whole

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
    Then Claude's ring is red, the 5h row reads "96% used", its bar is red and past its tick,
      and under it a deficit and when it runs out at this pace, or "Limit reached" at 100%

  Scenario: Not signed in
    Given ?usage=signed-out
    Then the rings are empty and dimmed
    And the card says "Sign in with claude auth login to see usage." and "Sign in with codex
      login to see usage."

  Scenario: Kept fresh, but not too often
    Then the numbers are checked when the app opens, every 5 minutes while it is open, and when
      the card opens if the last check is over a minute old
    And a check that fails keeps the last numbers, with a line saying they couldn't be checked
