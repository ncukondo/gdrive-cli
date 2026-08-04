# 0042: Work that is deferred rather than done is a GitHub issue

Date: 2026-08-04
Status: accepted — revises [0032](0032-decisions-are-append-only.md) §6

## Context

Nothing in this repository can hold the state of work that is neither finished
nor started.

A decision is frozen ([0032](0032-decisions-are-append-only.md) §3), so its
`Out of scope (deferred)` section records why something was left out at the
moment it was written and can never say whether it is still left out. A task
expires at merge (§5), so a deferral written into its outcome notes is archived
with it. `tasks/README.md`'s table is the one mutable list, and only work with a
task file can appear there, while a task file is written when the work is about
to happen. Between those three, deferred work has no representation at all.

The cost is already paid. Task 0037 ends with:

> **Deferred deliberately**: `runFlow` is a second wait-for-a-human that does not
> pass the `canPrompt` gate, so with `client_secret.json` present and no tty
> `gdrive auth` blocks on the loopback server. Identical on `main`, inherent to
> [`0005`](../../decisions/0005-auth-and-scopes.md) step 3, and its own task.

That is a reachable defect in the command a new user runs first, diagnosed as far
as a fix, filed nowhere. The sentence "its own task" describes a task that does
not exist and cannot be written by the file saying so, because that file went
into `tasks/archive/` eight minutes later. Every day it stays there it is
correct, dated, and unread.

The channel already exists and is already in the vocabulary. Eight issues were
filed on 2026-07-27 — the shared-drive set (#1, #3, #4, #5, #6) and the Markdown
write set (#7, #8, #9) — each became a decision and a task, and several are cited
by number from inside `decisions/` and `tasks/`. What has never happened is an
issue staying open. All eight were closed the day they were filed, so the tracker
has been used as an intake for defects converted immediately, never as a place
where something waits.

## Decision

### 1. Deferred work is an issue

Work that is wanted but not about to become a task is a GitHub issue. That is the
only place in this project that carries state, because it is the only thing here
that is not either code or a dated document.

An issue holds what it takes to pick the work up: what is wrong or missing, how
to reproduce it, and what is already known. It does not hold why a design is the
way it is. That stays in `decisions/`, which is in the clone, is dated, and
cannot be quietly edited — three properties an issue lacks by design.

### 2. A stated deferral is tracked or disowned

Every `Out of scope (deferred)` entry in a new decision, and every deferral
written into a task at archive time, either names an issue or says plainly that
the work will not be done. Both are real answers. What is not is the third thing,
which is what the project has been writing: a description of work, in a document
that freezes, with no way to ask later whether it happened.

Most deferrals will be disowned, and should be. Reviewing the ones written in the
0034 to 0040 stretch under this rule leaves exactly one issue: the `runFlow` tty
block above. The rest are conditional by construction ("if review proves
insufficient", [0035](0035-docs-are-downstream.md)), or are sweeps with no reader
([0039](0039-what-0036-and-0037-got-wrong.md),
[0040](0040-a-review-finding-names-a-class.md)), or are settled positions stated
as deferrals ("`-f text` stays", [0036](0036-machine-format-by-default.md)). A
rule that produces one issue from seven records is working, not failing.

### 3. The plan table stays the plan

`tasks/README.md` continues to hold what is being built, in order, with
dependencies and parallel groups. An issue is upstream of it: an issue becomes a
task when someone decides to do the work, and the task's pull request closes the
issue. Nothing moves in the other direction, and the table does not gain rows for
issues nobody has scheduled.

This keeps one list of work in flight and one list of work not in flight, rather
than two lists of everything.

## Out of scope (deferred)

- **A project board, labels, or milestones.** Eight issues have existed. Adding
  process to a tracker that has never held more than a day's worth of state is
  machinery ahead of need. If the count grows, this can be revisited; it will not
  be filed as an issue, because nobody wants it yet (§2).
- **Filing issues for deferrals in decisions 0001 to 0033.** They were written
  under no such obligation and most are long since answered by the code. §2
  binds new records.
- **Moving the plan into the tracker.** §3 keeps it in the repository, where a
  dependency graph and a parallel group can be read offline and reviewed in a
  diff.

## Consequences

- The repository stops being self-contained for one category of information. A
  clone carries every reason and every plan, and no longer carries the list of
  what is still owed. That is the trade being made for the ability to represent
  state at all, and it is bounded: §1 keeps every *why* in the clone.
- [0032](0032-decisions-are-append-only.md) §6's list of what is not a record
  gains a member that lives outside the tree. The line §6 drew still holds — an
  issue is not dated in the sense that matters, and is expected to be edited
  until it is closed.
- The first issue under this rule is the `runFlow` tty block, filed from task
  0037's outcome notes eighteen hours after they were written.
- A decision's `Out of scope` section becomes slightly harder to write, because
  each entry now has to declare which kind it is. That is the point: the phrase
  "its own task" was doing no work, and now cannot be written without either a
  number beside it or an admission that there is none.
