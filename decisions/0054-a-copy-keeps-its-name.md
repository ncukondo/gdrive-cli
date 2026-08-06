# 0054: A copy keeps its name, and a same-named sibling is refused

Date: 2026-08-06
Status: accepted — extends [0031](0031-recursive-copy.md)

## Context

Nothing has ever said what a copy is called. `files.copy` sent without a `name`
gets Drive's default, and building [0031](0031-recursive-copy.md)'s walk showed
that default is not one rule:

```
gdrive cp -r <folder> <dest>   a Doc inside it   ->  Budget
gdrive cp    <file>   <dest>   the same Doc      ->  Copy of Budget
gdrive cp -r <file>   <dest>   the same Doc      ->  Copy of Budget
```

Measured against a real account on 2026-08-06: a binary file keeps its name and a
Google-native document gains `Copy of`. So the name a file ends up with depends on
its type, and — once the walk started naming each level explicitly — on whether it
was reached directly or through a folder. The same `-r` produces both.

Drive's default earns its keep in exactly one situation: a copy made into the
folder the original already sits in, where two identical names are hard to tell
apart. Drive permits duplicate names, so nothing forces a distinct one; `Copy of`
is a courtesy, applied unevenly.

This repository already has an answer to "what should a file operation do",
and it is not Drive's UI. [0025](0025-shortcuts.md) §1 settled shortcut following
by reasoning from POSIX symlinks, because the command names are POSIX's. `cp`
belongs to that set, and POSIX `cp report.md archive/` produces
`archive/report.md`. It does not invent a name.

## Decision

### 1. A copy keeps the source's name

Every copy, at every level, whether the argument was a file or a folder and
whether `-r` was given. One rule, no branch on file type, no branch on how the
file was reached.

### 2. `--name` renames the top-level copy, and only that

Unchanged from [0031](0031-recursive-copy.md): it names the thing the command was
pointed at. Nothing below it is renameable, because nothing below it was named by
the caller.

### 3. A copy that would produce a same-named sibling is refused

Copying a file into the folder it already lives in, without `--name`, is
`INVALID_ARGS`, and the message names `--name` as the remedy. POSIX refuses the
same thing (`cp a .` answers *'a' and './a' are the same file*), and for a better
reason here: Drive would not refuse, it would silently produce twins that no
listing can tell apart and that no later command can address by path.

The case this forbids is real — a snapshot before an edit — and it is served
better by being made to say `--name "Budget (backup)"` than by being handed
`Copy of Budget`. The one situation Drive's default was built for is the one
situation where a name is worth a moment's thought.

This is about a *sibling*, not about a cycle. [0031](0031-recursive-copy.md)
already refuses copying a folder into itself or into its own descendant; that
stays, and it is a different error for a different reason.

## Consequences

- `gdrive cp <file> <folder>` changes behaviour: it no longer produces
  `Copy of <name>`. [0014](0014-pre-1.0-compatibility.md) permits this before 1.0
  only if the release notes carry it, so `CHANGELOG.md` must name it as breaking
  and say what a caller does about it — `--name` reproduces the old name exactly.
- `cp` and `ln` now agree: the default is the source's name, `--name` overrides.
  [0026](0026-ln.md) §3 chose that for `ln` because Drive's own default there was
  `Untitled`; the reasoning generalizes and this record is where it lands.
- A tree copy reproduces the tree, which is what `-r` claims to do.
- One case that used to succeed now fails. That is the point of §3, and it is
  discoverable: the error names the flag that fixes it.

## Out of scope (will not be done)

- **Making `mv` refuse a same-named sibling too.** `mv` cannot create one — it
  moves a file rather than duplicating it — so there is nothing to refuse.
- **A `--force` that permits the twins §3 refuses.** Nobody has asked for it, and
  `--name` already expresses every intent it would serve.
