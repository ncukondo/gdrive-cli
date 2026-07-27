# 0016: Shared drives — IDs always work, `ls`/`search` scope is opt-in

Date: 2026-07-27
Status: accepted

## Context

Every Drive API call site in `src/lib/api.ts` omitted `supportsAllDrives`, so
Drive v3 scoped each request to My Drive and **no command that goes through the
Drive API could see a file on a shared drive** ([issue #1]). `info`, `ls`,
`search`, `download`, `upload`, `mv`, `cp`, `rm`, and `share` all returned
`NOT_FOUND` for such a file. `docs` and `sheets` were unaffected — the Docs and
Sheets APIs have no shared-drive flag — which is why the gap went unnoticed:
reading and *editing* a shared-drive Doc by ID worked fine.

Fixing the ID-addressed half is uncontroversial: a file ID is unambiguous, and a
command that accepts an ID should not care which drive the file happens to live
on. This is the repo's stated design target — an agent handed a Drive URL
extracts the ID and expects every command to take it (`decisions/0008`).

The half that needs a decision is the **scope of `ls` and `search`**, because
those take no ID: they ask Drive "what is out there?". Drive v3 answers that
through `corpora`, which defaults to `user` (My Drive plus files the user has
opened). Widening it to `allDrives` is a behavior change for every existing
invocation, not a bug fix.

## Decision

### 1. `supportsAllDrives: true` on every Drive API call, unconditionally

All of `files.list` / `get` / `create` / `copy` / `update` / `delete` /
`export` and `permissions.list` / `create` / `update` / `delete` send it. It is
a capability declaration — "this client understands shared-drive semantics" —
not a scope widener: for an ID-addressed request it only ever turns a spurious
`NOT_FOUND` into the correct answer. Google's own guidance is to set it on
every request.

Consequence: any command given a shared-drive file **ID** now behaves exactly as
it does for a My Drive file. No flag, no configuration.

### 2. `ls` / `search` keep the My Drive default; scope widens only on request

`corpora` stays unset (Drive's `user` default), and `includeItemsFromAllDrives`
is sent **only** when the user asks for a wider scope:

| Flag | `corpora` | Other params |
| ---- | --------- | ------------ |
| *(none)* | *(unset → `user`)* | — |
| `--all-drives` | `allDrives` | `includeItemsFromAllDrives: true` |
| `--drive <name>` | `drive` | `driveId`, `includeItemsFromAllDrives: true` |

Passing both is `INVALID_ARGS`. `--drive` resolves a drive *name* to a
`driveId` via `drives.list`, reusing the error rules path resolution already
established (`decisions/0008`): no match → `NOT_FOUND`, several matches →
`INVALID_ARGS` listing the candidate IDs.

#### Why not make `allDrives` the default

`decisions/0014` would permit the break — we are pre-1.0 with no known user —
so the reason is not compatibility law but the two costs the break would buy:

- **It silently changes what existing commands return.** `gdrive ls` and
  `gdrive search budget` are the two commands a user runs most often and reads
  fastest. Changing their result set without changing their spelling is the kind
  of break that is discovered as a wrong answer, not as an error.
- **Shared drives are mostly noise for the person who asked.** An account with
  organizational shared drives attached can carry tens of thousands of files it
  has technical access to and no interest in. `search` in particular degrades
  from "my files" to "everything my employer owns", and the useful hit moves
  below the `--limit` cut. The default should answer the question the user
  usually means.

The inverse cost — a user with a shared drive has to type `--all-drives` — is
paid once, visibly, with a flag that says what it does. That is the better
failure mode: an explicit widening beats a silent one.

For the same reason `includeItemsFromAllDrives` is flag-gated rather than always
on. Google requires it to be paired with `supportsAllDrives`, but the pairing
requirement runs one way: `supportsAllDrives` alone is inert for listing, while
`includeItemsFromAllDrives` alone is what pulls shared-drive items into the
result set. Sending it unconditionally would be the default change through the
back door.

### 3. Path resolution stays My Drive–only

`src/lib/resolve-path.ts` walks segments from the My Drive root, so a path like
`専門医部会/部門用フォルダ/…` still cannot name a shared-drive file. Supporting it
needs a syntax for "the root of drive X" and a drive-name lookup per segment
walk — a user-visible addressing change that deserves its own decision. Until
then the documented answer is: **address shared-drive files by ID.**

## Consequences

- `docs/commands.md` and `README.md` gain the two flags and one sentence of
  shared-drive guidance: IDs work everywhere, paths do not.
- `ListParams` grows `corpora` / `driveId` / `includeItemsFromAllDrives` /
  `supportsAllDrives`, and `DriveClient` grows a `drives.list` method. Both are
  checked against the generated `drive_v3.Params$Resource$…` types by
  `GeneratedParamChecks` (`decisions/0015`) — no assertions.
- `--drive <name>` costs one extra `drives.list` round trip before the listing
  call. Acceptable: it only fires when the flag is given, and the alternative —
  making the flag take a raw `driveId` — asks for a value users do not have to
  hand, unlike a file ID which they can read off a URL.
- The follow-up is path resolution across shared drives; it is tracked on
  [issue #1] rather than in this record.

[issue #1]: https://github.com/ncukondo/gdrive-cli/issues/1
