# Runtime browser test on macOS — 3 November 2026

The runtime's real-browser tests run Chromium with a test-owned profile and a
worktree-scoped proxy. With an isolated `HOME`, the installed Playwright cache
under the user's normal home is not discovered by `FindChromium`; it falls back
to `/Applications/Google Chrome.app` on this machine.

With Chrome 156.0.8078.74, `TestAgentBrowserDrivesARealChromium` timed out in
`Page.navigate` after 60 seconds. Chrome emitted a request event but did not
send the page request to the proxy. During the stall, a request through that
same proxy returned the fixture page with HTTP 200. The Playwright 1248
headless shell passed the test in 9.14 seconds with the same isolated home,
proxy and sandbox settings. Playwright's public `chromium.executablePath()`
selected the full Chrome for Testing 156.0.8078.4, which also timed out after
60 seconds in the same test. It is not the headless-shell executable.

A diagnostic wrapper adding only `--use-mock-keychain` to Chrome, using the
test's temporary profile, passed the same test in 4.48 seconds. This is strong
evidence of a keychain-related stall in this environment; it does not identify
the particular prompt or keychain state. Chromium's [key provider](https://github.com/chromium/chromium/blob/156.0.8078.74/components/os_crypt/async/browser/keychain_key_provider.mm#L34-L44)
uses a mock keychain when that switch is set. Its [fake keychain](https://github.com/chromium/chromium/blob/156.0.8078.74/crypto/apple/fake_keychain_v2.mm)
uses a fixed mock password. Do not add that switch to production or persistent
profiles: it changes credential encryption.

`pnpm runtime:test` now resolves the installed Playwright browser before
isolating the test home. On macOS, its temporary wrapper uses the mock keychain
only for the test suite's disposable profiles. The wrapper and test data are
removed afterward; production launch arguments are unchanged. Set
`BERTH_CHROMIUM` to choose another installed test binary, including the
Playwright headless shell. The default command passed the real-browser check
in 4.90 seconds.
