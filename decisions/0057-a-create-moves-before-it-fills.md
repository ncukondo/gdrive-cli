# 0057: A `create` moves before it fills

Date: 2026-08-07
Status: accepted — corrects [0028](0028-forms-write.md) §7, [0030](0030-slides-write.md) §4

## Context

[0028](0028-forms-write.md) §7 describes `forms create` as three calls in a
stated order — create, then fill, then move — and [0030](0030-slides-write.md) §4
repeats the order for a deck. `docs create` and `sheets create` were built the
same way, for the same reason: the four APIs each take a title and ignore any
parent, so a parent needs a second call.

Neither record gives a reason for putting the fill *before* the move, and there
turned out not to be one. The order it produced has a cost the records do not
mention: a fill that fails leaves the file in **My Drive's root**, named as
asked, and the command reports failure without saying where it went. For a form
or a deck that is easy to reach — the fill is one `batchUpdate`, which is atomic,
so a single item the API refuses fails it after the file exists.

The order is now create, move, fill, and the position both records take —
three calls, because the API forces a second one — is unchanged.

**It had already happened.** Writing the live suite (task 0045) surfaced this as
a containment hazard: [0043](0043-e2e-runs-before-push.md) §2 rests on every
write landing inside a sandbox, and this path wrote outside one no matter what a
test did. Then the live pass for task 0046 found the artifact itself — a form
called `Untitled form` sitting in My Drive's root, created 2026-08-06T07:06:17Z,
titled `Manual pass 0030`, with no items. It was the first `forms create` of that
day's work, orphaned when its `batchUpdate` was refused, and it sat there
unnoticed for a day while five branches went past. The defect was not waiting to
happen; it had happened, and nothing in the run said so.

## Decision

### 1. The move goes first

Every `create` that was given a `--parent` moves the new file there before it
writes anything into it. A failure after that leaves the file where the caller
asked for it, and My Drive's root is only reachable when the **move itself**
fails.

### 2. A failure that left a file names it

The error carries the file's id, its title, and where it ended up, through the
`data` [0031](0031-recursive-copy.md) §3–§4 added to the envelope. `parent_id`
describes where the file *is*, not where it was asked to go, so it is absent
exactly when the move was the call that failed.

This is the second command family to need that field, which is the point of its
having been made general rather than shaped around `cp -r`.

## Consequences

- `tests/e2e/forms.test.ts` said containment does not hold on the failure path.
  It does now, and the file says so.
- A caller who sees a `create` fail can find and delete what it left, without
  searching My Drive's root by name.
- 0028 §7 and 0030 §4 remain the record of *why* there are three calls. Only
  their order is superseded, and only by this file — neither of them changes
  ([0032](0032-decisions-are-append-only.md) §3).

## Consequences for reading a record's order

The stale half of 0028 §7 was a sentence about *how* the code runs, sitting in a
record whose subject is *why* it runs at all. That is the kind of sentence
[0032](0032-decisions-are-append-only.md) §1 warns is dated prose rather than
specification, and it is the kind this repository has now found stale four times
in a fortnight — twice in code comments, once in `docs/`, once here.

The pattern is narrow enough to name: a record earns its keep by carrying a
reason, and loses accuracy fastest where it carries a mechanism instead. Where
the two are in one sentence, the mechanism is the half to distrust.
