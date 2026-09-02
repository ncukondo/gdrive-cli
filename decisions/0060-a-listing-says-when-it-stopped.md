# 0060: A listing says when it stopped early

Date: 2026-09-02
Status: accepted — extends [0008](0008-drive-commands.md), [0031](0031-recursive-copy.md) §3–§4

## Context

`collectPages` stops after `MAX_PAGES = 100` and returns what it has. No error,
no flag, no note. At the page size it asks for that is 10,000 children, and
three commands read through it.

For `ls` and `search` this has always been the behaviour, and a person who gets
back exactly 10,000 rows can at least see the shape of what happened.

For `cp -r` it is different in kind. The walk lists a folder's children and
copies them, so a truncated listing is a **silently partial copy reported as a
success** — which is the outcome [0031](0031-recursive-copy.md) §4's complete
report exists to make impossible. §3 and §4 are a pair: stopping early is only
defensible because the report says exactly how far the run got, and a report
cannot say that about children it never saw.

The agent implementing 0033 raised it and deliberately did not change it, since
`collectPages` is shared and making it throw is wider than that task
(issue #32). The three callers do not want the same thing, which is why this
needed a record before it needed code.

**The cap is not a product decision.** Nothing chose 10,000 as a listing size;
it is a bound on a `nextPageToken` loop, from an era when this CLI had no
recursive command. Drive permits far more than that in one folder.

## Decision

### 1. Truncation is a value, not a silence

`collectPages` reports whether it stopped because Drive ran out of pages or
because it ran out of patience. Every caller then decides, and no caller can
decide by accident — which is the property that was missing, more than any
particular choice below.

A listing cut short by the caller's own `--limit` is **not** truncation. The
caller asked for `n` and got `n`.

### 2. `ls` and `search` say so and still succeed

The listing is real, it is just not all of it. `data.complete` is `false`,
text mode prints a note naming the cap, and the exit code stays 0.

Failing instead was the alternative and is wrong for these two: `ls` on a huge
folder returning an error and no rows is less useful than the rows and a
warning, and a caller that wants everything can narrow with `-q`, `--type` or a
`search`.

### 3. `cp -r` stops, because it cannot report what it did not see

An incomplete listing during the walk is a terminal failure. It stops the run
and reports through 0031 §4's envelope exactly as a permission error would: the
folders created, the files copied, and the folder whose listing came up short.

This is the whole of why the record exists. `cp -r` is allowed to stop early
*because* it says where; a copy that quietly skipped 30,000 files and exited 0
would make that guarantee false.

### 4. The refusal gets its own code

`LISTING_INCOMPLETE`, in the argument bucket, for the reason
[0028](0028-forms-write.md) §3 gave `PRUNE_REQUIRED` its own: the next action
differs. Nothing is wrong with the credentials, the path or Drive. The caller
copies the large subfolders one at a time, or narrows what they asked for.
`API_ERROR` would say Google failed, and Google did not.

Adding a member to the code list is a minor-release break for a consumer that
switches exhaustively ([0014](0014-pre-1.0-compatibility.md),
[0034](0034-file-types-are-what-commands-act-on.md) §3).

### 5. The cap moves to where it was always meant to be

`pageSize` becomes Drive's maximum of 1000 rather than 100, so 100 pages is
100,000 children instead of 10,000, and an ordinary thousand-child folder costs
one round trip instead of ten. The cap keeps its job — bounding a pathological
`nextPageToken` loop — and stops standing in for a listing limit nobody chose.

This makes §3 rare rather than theoretical. It does not make it unreachable, and
a guarantee that holds only for folders somebody guessed were big enough is not
one.

## Consequences

- A `cp -r` of a folder with more than 100,000 children now fails where it used
  to report a false success. Nothing that was correct becomes incorrect.
- `ls` and `search` gain a field. A caller that ignores it behaves as before,
  and a caller that was silently reading a truncated listing can now find out.
- Every listing gets faster in the common case, which is a side effect of §5 and
  not its reason.
- `docs/commands.md` carries the field, the code and the number, because a
  caller who hits this has to know which of the three it was.
