# 0041: A decision made during review reaches the task before the next round

Date: 2026-08-04
Status: accepted — extends [0033](0033-implementation-lands-through-review.md)

## Context

[0033](0033-implementation-lands-through-review.md) §2 gives the reviewer the
diff, the task file, and the decisions the task links, and nothing else. The task
file is therefore the whole specification the diff is measured against, which is
what §2 says in as many words.

Pull request #15 broke that without anyone noticing. Task 0037 was last edited at
17:20. [0038](0038-quiet-asks-for-a-value.md) was written at 17:53, in response
to something review found, and implemented in the same branch. The task file's
`Out of scope` said, and still says at the moment of archiving:

> **Changing the JSON envelope, the exit codes, or `--quiet`.** `--quiet` already
> emits bare ids and is the right answer for a caller who wants one field; it
> does not change.

`--quiet` changed. Rounds two, three and four reviewed a diff against a
specification that contradicted it, in the one place a reviewer looks to find out
whether something is in scope. The reviewer had no way to tell whether the
`--quiet` commits were the task overreaching or the task being wrong.

Nothing prevented the fix. [0033](0033-implementation-lands-through-review.md) §1
puts `tasks/` on main precisely so a task can be corrected without touching the
branch, and the correction here is one line. It was not made because the
implementer knew about 0038 and could not see the reviewer not knowing. That is
the same blindness §2 exists to route around, arriving one level up: the
implementer cannot review their own diff, and they also cannot notice their own
specification going stale.

## Decision

### 1. A decision that changes what the branch does is in the task before the next round

When review produces a new decision, or the implementer writes one mid-branch,
the task file gains what the reviewer needs to measure the diff: the decision's
number, and what it now puts in scope. It is a direct commit to main
([0033](0033-implementation-lands-through-review.md) §1), and it precedes the
next review round rather than following the merge.

A decision that changes nothing about what the branch builds does not need this.
[0040](0040-a-review-finding-names-a-class.md) was written from #15 and changed
how findings are answered, not what the diff had to contain.

### 2. A contradicted sentence is corrected, not annotated

If the task says a thing does not change and it now changes, the sentence goes.
Leaving it with a note beside it produces a specification that says both, which
is worse than one that says the wrong thing: a reader cannot tell which half is
current. The task is not a record and has no history to protect until it is
archived ([0032](0032-decisions-are-append-only.md) §5).

### 3. Scope discovered while implementing is scope

The same commit rule covers a class that turns out wider than the plan. If a
search for the general form of a finding
([0040](0040-a-review-finding-names-a-class.md) §1) turns up files the task's
`Scope` does not list, the list gains them before the next round, with what the
search was. A reviewer reading a diff that touches a file the task never
mentioned cannot distinguish thoroughness from scope creep, and should not have
to guess.

## Out of scope (deferred)

- **Moving `tasks/` into the branch.** It would make the task and the diff
  atomic, and [0033](0033-implementation-lands-through-review.md) §1 already
  refused it: `tasks/README.md` in every branch guarantees a conflict between any
  two parallel tasks. The cost of this record is a commit to main, which is
  cheaper.
- **A template field for it.** The correction goes wherever the stale sentence
  is. A dedicated section would collect the ones that are easy to write and leave
  the contradictions in place.
- **Re-reviewing #15.** It merged, 0038 is recorded, and the behaviour is what
  both records say. Nothing is open.

## Consequences

- The archive-time correction ([0032](0032-decisions-are-append-only.md) §5)
  stops carrying the whole load. Task 0037's outcome notes run to forty lines
  because every mid-flight change arrived at the end at once, which is where they
  are least useful: after the reviewer has finished.
- A task file is edited more often, and still expires at merge. It is the working
  specification, not a record, and this record does not make it one.
- The first task under this rule is 0038, whose `Scope` gained
  `.github/workflows/release.yml` and `README.md` under §3 before its review
  began.
