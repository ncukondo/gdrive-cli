# 0018: `share add` grants the shared-drive roles too

Date: 2026-07-27
Status: accepted — revises [0011](0011-sharing-commands.md)

## Context

`ShareRole` is `reader | commenter | writer` ([0011](0011-sharing-commands.md)).
Shared drives define two more: `fileOrganizer` (manage content, including trash
and move) and `organizer` (that, plus membership and drive settings). `share
list` already prints them correctly on a real drive — `DrivePermission.role` is
a plain string precisely so roles we do not grant still display — so the gap is
one-directional: this CLI can *see* an organizer and cannot *create* one
([issue #4]).

0011 listed "shared-drive-specific permission semantics" as out of scope, and at
the time that cost nothing: before v0.4.0 no Drive command could reach a
shared-drive file at all ([0016](0016-shared-drive-scope.md) §1). Now that every
command works by ID, promoting a member is the one sharing operation that still
requires leaving the CLI.

## Decision

### 1. `ShareRole` gains `organizer` and `fileOrganizer`

```
reader | commenter | writer | fileOrganizer | organizer
```

`--role` accepts them in `share add` with the same spelling the API uses —
`fileOrganizer`, camelCase — because that is the string `share list` prints and
`share list | share add` round-tripping should not need a translation table.
`owner` stays rejected: ownership transfer has its own constraints and is still
deferred by 0011.

### 2. `share link` keeps the original three

`share link` creates a `type: anyone` permission, and an anyone-with-link
*organizer* is not a thing Drive will make. Rather than let the flag through and
translate a 400, `share link --role organizer` is `INVALID_ARGS` naming the
three it takes. The two commands therefore parse `--role` against different
sets: `parseShareRole` (five) and `parseLinkRole` (three).

### 3. `--anyone` and the organizer roles are rejected locally; everything else
is Google's call

`share add --anyone --role organizer` is the same impossibility as §2 reached by
another route, and it is decidable without a round trip, so it is `INVALID_ARGS`
too.

The checks stop there. In particular this CLI does **not** pre-verify that the
target is somewhere `organizer` can be held. Knowing would cost a `files.get` on
every `share add` to read `driveId` — a round trip on the common path to improve
the error message on the rare one — and Google's own rejection is specific.

Observed against a real shared drive (task 0020's manual pass): granting
`organizer` on a *folder inside* a drive returns 403 `Organizer role is only
valid for shared drives.`, which this CLI reports as `PERMISSION_DENIED`
(exit 1) carrying that sentence. The role is drive-level only; the folder case
is the near-miss a user is most likely to try, and the message says so. Note
that the code is `PERMISSION_DENIED` rather than `API_ERROR` because Google
answers 403, not 400 ([0017](0017-permission-denied-error-code.md)) — the
operation cannot be performed and no credential change helps, which is what
that code means.

`--domain` is likewise left to the API. Whether a domain grant may hold an
organizer role depends on the drive's sharing settings, which is exactly the
kind of thing a local table gets wrong in the direction of blocking something
valid.

## Consequences

- `ShareRole` is a widening of an existing type, so `updatePermissionRole` and
  `share link`'s upgrade path accept the new values for free where they are
  legal.
- This is an input change under [0014](0014-pre-1.0-compatibility.md), but an
  additive one: every command line that worked before means the same thing.
  Only `share link --role organizer` becomes an error, and it was a 400 before.
- 0011's out-of-scope list keeps "capabilities" and "expiration times"; only the
  role vocabulary moves into scope. The `share` command surface is otherwise
  unchanged — no `--drive` flag, no membership subcommand. Adding a member to a
  shared drive is `share add <drive root ID> --to … --role organizer`, which
  works because a drive's root ID is a file ID
  ([0016](0016-shared-drive-scope.md) §3).
- `docs/commands.md` gains the roles in the `share add` table and one line
  saying the last two only exist on shared drives.

[issue #4]: https://github.com/ncukondo/gdrive-cli/issues/4
