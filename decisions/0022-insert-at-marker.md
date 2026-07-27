# 0022: `insert --before` / `--after <marker>` positions by text, not index

Date: 2026-07-27
Status: accepted — extends [0009](0009-docs-commands.md)

## Context

`docs insert` takes `--index <n>` or `--at start|end`. Neither is usable when
the target is "where the placeholder is": a character index has to be computed
from a `read`, and it is invalidated by the next edit.

So people reach for `replace` instead, replacing a marker with *text plus the
same marker* to fake an insertion ([issue #7] documents exactly this trick). It
works, but it means the command that substitutes is also the command that
positions, and the marker has to be repeated in the replacement — a detail that
is easy to get wrong and silently consumes the marker when you do.

## Decision

### 1. Two more positions on `insert`

```sh
gdrive docs insert <file> @draft.md --before "<!-- schedule -->"
gdrive docs insert <file> "Reviewed. " --after "## Summary"
```

`--before` inserts at the marker's start index, `--after` at its end index. The
existing rule holds unchanged: **exactly one** of `--index`, `--at`, `--before`,
`--after` is required, and giving two is `INVALID_ARGS`.

This leaves `insert` owning position and `replace` owning substitution, which is
what their names already claim. The `replace`-with-the-marker-repeated idiom
keeps working; it stops being the only way.

### 2. The marker must match exactly once

Zero matches is `NOT_FOUND` naming the marker. Two or more is `INVALID_ARGS`
reporting the count. Neither guesses.

`replace` acts on every occurrence because substitution is idempotent in a way
insertion is not: inserting a draft at three places is nearly always a mistake,
and it is a mistake you discover after it has been written. A user who does want
all of them still has `replace`, where "all" is the documented behavior.

`--match-case` behaves as it does on `replace` — matching is case-insensitive
unless the flag is given — because two commands with the same option and
opposite defaults is worse than either default.

### 3. The search is the same walk `replace` uses

Paragraph runs only; a marker inside a table cell is not matched
([0021](0021-markdown-writes.md) §6). One helper serves both commands, so the
two cannot drift on what "found" means.

## Out of scope (deferred)

- Regular-expression or multi-occurrence markers (`--occurrence <n|all>`).
- Markers for `append`, which has no position to choose, or for the Sheets
  commands.
- Deleting a marker after inserting next to it — that is `replace`.

## Consequences

- `resolveInsertIndex` in `src/commands/docs/insert.ts` gains the two options
  and becomes async, since resolving a marker means reading the document — which
  the command already does for `--at end`.
- The marker search moves to a shared helper in `lib/docs-api.ts` alongside the
  one 0021 §6 adds for `replace`.
- `docs/commands.md`'s `insert` section gains the two options and the
  exactly-once rule; the "`replace` is the only way to insert at a marker"
  workaround stops being worth documenting.

[issue #7]: https://github.com/ncukondo/gdrive-cli/issues/7
