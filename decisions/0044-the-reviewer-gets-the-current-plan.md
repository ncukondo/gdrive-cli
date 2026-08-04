# 0044: The branch is rebased before review, and the plan is read by ref

Date: 2026-08-04
Status: accepted — extends [0041](0041-the-task-is-current-during-review.md)

## Context

[0041](0041-the-task-is-current-during-review.md) fixed one way a reviewer ends
up measuring a diff against a stale specification: the task was not updated when
a decision landed mid-branch. Pull request #16 found a second way, which no
amount of updating the task can reach.

GitHub records a pull request's base commit when it is opened. #16 was opened at
`b23c6d3`, and `tasks/` commits to main after a branch is cut — which is not an
accident but the arrangement
[0033](0033-implementation-lands-through-review.md) §1 chose deliberately, to
keep `tasks/README.md` out of every branch. So `gh pr diff 16` replayed those
main-only commits as if the branch had made them, and handed the reviewer
`tasks/0038-test-runs-once.md` in its pre-widening form: a `Scope` listing three
files, against a branch that touched five.

`git diff main...HEAD` showed the truth throughout — five implementation files,
no `tasks/` change. The reviewer had no reason to prefer it, and did what
[0033](0033-implementation-lands-through-review.md) §2 says: take the diff and
the task file. It read a plan that did not mention `release.yml` or `README.md`,
watched the branch touch both, and could not tell thoroughness from scope creep.
What resolved it was the implementer telling the reviewer out of band, through
exactly the channel §2 exists to close.

The exposure is structural. Every task under this process commits its plan to
main after its branch exists, so every pull request that stays open long enough
for main to move carries a phantom copy of its own specification, frozen at
whatever it said when the branch was cut.

## Decision

### 1. The branch is rebased on main before review is requested

`git rebase main && git push --force-with-lease`. This moves the stored base
forward and empties the phantom, so the diff a reviewer is handed contains the
branch's own work and nothing else. It also satisfies
[0033](0033-implementation-lands-through-review.md) §1's rebase merge early,
where a conflict is cheap to resolve and nobody is waiting.

### 2. The reviewer reads the plan from main, by ref

`git show main:tasks/00NN-*.md`, not the working tree and not the diff. §1 is not
sufficient on its own: a review takes rounds, main keeps moving during them, and
[0041](0041-the-task-is-current-during-review.md) §1 requires the task to be
updated between rounds — which is main moving again, on purpose. Reading by ref
is what makes the rule hold without a rebase per round.

The reviewer's brief says so. This is one sentence, not a checklist
([0040](0040-a-review-finding-names-a-class.md) "Out of scope").

### 3. A working tree is not shared with a reviewer

#16's reviewer ran `git checkout` in the tree the implementer was working in,
which silently reverted the implementer's files to the branch's version. Nothing
was lost, but the two processes were editing one tree. A reviewer that needs a
checkout takes a `git worktree`; a reviewer that only needs to read takes
`git show <ref>:<path>`.

## Out of scope (deferred)

- **Automating the rebase.** A workflow that rebases open branches when main
  moves would rewrite a branch under a reviewer mid-round, which is worse than
  the problem. Not wanted ([0042](0042-deferred-work-is-an-issue.md) §2).
- **Moving `tasks/` onto the branch.** It would make the diff self-contained and
  reintroduce the conflict between parallel tasks that
  [0033](0033-implementation-lands-through-review.md) §1 refused. Refused again
  here for the same reason.
- **Whether `gh pr diff` should be preferred to `git diff main...HEAD` at all.**
  §1 makes them agree, which is cheaper than deciding.

## Consequences

- One command before requesting review, and a habit of reading the plan by ref.
  Both are cheap; the failure they prevent cost a full review round on #16.
- This is the fifth process record in two days written because an artifact
  reached a reader in a state its author did not intend — after
  [0035](0035-docs-are-downstream.md), [0039](0039-what-0036-and-0037-got-wrong.md),
  [0040](0040-a-review-finding-names-a-class.md) and
  [0041](0041-the-task-is-current-during-review.md). The difference here is that
  the review process found a defect in itself, which is the first time that has
  happened.
- A reviewer's report can now be trusted about scope. Before this, a finding of
  "the branch touches a file the task does not list" was as likely to be an
  artifact of the tooling as a real overreach.
