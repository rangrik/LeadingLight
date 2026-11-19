Feature: A local-first web app with optional accounts and sync
  Notes work without an account. Agents use the installed Mac app and the user's CLI accounts.

  Scenario: Account providers reflect the deployed configuration
    When I open "Account and sync"
    Then Settings opens on Account and devices and I can go back without an account
    And only configured Google, GitHub and ChatGPT providers can start sign-in
    And missing cloud configuration is explained without pretending to be signed in

  Scenario: A rejected sign-out keeps the account visible
    Given I am signed in
    When the sign-out request returns a server error
    Then my account stays visible and I can retry
    When a retry returns an authentication error redirect
    Then my account still stays visible
    And only a successful sign-out shows the sign-in buttons

  Scenario: Browser agents require an approved Mac connection
    Given I open LeadingLight in a browser without a paired Mac
    When I open Ask from the page, a text selection or its keyboard shortcut, or the Agents tab in account settings
    Then I see that agents run in the installed Mac app using my existing Claude Code or Codex sign-in
    And I am not asked for an API key or offered usage billing
    And no inline question composer opens in the browser
    And I can open the pairing flow to connect my Mac
    And I cannot submit or queue an agent task until that Mac approves and connects
    And notes, history and encrypted sync remain available

  Scenario: Old browser tasks cannot start paid provider work
    Given an older browser has a pending cloud writing task
    When it posts that task to the service
    Then the request is refused with the paired-Mac explanation
    And no job or note context is saved and no model provider is called
    And configured server API keys cannot enable cloud agents

  Scenario: Installed agents keep their existing execution path
    Given I use the installed Mac app with a signed-in Claude Code or Codex CLI
    When I ask an agent to work
    Then the app uses its existing local agent runtime and project isolation
    And my account's own provider usage applies
    And Google or GitHub workspace sign-in does not replace the CLI sign-in

  Scenario: Notes remain usable offline on a phone
    Given I opened the web app in Safari and saved a note
    When the network disconnects and I reopen the cached app
    Then I can read and edit my local notes
    And encrypted sync waits for a connection

  Scenario: Phone and iPad navigation is usable by touch
    When I open the app at phone or iPad width
    Then I can create and edit a page, open history, inspect authorship and open account settings
    And dialogs, the editor and navigation stay within the viewport
    And no native iPhone or iPad app is required

  Scenario: Large history does not block other pages
    Given a page with an image-sized body and another small page
    When I enable encrypted sync
    Then large encrypted history is uploaded and downloaded in bounded parts
    And the small page reaches another device too
    And an unsupported file names the affected page without stopping other uploads

  Scenario: Pausing sync keeps the recovery key
    Given this device has connected with a recovery key
    When I pause sync
    Then the device keeps its notes and recovery key
    And resuming uses the same key
    And when sync reports that the key does not match, Account and devices takes the right one

  Scenario: A signed-out device still shows its recovery key
    Given this device synced notes with a recovery key
    And its sign-in has ended, or I signed out
    When I open Account and devices
    Then Recovery key, Show… shows the same key as before, with Copy
    When I start signing in again and a browser without the key asks for it
    And I paste that key and press Connect this device
    Then I read "Device approved"
    And after signing in Account and devices reads "Up to date" with the same notes

  Scenario: Starting offline does not tell a signed-in device to sign in
    Given this device synced notes and its sign-in is still good
    When the app starts with no network and I open Account and devices
    Then I read "You’re offline. Your local notes still work; cloud will reconnect when the network returns."
    And I see the account this device uses, and no sign-in buttons
    And Recovery key, Show… still shows the key

  Scenario: A device that never synced has no key to show
    Given this device has no recovery key and no sign-in
    When I open Account and devices
    Then there is no Recovery key part
    And I am offered sign-in, with my local notes still available

  Scenario: Another account does not see this device's key
    Given this device synced notes as one account and that sign-in ended
    When I sign in as a different account and open Account and devices
    Then there is no Recovery key part

  Scenario: Cloud access is private by default
    Given the service has not enabled my account
    When I sign in
    Then my local notes still work
    And sync writes are refused until my account is enabled

  Scenario: A recovery-key mistake cannot erase the working key
    Given this device has synced notes with a saved recovery key
    When I enter a different key or the service fails during verification
    Then the existing key stays saved
    And a new device must verify its key before syncing

  Scenario: A full library can use the space taken by attachment transfer encoding
    Given an older Mac uploaded encrypted attachment parts as text
    And that text filled the library's 500 MB sync allowance
    When the service stores those parts as their original encrypted bytes
    Then the same signed-in devices receive byte-for-byte identical parts at the same IDs
    And the next sync delivers both the pending page and its collection with their history
    And a device from another account still cannot read the parts
    And retrying an already saved multi-part event sends no new parts, even if the library fills again
    And a signed-in Mac, iPhone, or iPad can check the saved event by ID before sending its parts again
    And a new event that exceeds the remaining space stays queued on the device
