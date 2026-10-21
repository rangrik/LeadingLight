# Website capture: the native fetch

Website capture saves one public web page as Markdown, only when the person types an address and
asks for it. This page covers the native half: how that one page is fetched, bounded, decoded and
cancelled. Turning the page into Markdown happens in the webview and is described separately.

The code is in `src-tauri/src/leadinglight_web_capture/`:

- `wire.rs`: request and reply shapes;
- `address.rs`: which URLs and addresses may be reached;
- `fetch.rs`: one attempt, from lookup to decoded text;
- `decode.rs`: bytes to text;
- `service.rs`: one attempt per window, its reservation at dispatch, and cancellation.

The app reaches it through two commands, `web_capture_fetch` and `web_capture_cancel`
(`src-tauri/src/commands/web_capture.rs`); the fetch is served as Tauri dispatches it. [website-native-integration.md](website-native-integration.md)
covers that integration: the commands, the window hooks, the extension vocabulary and the
capability guard. `src-tauri/tests/web_capture_leaf.rs` also compiles the module on its own and
runs its tests, including the one test that changes process-wide proxy variables.

## What a fetch takes, and what it never takes

A fetch takes an attempt id and a URL, plus the calling window, which the command reads from Tauri.
No note, vault path, provider, package or run identity reaches it.

Every request carries exactly these headers:

```text
Host: <the URL's host>
Accept: text/html,application/xhtml+xml
Accept-Encoding: identity
User-Agent: LeadingLight/<version>
```

Nothing else is sent: no cookies, `Authorization`, `Referer`, `Proxy-Authorization` or
`Accept-Language`. The method is always GET, with no body. There is no cookie store, cache, retry,
background fetch, JavaScript, subresource or image request.

The HTTP client is reqwest 0.12, configured explicitly:

