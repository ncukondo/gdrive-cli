# 0050: What is guarded is putting a change into the index, not the word "add"

Date: 2026-08-06
Status: accepted — revises [0048](0048-staging-refuses-a-class.md) §1

## Context

[0048](0048-staging-refuses-a-class.md) §1 was written to stop a rule being read
as a list of spellings. It says:

> **A command may not add to the index anything the caller did not name as a
> path.**

Review of pull request #23 found that sentence being read as a list of one. In a
throwaway repository with three tracked files:

```console
$ git rm -r --cached .
$ git status --short
D  a.txt
D  b.txt
D  sub/d.txt
```

One command, one pathspec, and every tracked file staged for deletion. The guard
0048 produced passes it, because `git rm` does not *add*.

The failure it opens is worse than the one 0048 closed. An accidental
`git add -A` puts a stray file in a commit. An accidental
`git rm -r --cached .` produces a commit that untracks the repository, and
`git rm -r --cached .` is not exotic — it is the usual way to make a changed
`.gitignore` take effect.

What is worth naming is the shape rather than the verb. 0048 exists because
[0001](0001-development-process.md)'s parenthesis — "never `git add -A`/`.`" —
was implemented as its two spellings, and 0048 §2 says out loud that its own list
of spellings is an approximation. It did not say the same about its own
*sentence*, and so the sentence became the rule one level up. A rule stated in
words has a boundary wherever its words stop, and somebody will build to that
boundary.

## Decision

### 1. The rule is about putting a change into the index

**A command may not put into the index a change the caller did not name.**
Adding a file is one such change; staging its deletion is another; a
`git commit -a` that sweeps up both is a third. Which git subcommand performs it
is not the question, and neither is the direction of the change.

This replaces 0048 §1's "add", which named the instance in front of its author
rather than the class.

### 2. Taking a change *out* of the index is not this rule

`git reset`, `git restore --staged` and `git rm --cached` used to *unstage* a
file are the reverse operation, and the reverse operation is how a mistake is
undone. Guarding it would make the guard the thing you cannot escape from, which
is the failure [0043](0043-e2e-runs-before-push.md) §3 describes and which
[0047](0047-rules-are-executed.md) §2 makes acute, since an agent has no bypass.

The line is what ends up staged. `git rm -r --cached .` reaches §1 not because it
says `--cached` but because it leaves a deletion of every tracked file staged.
`git reset .` leaves nothing staged and is untouched.

### 3. A false refusal is a defect of the same weight as a hole

0048 §2 said a spelling that gets through is a defect in the script. It did not
say the converse, and the converse is at least as costly here: 0047 §2 gives the
bypass to a person and withholds it from an agent, so a command wrongly refused
is a wall, not an inconvenience. Three review rounds on #23 produced holes and
false refusals in roughly equal numbers, and the false refusals were the ones
that would have stopped work — one of them refused a commit whose *message*
quoted `git add -A`, which the commits implementing this rule do constantly.

Both directions are defects in the script. Neither is a reason to widen or
narrow the rule.

## Out of scope (deferred)

- **Commands that destroy work without touching the index.** `git checkout -- .`
  and `git restore .` discard the working tree, which is a different hazard with
  a different answer, and 0001's subject is what goes into a commit. Not filed
  ([0042](0042-deferred-work-is-an-issue.md) §2): nobody has hit it.
- **`git stash`, `git clean`.** Same reasoning. Will not be done here.
- **Re-litigating the enforcement boundary.** [0048](0048-staging-refuses-a-class.md)
  §2 stands unchanged and now covers this record too: the matcher is an
  approximation, a spelling that gets through is a defect in the script, and a
  new spelling is fixed by a commit rather than by a decision. §1 above is what
  the matcher approximates; it is not itself a list.

## Consequences

- `scripts/guard-bash.ts` asks its question of `git rm` as well as `git add`,
  `git stage` and `git commit`, and the test file gains `git rm -r .` and
  `git rm -r --cached .` alongside `git rm src/gone.ts`, which names a path and
  passes.
- This is the third record in three days written because a rule was implemented
  as the words it happened to use — after
  [0040](0040-a-review-finding-names-a-class.md) about a review's findings and
  [0048](0048-staging-refuses-a-class.md) about staging. The pattern is not that
  the authors were careless. It is that a sentence is the only form a rule has
  before somebody builds to it, and building to it is what exposes where the
  sentence stopped. That is an argument for executing rules early, not for
  writing them more carefully.
- §3 gives the review of a guard an explicit second axis. Every round of #23
  found holes because it was asked for holes; the false refusals surfaced only
  once a reviewer thought to look. A brief that asks for one direction gets one
  direction.
