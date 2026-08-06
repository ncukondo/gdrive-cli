# 0053: A rename reaches a form's title too, and `rename` reports nothing

Date: 2026-08-06
Status: accepted — revises [0052](0052-rename.md) §3

## Context

[0052](0052-rename.md) §3 has `gdrive rename` report, on a form, that it could
not reach the title in the Forms editor. That report is built on a measurement
that was taken wrong.

The measurement read `info.documentTitle` immediately after the Drive rename
returned, saw the old value, and concluded the field never follows. Reading it
again a few seconds later shows it does. Two forms, one created with
`info.title` alone and one with `documentTitle` set explicitly, both renamed
through Drive on 2026-08-06:

```
title only:            before="Untitled form"  +0s="Untitled form"  +3s="RENAMED"  +10s="RENAMED"
documentTitle at create: before="D at create"  +0s="D at create"    +3s="RENAMED"  +10s="RENAMED"
```

So `drive.name` and `info.documentTitle` are one name with a read that lags a
few seconds, and a form is not the exception 0052's table made it. What is still
true is the other route: `updateFormInfo` carrying `documentTitle` is refused
with *"document_title can be set on create but is read-only in subsequent
requests"*. Both facts held; only the inference joining them was wrong.

This does not disturb [0028](0028-forms-write.md) or the fix that set
`documentTitle` at creation. A form created without one is called
`Untitled form` in Drive and unreachable by path from the moment it exists, and
setting it at creation is still the only way to avoid that. What changes is the
claim that the state could never be repaired afterwards — a rename repairs it.

`info.title`, the title a respondent sees, is a different field and is untouched
by a rename. [0028](0028-forms-write.md) already writes it, through the
document's `title`.

## Decision

### 1. `rename` reports nothing, on any type

There is no partial effect to report. The `unsupported` channel keeps the meaning
[0021](0021-markdown-writes.md) §3 gave it — content no request could carry — and
does not widen, so 0052 §3's second half is withdrawn along with its first.

0052 §1 and §2 are untouched: renaming stays its own verb, and its argument stays
an entry.

### 2. Nothing is written about the lag

A `forms read` issued immediately after a `rename` can still show the old title
for a few seconds. It is a read-after-write artifact of one Google API reading
another's field, it converges without anyone doing anything, and there is no
action a caller could take on being told. Documenting it would spend a
user-facing sentence on a state that lasts three seconds.

## Consequences

- Task 0034 loses its third stage. `rename` is one Drive call and its own
  output, with no per-type behaviour anywhere in it.
- Every form this CLI created before task 0030's fix is repairable with one
  `rename`, in Drive and in the Forms editor both.
- 0052's `Out of scope` — that repairing `documentTitle` cannot be done — is
  wrong as written. It can, by renaming the file. Nothing needs filing, because
  the capability is what this task ships.

## Consequences for how the next measurement is taken

0052 was written from four measurements and three of them were right. The one
that was wrong was wrong in a way the others could not expose: it read a
derived field the instant after writing its source, and a single read cannot
tell "never" from "not yet". Both alternatives had to be measured to separate
them, and only one reading was taken.

[0032](0032-decisions-are-append-only.md) §1 already says a record is dated prose
rather than a specification. The narrower lesson is that a measurement of a
*negative* — this does not propagate, this is not settable, this is never
reported — needs a second observation before it becomes a record, because the
first one cannot distinguish absence from latency.
