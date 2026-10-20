# Extensions in the browser: E1 parity backend

In the desktop app, the native commands in `src-tauri/src/leadinglight_extensions` implement the
frozen contract (`src/leadinglight/extensions/extensionApi.ts`,
`src/leadinglight/proposals/proposalContract.ts`). In the browser, one shared model gives the same
answers: `src/mock-tauri/mock-extensions.ts`. It runs over one of two hosts:

| Host | Where | What persists |
|---|---|---|
| In memory | The mock vault (`MEMORY_VAULT_ROOTS`), in any page without the dev vault server | Nothing; a reload starts over |
| On disk | `scripts/vault-api-extensions.ts` in the dev vault server, for synthetic fixture vaults only | Package files and preferences in a dev-only registry folder; created pages in the vault |

This is test infrastructure for browser checks and demos. It is not native authority, and passing
browser checks does not establish native behaviour, durability or window ownership. Root runs the
native tests separately.

## The shared model

The model uses the frozen TypeScript validator for every package and the native bounds from
`store.rs` and `runs.rs`. Its rules are native's:

- **Import.** Import stores a candidate and never activates it. A valid recipe the host cannot
  perform stays listed with its missing capabilities and cannot turn on. Ids starting
  `leadinglight.` are refused unless they come with the app.
- **Bundled package.** The bundled Meeting debrief is native's own file, read as exact bytes, so
  the browser and native compute the same hash. It is listed off until turned on in a vault.
- **Activation.** Activation and turning off compare and set per vault. Rolling back is activating
  the previous version. The version is checked again inside the store queue that publishes, so a
  version an import dropped meanwhile answers `unknownVersion` and nothing is written.
- **Transition order.** Activation and turning off take a transition queue, from compare-and-set
  through revoking and joining the replaced runs. Writes, admissions, ends and closes never wait on
  it.
- **Sessions.** A session belongs to its owner and one vault visit. Each id is fresh and never
  reused. An end is keyed by session and invocation and is kept as a tombstone. If the key table is
  full, the end seals the session instead. Live capacity is reserved while an admission checks its
  package. An admission that an activation change overtook answers `busy`. Close and end revoke,
  then join a write already admitted, then answer.
- **Operation ledger.** Each operation id keeps its owner, a digest of every create field, and its
  answer for the life of the backend, at most 1024 ids. After that, new ids answer `busy`, and no
  record is ever dropped. Replays answer the recorded result. Queries never write. `unknown` is never
  read as nothing written.
- **E1 limits.** Appending and binding documents answer `unsupported`. Never-sent reasons
  (`notDocument`, proposal `link`, a `changed` conflict) are not sent here either.

## Preferences and package files

The registry reader mirrors native `Store::checked`:

- format 1 with exact keys at every level;
- `1 ≤ nextSeq ≤ 2^53`, ahead of every import `seq` and vault `touched`;
- at most 64 imports, 8 per package and 64 vaults;
- each import has a hash, and an id, version and name that the frozen validator accepts in a package;
- no reserved imports, and hashes and seqs are unique;
- vault keys are non-empty, at most 4096 UTF-8 bytes, with no NUL;
- every active and previous entry names a stored import of that id or a shipped version;
- active differs from previous.

Exceptions and limits:

- **Stale bundled entries.** An entry for a bundled version this app no longer ships is dropped,
  which turns that package off. Anything else invalid, unreadable or over 4 MiB is set aside as
  `preferences.unreadable.json`. Everything then starts off, with stored versions found again from
  at most 256 package-folder entries.
- **Sequence numbers.** Every increment is checked and stops at 2^53.
- **Write bound.** Nothing over 4 MiB is published.

Publication has three outcomes:

| Outcome | What it means | What happens |
|---|---|---|
| `notPublished` | The change was refused before the rename | The state is unchanged |
| `unsynced` | Renamed in place, but the folder sync failed | The change is the state now, and replaced runs are revoked as usual. A warning is logged |
| `synced` | Renamed and synced | As for `unsynced`, without the warning |

Before any new package file, including the repair of a stored version whose file is missing or
damaged, reconciliation reads at most 256 entries. It removes `<sha>.json` files no stored version
names. It allows the write only when at most 64 remain, counting files whose removal failed. That
keeps the folder at 65 package files or fewer. Valid existing bytes are reused without a new file.

After a failed preference publication, only a file this attempt created is removed. Active,
previous and stored versions are never deleted. Unlisted files beyond the bounds are removed by
reconciliation, as native does.

## The dev server route

`/api/extensions/<command>` accepts only the commands in `EXTENSION_COMMANDS` and
`PROPOSAL_COMMANDS`. Requests must be `POST` with an `application/json` body of at most 8 MiB, in
the form `{ owner, args }`. `args` are the frozen invoke arguments, flat camelCase, with
`{ proposal }` for submit and `{ operationId }` for query.

