# 0062: A write has an inverse

Date: 2026-09-02
Status: accepted — extends [0021](0021-markdown-writes.md), [0022](0022-insert-at-marker.md)

## Context

`docs` reads, creates, appends, inserts and replaces. Nothing removes, so an
`insert` that turns out to be wrong cannot be undone from the CLI (issue #41,
reported from use rather than from a survey).

The report is worth reading in full, because both workarounds fail for reasons
that are not obvious.

**An empty `--replace` leaves the paragraph behind.** The text goes and the
paragraph mark stays, so undoing a 35-paragraph insert leaves 35 blank
paragraphs in a document other people read. That is correct behaviour for
`replace` — it substitutes text for text — and it is not a deletion.

**Tables cannot be reached at all.** A Markdown pipe table arrives as a real
Docs table ([0021](0021-markdown-writes.md) §6), and `findMarkerRanges` skips
table cells on purpose, so no marker inside one can be named. The two tables
that `insert` had created were unreachable by any command here.

The only recovery was to ask the document's owner to restore it from Google
Docs' version history, by hand, in the browser — on a shared document, which is
where you least want to say that.

For a CLI whose stated audience is an agent, a write with no inverse is worse
than a missing feature. `insert` is a write an agent will sometimes get wrong —
wrong content, wrong marker, wrong position — and today every one of those
mistakes is handed back to a person. It also blocks the ordinary edit loop:
revising a section means "delete and re-insert", and only the second half
exists.

## Decision

### 1. `gdrive docs delete <file>` names a range and removes it

It maps to the Docs API's `deleteContentRange`, which is the one request that
removes anything, and it is a range because that is what the request takes.

Two ways to name one, and no more:

- **`--from <marker> --to <marker>`** — from the start of the first through the
  end of the second, both included. This is the shape that matters: it is the
  only one that can remove a table, because it never has to name anything
  inside the table.
- **`--index <n> --length <n>`** — the escape hatch, and the same `--index`
  `insert` already takes.

`--after <marker> --paragraphs <n>` was in the report and is not here.
`--from`/`--to` expresses it whenever the caller knows what the last paragraph
says, which is the case in the report itself, and a paragraph count is a thing
a caller has to compute against a document they cannot see indices into.

### 2. Each marker must match exactly once

[0022](0022-insert-at-marker.md) §2's rule, for the same reason and more of it.
An insert into three places is a mistake you find afterwards; a deletion of
three places is a mistake you cannot find at all. A marker that matches twice is
`INVALID_ARGS` naming the count, and `--to` before `--from` is refused before
anything is sent.

### 3. The paragraph goes with its text

A range that covers a whole paragraph takes its paragraph mark too, so removing
one paragraph does not leave a blank line where it was. That is the difference
between this command and an empty `--replace`, and it is the whole reason the
report could not use the tool it had.

The document's last paragraph mark is not removable — Docs requires it — so a
deletion that would reach it stops one character short. This is a rule of the
API, not a choice, and the command says so rather than failing.

### 4. `--dry-run` reports the range and writes nothing

Every other destructive path here has one: `forms write`, `slides write`, and
`cp -r`'s report. A deletion is the one that most needs it, because what it
removes is not visible in the argument — `--from`/`--to` names two ends and the
caller is trusting their memory of what is between them.

The dry run reports the range, its length in characters, and the text at each
end, which is what tells a caller they named the range they meant.

### 5. `replace` does not change

Making an empty `--replace` drop the paragraph was the report's second
suggestion, and it is declined. `replace --replace ""` substitutes nothing for
something, and the paragraph it leaves is the correct result of that. Two
commands whose difference is whether the argument happened to be empty is a
worse surface than one command that deletes. `docs/` says which to reach for.

## Consequences

- An `insert` is now reversible from the CLI, including one that created tables.
  The report's own recovery — asking the document's owner to open version
  history — is no longer the only route.
- `docs delete` is destructive and Drive has no undo for it. Google Docs' own
  version history is still the backstop, and `docs/` says so plainly rather than
  implying the CLI has one.
- The marker walk stays the body's ([0021](0021-markdown-writes.md), issue #21),
  so a marker in a header, a footer or a footnote is still unaddressable. This
  command inherits that limit rather than adding one.
