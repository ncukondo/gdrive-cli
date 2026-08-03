# 0025: Shortcuts resolve by the role of the argument

Date: 2026-08-03
Status: accepted

## Context

A Drive shortcut (`application/vnd.google-apps.shortcut`) is a pointer: a real
file with its own id, name and parents, whose `shortcutDetails.targetId` names
the file it stands for. Shortcuts are how a user files someone else's document
into their own folder tree, so they sit exactly where a path walk expects a
folder or a document.

The CLI has never known the word. Three things follow.

**Paths through a shortcut always fail.** `resolvePath` walks segment by segment
with `'<id>' in parents`, and a shortcut has no children, so
`Reports/link-to-2026/summary` is `NOT_FOUND` even though the same path opens in
the Drive UI. That is a bug, not a missing feature.

**A shortcut reports as a plain file.** `MIME_TYPE_MAP` has no entry for it, so
`ls` and `info` print `type: file`, `size: null` — the same as a Doc, with no
sign that a target exists. `FILE_FIELDS` does not request `shortcutDetails`, so
the target id never arrives.

**Content commands misfire silently.** `download <shortcut>` exports the pointer
rather than the file; `docs read <shortcut>` sends the shortcut id to the Docs
API, which answers 404 for a document that plainly exists.

What makes this more than a one-line fix is that "follow the shortcut" is right
for some arguments and destructive for others. `rm` following one would trash
the target and leave the dangling pointer behind — the user asked to delete a
link and lost a document.

## Decision

### 1. Following is a property of the argument's role, not of the command

Every file-taking argument plays one of three roles, and the role decides:

| Role | Follows | Arguments |
|------|---------|-----------|
| **Container** — "look inside this" | always | every intermediate path segment; `ls [folder]`; `--parent` on `mkdir`, `upload`, `docs create`, `sheets create`; the destination of `mv` and `cp` |
| **Content** — "read or edit what is in this" | yes | `download <file>`; `docs read/append/insert/replace`; `sheets tabs/read/write/append/clear` |
| **Entry** — "this file, as an entry in a folder" | never | `rm`; `mv <file>`; `cp <file>`; `share list/add/remove/link`; `info` |

This is POSIX symlink behavior, and it is chosen for the same reason: `cat link`
should read the target, `rm link` should not delete it. The two arguments of
`mv link Other/` play different roles in the same command — the source is an
entry, the destination a container — which is why the rule attaches to the
argument rather than to the command.

`share` sits with the entries deliberately. A shortcut carries its own ACL, and
a `share add` that quietly widened access to the target instead would be the
most expensive surprise in the set: the user cannot see it in the output, and it
grants a stranger a document rather than a pointer.

