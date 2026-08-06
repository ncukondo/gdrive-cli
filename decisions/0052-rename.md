# 0052: `gdrive rename <file> <name>`, and the one title it cannot reach

Date: 2026-08-06
Status: accepted — extends [0025](0025-shortcuts.md) §1

## Context

Nothing in this CLI can change the name of a file that already exists. A name is
expressible when a file is made and when it is copied — `cp --name`, `ln --name`,
the title argument of every `create` — and never afterwards. `mv` moves and only
moves, which is its own surprise: the POSIX command it is named after renames
too.

The gap surfaced through a defect rather than a feature request. Task 0030's
`forms create` sent the Forms API `info.title` alone, so every form it made was
called `Untitled form` in Drive, and this CLI resolves paths by Drive's name — the
forms were unreachable by path. The fix (setting `documentTitle` at creation)
landed before merge because the defect looked unrepairable. Measuring afterwards
showed it is repairable, but only by a command that does not exist.

Four measurements against a real account, on 2026-08-06:

| | Drive rename changes the in-document title? |
|---|---|
| Doc | yes — they are one field |
| Sheet | yes |
| Slides | yes |
| Form | **no** — `drive.name` moves, `info.documentTitle` does not |

And the Forms API refuses to fix the survivor: `updateFormInfo` with
`documentTitle` in the mask answers *"document_title can be set on create but is
read-only in subsequent requests"*.

So a form carries three names where the other types carry one: the Drive name
that `ls` prints and paths resolve, `info.title` that responders see and
[0028](0028-forms-write.md) already writes, and `documentTitle`, frozen at
creation. Two of the three are reachable today.

## Decision

### 1. Renaming is its own command, not a second meaning for `mv`

`mv`'s destination is contractually a folder — [0025](0025-shortcuts.md) §1 gives
it the container role, and following a shortcut is part of that contract. A
POSIX-style `mv <file> <new-name>` would have to decide, per invocation, whether
the second argument names a folder or a name, and Drive cannot answer that: it
permits two files with the same name in the same parent, so "does this exist as a
folder" is a question with more than one true answer. Guessing there would put an
ambiguity inside the one command whose whole job is to move a file somewhere
definite.

A separate verb costs a line in the command list and removes the guess.

### 2. The argument is an **entry**

Renaming a shortcut renames the shortcut, not what it points at — the same answer
[0025](0025-shortcuts.md) §1 gives `rm`, `mv <file>`, `cp <file>`, `share` and
`info`, and for the same reason. A shortcut is a file with its own name, and a
rename that silently retitled the target would be unobservable in the output.
0025 §1's table gains a row rather than an exception.

### 3. Renaming a form reports what the rename did not reach

The measurements above make `rename` mean something slightly different for a form
than for everything else: the file is renamed, and the title in the Forms editor
is not. Returning a bare success there is the shape
[0028](0028-forms-write.md) §3 refuses — success reported for a change that did
not happen — arriving through a third door after
[0030](0030-slides-write.md) §3 found the second.

It is a report, not a failure. The rename repaired what this CLI resolves paths
by, which is the damage worth repairing; refusing it would leave a form that
cannot be addressed by path with no way to become one.

It travels through the existing channel — the `unsupported` field and its stderr
line ([0021](0021-markdown-writes.md) §3) — rather than a new one. The field's
meaning widens from "no request could carry this" to "part of what you asked for
did not happen", which is the question a caller is asking in both cases. The
alternative, a sibling field, grows the envelope to preserve a distinction no
caller acts on differently.

The type is known from the response the rename already receives, so the report
costs no extra call, and it is not conditional on checking whether the titles
actually differ: `documentTitle` was frozen at creation, so they differ unless the
new name happens to equal the old one, and a round trip is not worth buying that
certainty for a warning.

## Consequences

- Every form this CLI created before task 0030's fix can be made addressable by
  path again. Its Forms editor will still show `Untitled form`, permanently.
- `unsupported` is no longer only about items a document could not model. Any
  command with a partial effect reports through it, and `docs/` carries what each
  one means.
- 0025 §1's role table grows a row; nothing in it changes.

## Out of scope (will not be done)

- **Repairing `documentTitle`.** Not deferred and not tracked: Google's API
  forbids it, so there is no work to schedule. Recreating the form would change
  its id and strand its responses, which is a worse answer than a stale title in
  one editor. [0042](0042-deferred-work-is-an-issue.md) §2 asks that most
  deferrals be disowned rather than filed, and this one cannot be done at all.