| Status | Meaning |
|---|---|
| 200 | A contract reply |
| 400 | Malformed arguments, where native answers `Err` |
| 403 | Not an owner this route issued |
| 404 | Not an extension command |
| 405, 413, 415 | Wrong method, oversized request, not JSON |
| 500 | Unexpected failure |

The browser treats every non-200 answer as no reply.

**Owners.** Owners stand in for native windows:

- **Registration.** A page asks `/api/extensions/owner` for a fresh owner, and the route never
  accepts one it did not issue.
- **Leaving.** On `pagehide` the page sends `/api/extensions/owner-end`, which closes that owner's
  sessions without waiting, as native does for a reloaded window.
- **Bound.** At most 4 owners are live. Registering a fifth retires the oldest the same way.
- **Retired owners.** A retired owner may still close sessions, end runs and query operations,
  never start work. A reloaded page is a new owner and cannot query the old page's operations;
  `unknown` there proves nothing.

**Vaults.** Only vaults the browser listed through this server, by `list_vault`, are served. This
stands in for native's registered vault list. Requested paths must be absolute with no `..`, and
are resolved with `realpath`.

**Registry folder.** The default is `$TMPDIR/leadinglight-dev-extensions-<checkout hash>`.
`LEADINGLIGHT_DEV_EXTENSIONS_DIR` may name another disposable absolute folder. A folder inside
`~/.config`, `$XDG_CONFIG_HOME` or `~/Library/Application Support` is refused, so the app's own
configuration is never touched. Nothing is written there until the first import or activation.

**Fail-closed client.** In a page with the dev server marker, `src/mock-tauri/vault-api.ts` sends
every extension command to this route. A failed or missing server rejects the call. It never falls
back to the memory mock.

## Creating a page on disk

The core first refuses a bad name, a size over 1 MiB, or a digest mismatch. The disk host then
runs one synchronous step, so no other bridge write interleaves:

1. Recheck the bound folder by path and device/inode, with no link anywhere.
2. Answer `busy` if save recovery holds the page. This reuses `heldPathRefusal`, the existing page
   lease.
3. Answer `exists` if anything is at the name.
4. Stage in a sibling `.leadinglight-*` folder (Git-ignored, synced).
5. Recheck the folder.
6. Publish with a hard link, which never replaces a file, then remove the staged link.
7. Sync the folder.
8. Read back through one no-follow handle: check type, single link, identity and size before a read
   bounded to length + 1, then check the handle and path again.

What each failure answers:

| Situation | Answer |
|---|---|
| The folder is gone | `storageUnavailable` |
| The folder was replaced or linked | `handleMismatch` |
| A failed link call, staged file still ours, name free | `storageUnavailable`; nothing was written |
| A failed link call that put our file there | `committed`, after read-back |
| Anything else after publication: an extra link, changed bytes, an unclear failure | `uncertain`; staging files are kept |
| The folder sync failed | `committed` with `durable: false` |

Receipts give the path as the vault was requested.

## Differences from native, stated plainly

- **Publication primitive.** Node has no no-replace rename, so publication is a hard link followed
  by removing the staged link. Between the two, the page briefly has two links, and a failure to
  remove the staged link answers `uncertain`.
- **Path races.** Read-back is not handle-relative, as in native: a local process racing the path is
  caught, not excluded.
- **Durability.** Directory sync results are reported, but browser tests do not establish
  power-loss durability.
- **Memory host.** The mock vault has no sync, so its receipts say `durable: true`. A throwing
  mock-vault write answers `storageUnavailable`, since it changes nothing. Its folders exist
  while a page lives under them, and their identity is their path.
- **Number precision.** JSON numbers above 2^53 in a hand-edited preference file are rounded by
  JavaScript before they are checked. Files this backend writes never contain them.
- **Owner identity.** The owner is a server-issued token, not an authenticated window label.

## Backup

Package files and preferences live outside every vault. The current vault backup does not include
them, natively or here. The dev registry folder is disposable and can be removed at any time.
Created pages are ordinary notes and stay readable when an extension is turned off.

## Tests

- `pnpm exec vitest run src/mock-tauri/mock-extensions.test.ts src/mock-tauri/mock-extensions.seams.test.ts`
  covers:
  - the shared model: corpus, activation race, publication, preference reader, file bounds,
    sessions, admission, ordering, create, replay and ledger;
  - both browser seams.
- `node --experimental-strip-types --test scripts/vault-api-extensions.test.mjs` covers the disk host
  and route, against fresh temporary registries and synthetic vaults:
  - links and folders;
  - publication faults;
  - preference faults;
  - the 65-file bound;
  - restart;
  - owners, route statuses and the plugin seam.