- rustls with its bundled WebPKI roots (not the operating system's trust store);
- no proxy, including environment and system proxies, because a proxy would bypass address pinning;
- redirects followed by hand, never by the client;
- no decompression;
- HTTP/1.1, and no idle connections kept.

A new client is built for each hop and dropped when the attempt ends.

## Which addresses may be reached

The URL must be `http` or `https`, at most 2048 bytes before and after parsing, with no user name
or password. The fragment is removed. The host is read after WHATWG URL parsing, so decimal, hex
and octal IPv4 spellings such as `http://2130706433/` are already `127.0.0.1` when they are checked.

These are refused before any lookup:

- the names `localhost` and `local`, and any name under `.localhost` or `.local`, with or without a
  trailing dot;
- any address literal that is not public.

An IPv4 address is public unless it is in one of these blocks:

| Block | Use |
|---|---|
| `0.0.0.0/8` | this network |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | private |
| `100.64.0.0/10` | shared address space (CGNAT) |
| `127.0.0.0/8` | loopback |
| `169.254.0.0/16` | link-local, including cloud metadata |
| `192.0.0.0/24` | IETF protocol assignments |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | documentation |
| `192.88.99.0/24` | deprecated 6to4 relay |
| `198.18.0.0/15` | benchmarking |
| `224.0.0.0/3` | multicast, reserved and broadcast |

An IPv6 address is public only inside `2000::/3`, and outside `2001::/23`, `2001:db8::/32`,
`2002::/16` and `3fff::/20`.

Two kinds of IPv6 address reach an IPv4 host, so they are judged by that host:

- IPv4-mapped (`::ffff:a.b.c.d`);
- NAT64 (`64:ff9b::/96`), so that IPv6-only networks still work.

Every other IPv6 address is refused, including loopback, link-local, unique local, multicast, the
deprecated IPv4-compatible form and the local-use NAT64 prefix `64:ff9b:1::/48`.

**Looking up a name.** Each hop asks the operating system resolver, under its own timeout.

- **Every** answer must be public. If one is not, the hop is refused before any connection, even
  when the other answers are public. A hosts-file entry or VPN resolver that answers with a private
  address is therefore refused.
- The checked answers are then **pinned**: the client's resolver for that hop returns exactly
  those addresses for exactly that name, and refuses any other name.
- The URL keeps its host name, so `Host` and the TLS server name stay the name while the
  connection goes to a checked address.

## Redirects

Only 301, 302, 303, 307 and 308 are followed, at most five times. Each target must have a
readable `Location`, and is resolved against the current URL. It is then checked by every rule
above and looked up again. A redirect from `https` to `http` is refused. The final URL is reported
with the page.

## Responses

Only status 200 is read. Other statuses map to fixed reasons:

| Status | Reason |
|---|---|
| 401, 402, 403, 451 | `accessDenied` (sign-in, paywall or bot protection; which one is not guessed) |
| 404, 410 | `notFound` |
| 429 | `rateLimited` |
| 5xx | `serverError` |
| anything else | `unexpectedStatus` |

**Content.** `Content-Type` must be `text/html` or `application/xhtml+xml`. When it is present, it
is checked before the body is read. When it is missing, the page counts as HTML only if its first
512 bytes start with `<!doctype html` or `<html`.

A `Content-Encoding` other than `identity` is refused as `compressedResponse`, as is a
`Transfer-Encoding` other than `chunked` or `identity`. This client never decompresses, so a
server that ignores `Accept-Encoding: identity` is refused, not guessed at.

**Errors.** Replies carry only fixed reason codes. Server text, error messages, header values and
addresses are never returned. This module logs nothing, and in particular never a URL, since a
query string can hold a token.

## Limits

| Bound | Value |
|---|---|
| URL length, as typed and after parsing | 2048 bytes |
| Lookup, per hop | 5 s |
| Connect, per hop, including the TLS handshake | 5 s |
| Idle read: to the response head, then between body reads | 10 s |
| Whole attempt: every hop, lookup and body read | 30 s |
| Redirects | 5 |
| Body | 5 MiB, checked against `Content-Length` before reading and against the bytes read |
| Decoded text | 5 MiB of UTF-8 |
| Attempts per window | 1 |

A body over its limit is refused one read past the limit, and its connection is closed.

## Text encoding

The decoder follows one fixed order, and reports which step decided:

1. **`bom`:** a UTF-8, UTF-16LE or UTF-16BE byte order mark.
2. **`header`:** the `Content-Type` charset, if its label is in the WHATWG label table. An unknown
   label is ignored.
3. **`meta`:** the WHATWG `<meta>` prescan of the first 1024 bytes. Here UTF-16 becomes UTF-8 and
   x-user-defined becomes windows-1252, as in browsers.
4. **`detected`:** nothing usable was declared, and every byte is valid UTF-8.
5. **`fallback`:** none of the above, so windows-1252. This step is a guess. Windows-1252 maps every
   byte, so a wrong guess shows as wrong characters, not as replacements.

The reply also reports `hadReplacements` when bytes were invalid in the chosen encoding and became
U+FFFD. A label that selects the WHATWG "replacement" encoding (for example `iso-2022-kr`) is
refused as `unsupportedCharset`, rather than turning the page into a single replacement character.

This is a documented algorithm, not full browser parity. It does not use:

- XML declarations;
- a `<meta>` found after the first 1024 bytes;
- locale-dependent defaults;
- statistical detection beyond the UTF-8 check.

## Attempts and cancellation

The calling window's label is the owner. Each window has at most one attempt, reserved or running.

- **Reserved at dispatch.** `reserve` runs while Tauri dispatches the fetch request, before any
  task exists. It gives that dispatch a fresh ticket, which no other dispatch ever gets, and the
  reservation moves into that request's own task. When the task first runs, it starts only if its
  own ticket still holds the window. Otherwise it replies `cancelled` with no lookup and no
  connection. No task can take another dispatch's reservation, even one with the same attempt id.
- **A new fetch supersedes.** The window's current attempt, reserved or running and whatever its
  id, is cancelled: its call replies `cancelled`, and its connection, if any, closes.
- **Cancel must match to stop.** It stops an attempt, and replies `cancelled`, only when both the
  window and the attempt id match. Anything else replies `notActive`.
- **Stopped ids stay stopped for the page.** Tauri can dispatch a fetch after its cancel was
  answered, because each request is its own asynchronous `fetch` and the bridge sends the same
  message again through `postMessage` when a reply fails. So for its current page, each window
  remembers every id a cancel named and every id a newer fetch replaced. A fetch dispatched with one
  of them replies `cancelled` at once: it reserves nothing and leaves the current attempt alone.
- **Bounded, never evicted.** The record holds at most 1,024 ids, and no id is dropped to make
  room. Once it is full, the window is sealed: each further fetch call fails, and the dialog shows
  website fetch as unavailable, until the window's page loads again or the window closes.
- **One lock decides.** Completion and cancellation take the same lock. A result is delivered only
  if its attempt is still its window's current one when it finishes, so a late result can never
  replace a newer attempt or reopen a cancelled one. A cancel that loses that race replies
  `notActive`; the fetch reply is then the result.
- **Window reload or close.** `forget_owner` runs on page-load `Started` and window `Destroyed`. It
  cancels the window's attempt, reserved or running, and drops the window's record with its page.
- **What is kept.** There is one entry per window that has an attempt or stopped ids. An attempt is
  removed when it finishes, is cancelled or superseded, or its task is dropped. A task can release
  only its own ticket. Attempts that finish are not recorded.

**Limits.**

- **A replaced page's request after the reload.** A request from a replaced page that is
  dispatched after the new page's load started cannot be told apart natively from the new page's,
  because the old page's record went with it. It can run once, and its reply has no receiver.
- **A failed reply sent again.** If an attempt was not cancelled and its reply failed, the bridge
  may send the request again, and it is fetched again.

## How it is tested

All tests are synthetic and offline. They make no external requests and use no personal data.

- **Pure tests** cover:
  - the IPv4 and IPv6 address policy, including mapped, NAT64, 6to4, Teredo and both documentation
    blocks;
  - URL refusals and normalization (alternative IPv4 spellings, IDN, percent-encoding, fragments,
    over-long URLs);
  - every redirect refusal, including `https` to `http`;
  - the decoder order;
  - the `<meta>` prescan steps;
  - `Content-Type` parsing and the missing-type sniff;
  - the wire shapes and the closed list of reasons.
- **Real-connection tests** drive the real reqwest client to a loopback HTTP/1.1 server that writes
  raw bytes. It runs only in test builds and is reached through a loopback-allowing address policy
  that exists only under `cfg(test)`. A table resolver answers `.test` names, which the system
  resolver never resolves, so reaching the server proves the connection used the checked answer.
  These tests cover:
  - the exact request headers, and the `Host` kept through pinning;
  - refusal before any connection when any answer is not public;
  - each redirect hop checked and looked up again, with no cookie or `Referer` carried over;
  - the five-redirect limit;
  - status and content refusals, with no server text in replies and no retries;
  - the body and decoded-text limits, and the connection closing at the body limit;
  - the lookup, connect, idle and whole-attempt timeouts;
  - the TLS server name being the host, not the pinned address;
  - a failed handshake reported as `tlsFailed`;
  - cancellation, supersession, window ownership and dropped calls;
  - with each task held before it first runs:
    - a cancel, page load or window close, and a newer request;
    - a repeated id with another URL, whose late older task must not fetch;
    - a fetch dispatched after its cancel was answered, and one sent again after it;
    - a window reused under the same label;
    - the full record.

    Each of these counts lookups at the resolver and connections at the server, and the next
    legitimate request is then fetched.
- **The production policy** refuses a loopback server that is listening, both from the production
  constructor and with a resolver that answers loopback, mapped or NAT64 loopback addresses.
- **Proxy variables.** `tests/web_capture_leaf.rs` sets the proxy environment variables to a second
  loopback server and checks that the page is still fetched directly. It lives in its own test
  binary because those variables are process-wide.

## Not qualified here

- **No real website or public address** is fetched by any test.
- **TLS.** No successful TLS session, certificate validation against the bundled roots, or
  certificate error from a real server is exercised. TLS coverage is a handshake that stalls
  (connect timeout), a server that answers it with plain HTTP (`tlsFailed`), and the server name the
  client sends.
- **TCP connect timeout.** The timeout is exercised only through a stalled TLS handshake, which the
  same bound covers. A TCP SYN that is never answered is not reproduced locally.
- **Lookups.** IPv6 connections and real operating-system lookups are not exercised. Lookups
  through the system resolver are only reached by the production constructor, and only with
  addresses that are refused before any lookup.
- **Real-world variety.** Extraction quality and how real servers treat an honest User-Agent and
  `Accept-Encoding: identity` are unmeasured.
- **Integration.** The fetch's dispatch (`dispatch_web_capture_fetch`), the cancel command and the
  window hooks are covered by build and lint checks. Their tests cover only the fetch's argument
  reader and that the commands are not on the disabled list. The service they call is tested as
  above. No native window has been used to exercise them, and no test reproduces Tauri's bridge
  sending a message again.
