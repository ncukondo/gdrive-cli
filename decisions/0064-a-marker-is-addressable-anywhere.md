# 0064: A marker is addressable wherever the document keeps text

Date: 2026-09-02
Status: accepted — extends [0021](0021-markdown-writes.md), revises [0046](0046-replace-as-text-keeps-its-reach.md)

## Context

`findMarkerRanges` walks `document.body.content`, so everything built on it —
`docs insert --before/--after`, `docs replace` in its default Markdown mode, and
now `docs delete` ([0062](0062-a-write-has-an-inverse.md)) — can only see the
body. `docs read` renders the body only, for the same reason
([0021](0021-markdown-writes.md), Out of scope).

The gap became visible in
[0046](0046-replace-as-text-keeps-its-reach.md). `replace --as text` goes
through the API's `replaceAllText`, which **does** substitute in headers,
footers and footnotes. So routing that path through the marker walk — which is
what would let it reset the style of what it wrote, per
[0045](0045-inserted-content-is-default-styled.md) — would silently narrow what
it replaces. 0046 chose to keep the reach and document the exception.

That exception is the shape worth naming: one command reaches four segments and
every other command reaches one, and the difference is not a design, it is
which API each happens to call (issue #21).

## Decision

### 1. The walk covers every segment that holds text

`headers`, `footers`, `footnotes` and the body. A marker anywhere in the
document is addressable by every command that takes one, so `insert`, `replace`
and `delete` agree with each other and with `replaceAllText` about what "found"
means.

### 2. A range carries the segment it belongs to

A Docs index is only meaningful inside its segment: index 42 in the body and
index 42 in a footer are different characters. Every request that takes a
`Location` or a `Range` takes a `segmentId` beside it, and the walk returns one
with each range rather than leaving the caller to assume the body.

That is what makes the "exactly once" rule of
[0022](0022-insert-at-marker.md) §2 mean what it says: a marker that appears
once in the body and once in a footer matches **twice**, and an `insert` that
silently took the body one would be choosing for the caller.

### 3. `read` renders what the walk can reach

A marker a caller cannot see is one they cannot use. `docs read` gains the
header, footer and footnote content, marked as what it is, so the document a
caller reads is the document they can address. How that is spelled belongs to
`docs/` and the code.

### 4. 0046's exception goes

`replace --as text` no longer differs in reach from `replace` in Markdown mode,
because both now cover the four segments. [0046](0046-replace-as-text-keeps-its-reach.md)'s
choice was correct for the day it was made — keeping the reach beat narrowing
it — and the thing it was choosing between no longer exists.

This also unblocks what 0046 gave up:
[0045](0045-inserted-content-is-default-styled.md)'s style reset can be applied
to the `--as text` path, because that path can now be expressed as the marker
walk. **That work is not done here**; this record only removes the reason it
could not be.

## Consequences

- A document whose section titles live in a header becomes editable. Today it
  reads as though those titles are not there.
- **A marker that used to match once may now match twice**, and an `insert` that
  worked yesterday can become `INVALID_ARGS`. That is a breaking change, allowed
  by [0014](0014-pre-1.0-compatibility.md) if the release notes carry it, and it
  is the correct failure: the alternative is a write landing in a segment the
  caller did not mean.
- `replace` in Markdown mode now reaches a footnote, where a Markdown table
  cannot be built — Docs does not allow a table in a footnote. That is refused
  through the same channel `read` already reports unsupported content on, not
  by silently writing text.
