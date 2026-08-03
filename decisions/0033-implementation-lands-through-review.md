# 0033: Implementation lands through a pull request, reviewed without its context

Date: 2026-08-03
Status: accepted — revises [0001](0001-development-process.md)

## Context

[0001](0001-development-process.md) settled how work is planned and how it is
committed, but said nothing about how it lands. In practice almost everything has
gone straight to main; one branch has ever become a pull request (#2, the shared
drive work), and what it found is the reason for this record. That branch shipped
and 0018 immediately followed it to close what a review turned up.

The remaining plan fans out. Tasks 0027 to 0033 form a dependency graph two or
three wide, and the parallel-safe ones are meant to run in separate worktrees.
Merging several branches into main by hand, with nothing between the last commit
and the merge, is where a plan of that shape usually loses its coherence.

The reviewer that catches anything is the one that did not write the code. This
matters more than usual here because the implementer is often an agent, and an
agent finishes a task holding every intermediate decision that made the code look
inevitable. It cannot see the gap between what the task asked for and what it
built, because it remembers building it. A reader given only the diff, the task
file and the decisions can.

## Decision

### 1. Implementation lands through a pull request; the record does not

A branch and a pull request are required for `src/`, `tests/`, `docs/`,
`package.json`, `bun.lock`, the installers, and `.github/`. Documentation ships
with the code that makes it true, so a task's `docs/` and root `README.md` edits
belong in the same pull request, never ahead of it.

`decisions/` and `tasks/` go straight to main. They are how the work is planned
and recorded rather than part of what ships, they are written before the branch
exists, and routing them through review would put the plan behind the thing it is
supposed to precede. This is also what keeps `tasks/README.md` out of every
branch, which otherwise guarantees a conflict between any two parallel tasks.

Branch name: `task/00NN-slug`, matching the task file. Merge by rebase, as #2
did, so the small commits [0001](0001-development-process.md) asks for survive in
main and the history stays linear.

### 2. The reviewer is given the task, not the transcript

Review is done by an agent started fresh for it, holding no context from the
implementation. It receives the pull request diff, the task file, and the
decisions the task links. It does not receive the implementer's reasoning, and
the implementer does not review its own branch.

What it is asked for is whether the diff satisfies the task's acceptance criteria
and the decisions it cites, and what it would have done differently. The task
file is the specification for the review because it is already written that way.

### 3. Green CI is a precondition, not the review

`.github/workflows/ci.yml` runs typecheck, both lint passes, the format check,
the full test suite, the build and the package smoke test on every pull request.
A branch is not reviewed until it is green. The reviewer's subject is what the
suite cannot see: whether the tests test the thing, whether a decision was
followed or merely referenced, whether the acceptance criteria are actually met.

### 4. The loop ends when a review changes nothing

Findings are answered by a commit or by an argument on the pull request. A second
review follows any change to behavior, and the reviewer is again fresh. A change
confined to comments or a test name does not earn another round.

Merge when nothing is left open. The task's `Status` line, its move to
`tasks/archive/`, and its row in `tasks/README.md` follow the merge as a direct
commit to main. They record that the work landed, so they cannot precede it, and
by [0032](0032-decisions-are-append-only.md) §5 they cannot wait either: the task
is stale from the moment its code is in main, so it is archived in the next
commit rather than at the end of a batch.

## Out of scope (deferred)

- **Branch protection on main.** The rule above is a working agreement, not a
  server-side gate. Enforcement can be added later without changing anything
  here, and adding it now would block the direct commits §1 depends on.
- **Human review.** This record describes the automated pass every branch gets.
  It neither requires nor prevents a person reading the same diff.
- **Release commits.** Version bumps and tags continue as they are; they are not
  implementation, and `.github/workflows/release.yml` already owns what happens
  after a tag.

## Consequences

- What can conflict between parallel branches drops to two files:
  `src/commands/index.ts`, where every command task appends one registration, and
  `package.json` with `bun.lock`. Both are append-only in practice and both
  resolve mechanically on rebase.
- Wall-clock time per task grows by a review round, and by a second one when the
  first finds something. That is the cost being accepted, and it is paid in
  parallel across branches rather than in series.
- A task whose file is thin gets a thin review, because §2 makes the task file
  the reviewer's whole specification. Vague acceptance criteria now cost
  something measurable, which is the pressure this record wants.
- The first tasks under this rule are 0027 and 0029, the two the graph allows to
  start at once.
