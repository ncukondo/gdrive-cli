# 0048: A staging guard refuses the class, not the two spellings

Date: 2026-08-06
Status: accepted — extends [0001](0001-development-process.md), [0047](0047-rules-are-executed.md) §1

## Context

[0001](0001-development-process.md) asks for commits that are "frequent and
small; specific `git add <file>` (never `git add -A`/`.`)". Read as a rule it is
about deliberate staging. Read as a list it is two spellings, and
[0047](0047-rules-are-executed.md) §1 has just turned it into a script, where the
difference stops being academic.

The review of pull request #23 ran seven commands through that script. All seven
passed:

```
git add -u        git add --update      git commit -a -m x
git commit -am x  git stage -A          git -C . add -A       git add *
```

Two of those are holes in a tokenizer — `git -C . add -A` and `git stage -A` are
`git add -A` with a word in front. The rest are not. `git add -u` and
`git commit -a` stage every tracked modification without naming one, which is
the thing 0001 asks not to happen, and neither appears in its parenthesis. The
review stopped at seven and said so; it was not a census.

A guard that answers a list is worse than no guard in one specific way. It
reports the rule as enforced, so the next reader stops checking, while the
routes it does not cover stay open and are not visibly open.
[0040](0040-a-review-finding-names-a-class.md) §1 says a finding names a class
and the list is only its symptoms; the same is true of what a guard is built
from.

## Decision

### 1. What is refused is staging the caller did not name

The rule is not a set of flags. **A command may not add to the index anything the
caller did not name as a path.** Every route to that is refused, whichever binary
and whichever spelling reaches it — `git add` with `-A`, `--all`, `-u`,
`--update`, `.` or a glob the shell expands; `git stage` in any of those forms;
`git commit` with `-a` or `-a` folded into a cluster like `-am`; and any of the
above behind `git -C <dir>` or another global option.

A pathspec after `--` is a path, so a file genuinely named `-A` still commits.

### 2. The list of spellings is an implementation detail, expected to be incomplete

§1 is the rule. What a script matches is its current approximation, and a
spelling nobody has thought of getting through is a defect in the script rather
than a permission. This matters because the alternative reading — that whatever
the guard allows is allowed — is how a list becomes the rule, which is what §1
exists to prevent.

So a new spelling is fixed by a commit, not by a decision. This record is the
last one about staging.

### 3. `git commit -a` is inside the rule, and 0001's parenthesis was not

The parenthesis names two spellings of `git add` and says nothing about
`git commit`. Reading that as permission requires believing 0001 cared which
binary performed the staging rather than whether it was deliberate, which nothing
in the record supports and which its own words — "frequent and small" — argue
against. `git commit -am` is the fastest way to commit work you have not looked
at, and that is the failure 0001 is about.

This is stated because it is the one place where §1 is wider than the sentence it
comes from, and a reader who notices should find the reason here rather than in a
regular expression.

## Out of scope (deferred)

- **A guard on `git commit --no-verify` itself.** [0047](0047-rules-are-executed.md)
  §2 makes that a person's tool deliberately; a guard on it would be a guard on
  the bypass, which is the same mistake one level up. Will not be done.
- **Shell-level interception.** The guard reads a command string before it runs.
  A command constructed at runtime, or a script that stages, is out of its reach,
  and closing that would mean instrumenting git rather than reading a string.
  Not wanted ([0042](0042-deferred-work-is-an-issue.md) §2).
- **A `pre-commit` check that the staged set was named.** Nothing at commit time
  can tell a deliberate `git add src/a.ts src/b.ts` from `git add -u` that
  happened to catch the same two files, which is why §1 is enforced before the
  command runs and not after.

## Consequences

- `scripts/guard-bash.ts` matches on the class rather than on 0001's two
  spellings, and its tests carry the seven commands the #23 review found plus
  whichever others are added later. The header says §2 out loud, so a reader does
  not take the matcher for the rule.
- An agent that wanted `git commit -am` writes two commands. That is the cost,
  and it is the behaviour 0001 asked for in the first place.
- This is the second record in two days written because a rule stated as a list
  was executed as a list — after [0040](0040-a-review-finding-names-a-class.md),
  which said the same thing about a review's findings. The pattern is worth
  naming: a list is what a rule looks like when nobody has had to be precise
  about it yet, and turning it into a script is exactly the moment that stops
  being free.
