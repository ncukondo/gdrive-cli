# 0035: Output correctness is asserted at the renderer; docs are downstream

Date: 2026-08-03
Status: accepted — revises [0001](0001-development-process.md)

## Context

The pipeline this project works in runs one way. A developer writes a task; a
task defers to a decision for *why*; the decision is realised as code, which is
the source of truth ([0032](0032-decisions-are-append-only.md) §1); `docs/`
describes for a user what the code does. Every arrow points downstream, and
`docs/` is the last of them.

Task 0034 inverted the last arrow. Two defects had reached users: `ls` ran the
type into the timestamp for a `shortcut` row, and `docs/commands.md`'s `info`
transcript was missing a `Link:` line the renderer prints. Review asked for a
guard, and the answer was `tests/integration/docs-transcripts.test.ts` — it
re-renders six transcripts and requires each to appear verbatim in the document.
It was reviewed, argued for on its merits, and merged.

It is the wrong shape, for a reason that outlives the two defects it was aimed
at. Consider what it can and cannot fail on. If the renderer emits something
wrong and the document quotes the same wrong thing, the test passes. If the
renderer is right and the document is merely reworded, the test fails. It is not
a test of output at all: it is an equality check between an artifact and its own
description, and it fails in the direction that punishes editing the
description.

Separating the two defects settles it. The column collision was a code defect,
and the test that catches it is a property over the renderer — one now exists,
asserting a separator after every `FileType` member. The missing `Link:` line was
not a code defect at all. The renderer was correct and the prose was stale. A
stale sentence in `docs/` is a documentation problem, and pinning prose to code
does not make prose true; it only makes the prose expensive to change.

## Decision

### 1. Output correctness is a property of the renderer, asserted there

What a command prints is settled by tests over the function that prints it, and
those tests state properties rather than sample strings: every type is followed
by a separator, every column starts at the same offset for every input, a field
that is present is shown. A property holds for inputs nobody thought of, which is
what the two defects above had in common — both were inputs nobody had rendered.

### 2. `docs/` is never a test fixture

No test may require a file under `docs/`, or `README.md`, to contain a
particular string. They are downstream: they describe what the code does, they
are written for a person, and they are free to be reworded, shortened, or
reorganised without a test having an opinion. A transcript in `docs/` is
illustrative. A reader who needs to know exactly what the CLI prints runs it.

This does not license inaccuracy. It places the obligation where it belongs: on
whoever changes the behaviour, as part of the same pull request
([0033](0033-implementation-lands-through-review.md) §1), and on review. If that
proves insufficient, the answer is to *generate* the examples from the code, not
to assert the hand-written ones against it.

### 3. The direction is the rule, not this instance

Nothing downstream constrains anything upstream. A task does not constrain a
decision, a decision does not constrain the code it produced
([0032](0032-decisions-are-append-only.md) §1), and `docs/` constrains nothing.
When a guard has to reach downstream to work, the guard is in the wrong place.

## Out of scope (deferred)

- **Generating transcripts from the code.** §2 names it as the answer if review
  proves insufficient, but nothing yet says it has. It would be a build step and
  a new failure mode, and neither is worth adding before the problem is shown to
  be real.
- **Whether `docs/commands.md` should carry transcripts at all.** They help a
  reader; the question here was only what enforces them.

## Consequences

- `tests/integration/docs-transcripts.test.ts` is deleted rather than extended.
  The review of task 0034 found it covered six of the document's forty-two
  console blocks while claiming to cover every transcript, and filed closing that
  gap as a follow-up. The gap does not need closing; the test does not need to
  exist.
- The renderer tests carry the whole weight, so they have to be worth it. The
  `Name` column has the same defect the type column had — a fixed width, and a
  name that meets or exceeds it loses its separator, plus a full-width character
  drifting every column right of it, because padding counts UTF-16 units and not
  display width. §1 says that is a renderer property and belongs in a renderer
  test.
- Documentation drift becomes a review responsibility again, and the record
  admits that is weaker than a test. It is the weaker guarantee in the right
  place rather than a stronger one in the wrong place.