`info` also stays put, because `info` is the command an agent runs to answer
*what is this id* ([0020](0020-drive-root-name.md) made the same argument for a
drive root's name). Following would make it the one command that cannot report a
shortcut at all.

### 2. The file object carries the target

`FileType` gains `shortcut`, and `DriveFile` gains two fields, `null` on every
non-shortcut:

```json
{ "id": "1Lnk…", "name": "2026 Budget", "type": "shortcut",
  "mime_type": "application/vnd.google-apps.shortcut", "size": null,
  "target_id": "1AbC…", "target_type": "sheet" }
```

`FILE_FIELDS` gains `shortcutDetails(targetId,targetMimeType)`, and
`target_type` runs `targetMimeType` through the same `mimeToType` map as `type`.
Two fields rather than a nested object, and no `target_mime_type`: the pair a
caller acts on is *what it points at* and *what kind of thing that is*, and
`gdrive info <target_id>` answers everything else.

This is what makes the non-following commands honest rather than merely safe. An
agent that wants the target from an entry command can see it and ask for it.

### 3. `resolveTarget` is a second entry point, not a flag

`lib/resolve-path.ts` exports both:

- `resolvePath(client, arg): Promise<string>` — unchanged signature, used by
  container and entry arguments.
- `resolveTarget(client, arg): Promise<{ id, file: DriveFile | null }>` — the
  same walk, following a terminal shortcut.

Two functions rather than `resolvePath(client, arg, { follow })` because the
return types genuinely differ, and because the call sites are a fixed list in
five registry files (`commands/drive-read.ts`, `drive-write.ts`, `docs/index.ts`,
`sheets/index.ts`, `share/index.ts`) — the role is wired once per command there,
where it is reviewable as a table, instead of being re-derived at each handler.

Command handlers keep taking `resolvePath: (arg) => Promise<string>` in their
deps; the registry decides which function backs it. `mv` and `cp` are the
exception and gain a second dep for the destination, because their two arguments
have different roles.

### 4. An id-looking argument costs one `files.get`, and only where it follows

`resolvePath` returns an id-shaped argument untouched, with no API call
([0008](0008-drive-commands.md)). `resolveTarget` cannot: nothing in the string
says shortcut. So it fetches the file, and returns it in `file` so the caller
does not fetch it twice — which is why the return type is a pair.

The bill, per command, for an argument that is a bare id:

| | round trips |
|---|---|
| `download`, which already fetched metadata | unchanged |
| `docs *`, `sheets *`, `ls <folder>` | +1 |
| `rm`, `mv`, `cp`, `share *`, `info` | unchanged |

A path argument pays nothing either way: the walk's `files.list` already returns
`mimeType`, and now returns `shortcutDetails` with it.

The alternative — resolve optimistically and retry on 404 — keeps the fast path
free but pays two extra round trips exactly when a shortcut is involved, and
spreads shortcut handling across every API wrapper's error branch. One
predictable `files.get` in one place is the better trade for a tool whose
primary caller is a script.

### 5. One hop, never a chain

`resolveTarget` follows exactly one shortcut. If the target is itself a shortcut
the command fails with `API_ERROR` rather than following again. Drive refuses to
create a shortcut to a shortcut, so this is a state that should not exist; one
hop states that as a rule instead of relying on a loop guard to notice.

### 6. A dangling shortcut names itself in the error

Following can fail in two ways, and both messages say *shortcut* so the user is
not left debugging a `NOT_FOUND` on an id they can see in `ls`:

- the target is trashed, deleted, or not readable by this account →
  `NOT_FOUND`: `Shortcut "Reports/link" points at a file that is gone or not
  accessible (target 1AbC…).`
- Drive returns the shortcut MIME with no `shortcutDetails.targetId` →
  `API_ERROR`, the same class [0020](0020-drive-root-name.md) §4 uses for a
  response that does not match Drive's own contract.

A shortcut to a *non-folder* used as an intermediate segment needs no new
branch: it resolves, the next `'<id>' in parents` comes back empty, and the walk
reports the existing `No such file or folder` for that segment — the same answer
a Doc in the middle of a path already gets.

### 7. `--type shortcut` filters; `--type file` is left alone

`ls` and `search` accept `shortcut` in `--type`, matching the shortcut MIME.
`--type file` keeps its documented meaning, *anything that is not a folder*, and
so continues to include shortcuts alongside Docs, Sheets and Slides. Carving
shortcuts out of it would make `file` mean "not a folder, except one other
thing", and the bucket is already coarse in exactly that way.

## Out of scope (deferred)

- **Creating shortcuts** (`files.create` with the shortcut MIME and a
  `targetId`). It is a new command with its own naming and flag questions, and
  it should be designed once reading is settled: [`0026`](0026-ln.md) does that,
  and adds `ln`'s two arguments to §1's table.
- **A `--follow` / `--no-follow` override.** Adding it before anyone has hit a
  case the role table gets wrong would be guessing at the exception. The escape
  hatch already exists: `target_id` from `info`, passed as an id.
- **Shortcut-aware `ls` text output** (an `link -> target` column). The `type`
  column reading `shortcut` and `info` carrying the target is enough to see
  what a row is.

## Consequences

- `resolvePath`'s terminal behavior is unchanged, so `rm`, `mv`, `cp`, `share`
  and `info` keep their current round-trip count and their current semantics on
  every file that is not reached *through* a shortcut.
- The `DriveFile` contract gains two fields and `FileType` gains a member. Both
  are breaking for a consumer that exhaustively switches on `type`, which
  [0014](0014-pre-1.0-compatibility.md) permits in a minor release with a
  release note.
- `ls --type file` and `search --type file` start returning rows whose `type`
  reads `shortcut`. Previously those rows read `file`, so the set is the same;
  only the label changed.
- Every command reached by a path becomes usable inside a folder shortcut — the
  case a user hits without knowing a shortcut is involved, because the Drive UI
  does not distinguish one from a folder.
