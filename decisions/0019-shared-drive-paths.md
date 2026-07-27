# 0019: `drive:<name>/<path>` addresses a shared drive by path

Date: 2026-07-27
Status: accepted — revises [0016](0016-shared-drive-scope.md) §3

## Context

`resolvePath` walks segments down from the My Drive root, so every path argument
is a My Drive path and a shared-drive file can only be named by ID
([issue #5]). v0.4.0 made the ID route work everywhere and `gdrive drives`
exposes the names and root IDs, so nothing is *blocked* — but a path is what a
person reaches for, and

```console
$ gdrive ls "専門医部会/部門用フォルダ"
Error: No such file or folder: 専門医部会
```

is a wrong-looking answer to a reasonable question. The folder is right there in
the web UI.

0016 §3 deferred this for a reason that still holds: the hard part is not the
walk, it is that **a path has no room for the drive**. `Finance/2026/Budget`
could mean a My Drive folder named `Finance` or a shared drive named `Finance`,
and both can exist at once. Any fix has to introduce a way to say which.

## Decision

### 1. A `drive:` prefix names a shared drive

```
drive:<drive name>[/<segment>/…]
```

```console
gdrive ls    "drive:専門医部会/部門用フォルダ"
gdrive info  "drive:Finance/2026/Budget"
gdrive ls    "drive:Finance"                  # the drive's root
gdrive mv    1AbC… "drive:Finance/2026"       # a destination, like any other
```

Everything without the prefix keeps meaning exactly what it meant: a My Drive
path. This is additive — no existing argument changes meaning — and it lands in
every command at once, because they all resolve `<file>` through the single
injected `resolvePath` ([0013](0013-architecture.md)).

#### Why `drive:` and not `share:` or `//`

- `share:` collides twice. `gdrive share` is this CLI's permissions command, so
  the same word would mean two unrelated things; and in Drive's own vocabulary
  "shared" splits into *shared drives* and *shared with me* (the API's
  `sharedWithMe`), which are different corpora. Taking the name now would also
  take it from the second one.
- `//name/path` is terser but reads as a typo, and a mistyped `//` in a My Drive
  path currently just collapses — silence where an error belongs.
- `drive:` is already this CLI's word for the thing: `gdrive drives` lists them
  and `--drive <name>` scopes to one. The prefix is a third spelling of a
  vocabulary the user has met twice.

The cost is that a My Drive folder literally named `drive:Something` can no
longer be addressed by path. Its ID still works, and the name is implausible
enough to accept.

### 2. Name resolution reuses the `--drive` rules exactly

Exact, case-sensitive match against `drives.list`; no match → `NOT_FOUND`
listing the available names; several matches → `INVALID_ARGS` listing their IDs
([0016](0016-shared-drive-scope.md) §2). One shared helper serves both, so the
flag and the prefix cannot drift apart.

`drive:` with an empty name (`drive:` or `drive:/x`) is `INVALID_ARGS`.

A drive whose **name contains a `/`** cannot be addressed this way — the first
`/` ends the name. Such a drive is reachable by its root ID from `gdrive
drives`, and that is the documented answer rather than an escaping syntax
nobody would remember.

### 3. A failed first segment says so when a shared drive has that name

```console
$ gdrive ls "専門医部会/部門用フォルダ"
Error: No such file or folder: 専門医部会. A shared drive has that name — did
you mean "drive:専門医部会/部門用フォルダ"?
```

The lookup runs **only on the error path**, only for the first segment, and only
when the plain resolution already failed, so it costs nothing on success. If the
lookup itself fails (no permission to list drives, API down), the original
`NOT_FOUND` is what the user sees — a hint is never worth replacing the real
error with a different one.

### 4. `childrenNamed` includes shared-drive items

The walk inside a drive needs `includeItemsFromAllDrives: true` on the
`files.list` query, sent unconditionally, exactly as `listChildren` does and for
the same reason (0016 §2): the query already pins one parent, so it cannot widen
a result set — it can only stop returning nothing.

### 5. `ls --drive` and `search --drive` stay

`ls --drive Finance` and `ls drive:Finance` now mean the same thing. The flag
stays anyway: it is the sibling of `search --drive`, where it is *not*
redundant (it narrows the corpus of an open query, which no path can do), and
dropping it from one of the pair to save a synonym would cost more in surprise
than it saves in surface.

## Consequences

- `resolvePath` gains a `drives.list` round trip **only** for a `drive:`
  argument, plus one on the failed-first-segment hint path. A plain My Drive
  path is unchanged, call for call.
- `resolveDriveByName` is factored out of `resolveDriveScope` in `lib/api.ts`
  and imported by `lib/resolve-path.ts`. That is a new edge in the module graph
  ([0013](0013-architecture.md)): `resolve-path` already imported
  `escapeQueryValue` / `mapDriveError` / `normalizeFile` from `api`, so the
  direction is unchanged.
- 0016 §3's "path resolution stays My Drive–only" is superseded by this record;
  its second half (ID passthrough covering drive roots) still stands and is what
  makes `drive:<name>` with no segments trivially correct — it returns the root
  ID that `looksLikeId` already accepts.
- `docs/commands.md` gains the syntax in the addressing section and drops the
  "**Paths cannot reach a shared drive**" paragraph; `README.md`'s shared-drive
  bullet gains one line.
- Deliberately not done: a `drive:` form for *IDs* (`drive:0ANP…`). A raw ID
  already works everywhere; a second spelling of it would be noise.

[issue #5]: https://github.com/ncukondo/gdrive-cli/issues/5
