# 0016: Shared drives — IDs always work, `search` scope is opt-in

Date: 2026-07-27
Status: accepted (revised 2026-07-27 after review; see "Revision" below)

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

All of `files.list` / `get` / `create` / `copy` / `update` / `delete` and
`permissions.list` / `create` / `update` / `delete` send it, at all 14 call
sites that accept it — the 13 in `src/lib/api.ts` plus the lookup query in
`src/lib/resolve-path.ts`, which the issue's table missed by counting only one
file.

`files.export` is the one exception, and one the issue did not anticipate:
Drive v3 defines no `supportsAllDrives` parameter for it, and
`GeneratedParamChecks` says so at compile time. Export works on shared-drive
files without it.

Otherwise the parameter is a capability declaration — "this client understands
shared-drive semantics" — not a scope widener: for an ID-addressed request it
only ever turns a spurious `NOT_FOUND` into the correct answer. Google's own
guidance is to set it on every request.

Consequence: any command given a shared-drive file **ID** now behaves exactly as
it does for a My Drive file. No flag, no configuration.

### 2. `search` keeps the My Drive default; `ls` follows the folder it is given

The two commands look alike and are not. **`search` asks Drive an open
question** — "what matches `budget`?" — and the corpus it asks over is exactly
what the default is about. **`ls` always pins one parent** (`'<id>' in
parents`), so its corpus is closed before `corpora` is consulted: no widening
can add a file that is not a child of the folder the user named.

That difference decides where the gate goes:

| Call | `includeItemsFromAllDrives` | `corpora` |
| ---- | --------------------------- | --------- |
| `listChildren` (`ls`) | **always** | only with `--drive` |
| `searchFiles` (`search`) | only with a flag | only with a flag |

`ls` sends `includeItemsFromAllDrives` unconditionally because withholding it
does not protect anyone from noise — it only makes `ls <shared-drive folder ID>`
print nothing and exit 0, which is a wrong answer, not a narrower one.

`search` keeps the gate:

| Flag | `corpora` | Other params |
| ---- | --------- | ------------ |
| *(none)* | *(unset → `user`)* | — |
| `--all-drives` | `allDrives` | `includeItemsFromAllDrives: true` |
| `--drive <name>` | `drive` | `driveId`, `includeItemsFromAllDrives: true` |

Passing both is `INVALID_ARGS`. `--drive` resolves a drive *name* to a
`driveId` via `drives.list`, reusing the error rules path resolution already
established (`decisions/0008`): no match → `NOT_FOUND` (listing the names that
do exist), several matches → `INVALID_ARGS` listing the candidate IDs.

`ls` takes `--drive <name>` too, where it means "start at that drive's root" —
a shared drive's ID doubles as its root folder ID. Because that names the
starting folder, `--drive` **and** a folder argument together are
`INVALID_ARGS`: a folder inside a shared drive is addressed by its ID alone.
`ls` does **not** take `--all-drives`; with a folder argument it would be the
error just described, and without one it left the query at `'root' in parents`,
making it a flag that could not change a single byte of output.

### 2b. `gdrive drives` — the names `--drive` needs

`--drive` matches a drive name exactly and case-sensitively, and nothing else
in the CLI reported those names. `gdrive drives` lists name and ID, using the
same output contract as every other list (`data.drives[]` in JSON, one ID per
line in quiet mode). Its ID column is also the value `--parent`, `mv`, and `cp`
need to put a file at the top level of a shared drive, which works now that
`looksLikeId` accepts the 19-character root-ID shape.

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

For the same reason `includeItemsFromAllDrives` is flag-gated **in `search`**.
Google requires it to be paired with `supportsAllDrives`, but the pairing
requirement runs one way: `supportsAllDrives` alone is inert for listing, while
`includeItemsFromAllDrives` alone is what pulls shared-drive items into the
result set. Sending it unconditionally from `search` would be the default
change through the back door. Sending it from `ls` is not, per §2.

### 3. Path resolution stays My Drive–only, but ID passthrough covers drive roots

> **Superseded by [0019](0019-shared-drive-paths.md)** (2026-07-27), which adds
> the `drive:<name>/<path>` syntax this paragraph called for. The rest of §3 —
> ID passthrough and the `looksLikeId` shape — still stands, and is what makes
> `drive:<name>` with no segments resolve to a usable root ID.

`src/lib/resolve-path.ts` walks segments from the My Drive root, so a path like
`専門医部会/部門用フォルダ/…` still cannot name a shared-drive file. Supporting it
needs a syntax for "the root of drive X" and a drive-name lookup per segment
walk — a user-visible addressing change that deserves its own decision. Until
then the documented answer is: **address shared-drive files by ID.**

For that answer to hold, every ID the CLI *prints* has to be an ID it accepts.
A shared drive's root ID is `0A` + 17 characters — 19 in all, one short of the
20-character threshold `looksLikeId` used — and `info` reports it in `parents`.
Feeding our own output back in therefore failed, and nothing could be created
at the top level of a shared drive. `looksLikeId` now also accepts that exact
shape. Lowering the general threshold to 19 would have done the same job while
letting any 19-character slash-free folder name be mistaken for an ID; matching
`0A` + 17 specifically keeps the false-positive surface where it was.

## Consequences

- `docs/commands.md` and `README.md` gain the flags, the `drives` command, and
  one sentence of shared-drive guidance: IDs work everywhere, paths do not.
- `ListParams` grows `corpora` / `driveId` / `includeItemsFromAllDrives` /
  `supportsAllDrives`, and `DriveClient` grows a `drives.list` method. Both are
  checked against the generated `drive_v3.Params$Resource$…` types by
  `GeneratedParamChecks` (`decisions/0015`) — no assertions.
- `--drive <name>` costs one extra `drives.list` round trip before the listing
  call. Acceptable: it only fires when the flag is given, and the alternative —
  making the flag take a raw `driveId` — asks for a value users do not have to
  hand, unlike a file ID which they can read off a URL.
- `gdrive drives` is registered by `registerDriveRead` rather than its own area:
  it is a Drive read command over the same client, so it needs no new entry in
  `src/commands/index.ts` (`decisions/0013`). `SharedDrive` sits in
  `src/types/index.ts` with the other domain types.
- `ls` now lists shared-drive children by default. That is a behavior change to
  an existing command under `decisions/0014`, but only in the direction of
  answering a question that previously returned nothing.
- The follow-up is path resolution across shared drives; it is tracked on
  [issue #1] rather than in this record.

## Revision (2026-07-27, after review)

The first version of this record gated `includeItemsFromAllDrives` behind the
flags for *both* list calls, and gave `ls` an `--all-drives` flag. Review found
that this broke §1's own promise in two places, each of which surfaced as a
wrong success rather than an error:

- `ls <shared-drive folder ID>` printed nothing and exited 0.
- `gdrive info <id>` printed a shared drive's root ID in `parents`, and passing
  that ID back to any command failed.

§2 and §3 above are the corrected text; task 0018 carries the change. The
lesson worth keeping is that "IDs work everywhere" is a claim about the whole
surface, and a scope default chosen for `search` was applied to `ls` without
checking whether the reason transferred. It did not.

[issue #1]: https://github.com/ncukondo/gdrive-cli/issues/1
