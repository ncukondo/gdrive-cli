# 0031: `cp -r` copies a folder tree, and reports how far it got

Date: 2026-08-03
Status: accepted

## Context

`files.copy` does not copy folders. Drive has no server-side recursive copy at
all: the only way is to create the destination folder, list the source, copy
each file, and recurse. `gdrive cp` passes a folder id straight to `files.copy`
and surfaces whatever Drive says, which mentions neither folders nor what to do
instead ([0008](0008-drive-commands.md) records `cp` without noting the limit).

So today an agent that wants a folder copied has to run the walk itself:
`ls -f json` per folder, `mkdir --parent` per folder, `cp` per file —
roughly `2F + N` process launches for `F` folders and `N` files, each paying a
config read, a token load and a refresh check. Worse, nothing records progress.
A run that dies at file 150 leaves no account of what was copied, and Drive
permits duplicate names, so retrying stacks a second partial copy on the first.

That is work the CLI can do in one process on one token, and — more to the point
— partial failure needs *one* definition, not one improvised per agent.

## Decision

### 1. `-r` copies the tree; without it, a folder says so

```
gdrive cp [-r|--recursive] <file|folder> <folder> [--name <name>]
```

`cp -r <folder> <dest>` creates `<dest>/<source name>` and reproduces the tree
inside it. `--name` renames that top-level copy. `-r` on an ordinary file copies
it, as POSIX `cp -r` does, rather than being an error.

Without `-r`, a folder source still reaches `files.copy` and still fails. What
changes is the message: on failure, `cp` fetches the source's metadata, and if
it is a folder, replaces the error with one that names the folder and `-r`.

Checking *after* the failure rather than before is deliberate. A pre-flight
`files.get` would cost every ordinary `cp` a round trip to guard against a case
that ends in an error anyway. This is the shape [0019](0019-shared-drive-paths.md)
§3 already uses for the shared-drive hint: run the real operation, and only when
it fails spend a call to explain why.

### 2. The walk creates each folder before filling it, and never follows a shortcut

The copy is depth-first, and a folder is created before anything is copied into
it. So whatever exists when a run stops is a valid prefix of the result — a
subtree, not a scatter of files with no parents.

A **shortcut inside the tree is copied as a shortcut** and never recursed into,
even when it points at a folder. `files.copy` on a shortcut duplicates the
pointer, which is the correct outcome, and following one would copy a folder the
user did not name — possibly someone else's. This is
[0025](0025-shortcuts.md) §1's rule reappearing: the walk enumerates *entries*,
and an entry argument never follows.

### 3. The first real failure stops the run, and everything already done is reported

There is no transaction in Drive and this record does not pretend otherwise.
`cp -r` stops at the first non-transient failure and reports, in full: the
folders it created, the files it copied, each with its source and destination
id, and the one that failed. The exit code and `error.code` are the underlying
failure's.

Continuing past failures was the alternative — copy what can be copied, list the
rest at the end. It was rejected because a failure part-way through is usually
systemic rather than per-file: a rate limit, an expired token, a quota. Pressing
on turns one clear error into a long report of the same error, and the caller
still has to decide what to do about a half-copied tree.

Stopping only helps if the caller can tell what happened, which is §4.

### 4. The error envelope gains an optional `data`

```json
{ "success": false,
  "error": { "code": "PERMISSION_DENIED", "message": "…" },
  "data": { "folders": [{"src": "1F…", "dst": "1Z…", "name": "2026"}],
            "copied":  [{"src": "1A…", "dst": "1X…", "name": "a.pdf"}],
            "failed":  {"src": "1C…", "name": "c.pdf"} } }
```

[0007](0007-output-and-errors.md)'s error envelope carries only `error`. It
gains an optional `data`, present when a command failed after changing something
and absent otherwise, so `success: false` no longer implies nothing happened.

This is a general addition, not a `cp -r` accommodation. Any command that makes
many changes in one invocation has the same problem, and the alternative —
exiting 0 with a `failed` list — would report success for a run that did not
succeed. A caller that ignores the new field behaves exactly as before.

Text mode prints a summary and the failure; quiet prints the ids copied so far,
one per line, which is what makes a shell retry loop possible.

### 5. Transient failures are retried inside the walk

A rate limit is not a failure of the copy, it is Drive asking for a pause. Since
§3 stops at the first failure, treating `429` and `5xx` as terminal would make
`cp -r` unusable on exactly the large trees it exists for.

So the walk retries those with exponential backoff, a bounded number of times,
and treats everything else as terminal. The retry is scoped to `cp -r` because
it is the only command that makes hundreds of calls in one invocation; nothing
else in the CLI retries anything, and this record does not change that.

### 6. Copying a folder into its own subtree is refused before anything is copied

`cp -r A A/B` would recurse forever. Before starting, `cp -r` walks the
destination's ancestors; if the source appears among them, or the destination
*is* the source, it fails `INVALID_ARGS`.

This costs one `files.get` per level of the destination's depth, typically two
or three, paid once. Detecting the cycle during the walk instead would mean
noticing it after copying part of a tree into itself.

## Out of scope (deferred)

- **Resuming** (`--continue`, or skipping what already exists at the
  destination). §4's report is what a caller needs to build a retry; a
  first-class resume needs a way to match a destination file to its source, and
  Drive gives none that survives a rename.
- **Parallelism.** The walk is sequential. Concurrency would multiply the rate
  limit §5 works around, and the ordering §2 relies on would need rethinking.
- **General retry across the CLI.** §5 is scoped on purpose; whether every
  command should retry is a separate question with a separate blast radius.
- **Copying permissions, ownership, or revision history.** `files.copy` does not
  carry them, and reproducing them is a different feature.

## Consequences

- `cp` gains a round trip only on the failure path (§1), and `cp -r` costs one
  `files.list` per folder plus one `files.copy` per file, which is the floor
  Drive imposes.
- [0007](0007-output-and-errors.md)'s envelope changes shape. Breaking for a
  consumer that asserts an error response has exactly two keys, which
  [0014](0014-pre-1.0-compatibility.md) permits in a minor release with a
  release note.
- A large `cp -r` can still stop half-done. That is Drive's constraint; what
  this record buys is that the caller always knows exactly which half.
- `cp -r` is the CLI's first long-running command. If a second appears, §4's
  envelope field and §5's retry are the two things it should reuse rather than
  reinvent.
