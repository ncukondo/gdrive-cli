# 0045: A rule that can be executed is not left in prose

Date: 2026-08-06
Status: accepted — extends [0032](0032-decisions-are-append-only.md) §6, [0033](0033-implementation-lands-through-review.md) §1

## Context

[0043](0043-e2e-runs-before-push.md) §1 moved one rule out of prose and into a
`pre-push` hook, and said why in a sentence that was about E2E but is not
specific to it:

> A checklist read by a tired person after the review rounds are over is not a
> gate, and calling it one has now failed twice.

Every other process rule in this project is still that checklist. `CLAUDE.md`
and the process records hold them: commit with a specific path and never
`git add -A` (0001), never edit a committed decision (0032 §3), give a new
decision a row in the index (0032 §4), keep implementation off main (0033 §1),
rebase before requesting review (0044 §1), file or disown a deferral (0042 §2).
Each is written once, read by whoever thinks to read it, and checked by nothing.

The failures are already on the record and they are all the same shape. 0027 and
0029 merged with `Manual, against a real account — NOT DONE` in the file, which
is what 0043 was written about. Task 0037's `runFlow` deferral was archived
eight minutes after it was written, which is what 0042 was written about. Pull
request #16's reviewer measured a five-file branch against a three-file plan,
which is what 0044 was written about. Three records in one week, each closing one
instance of "the document said so and nobody did it".

A fourth instance is visible in the entry document itself. `scripts/lint-casts.ts`
enforces [0015](0015-no-type-assertions.md) and has run in
`.github/workflows/ci.yml` since 2026-07-24. `CLAUDE.md`'s `## Commands` block
has been edited seven times since that date — four of them on 2026-08-04, tuning
the wording of the test lines directly above it — and has never listed
`lint:casts`. A reader of that block sees `lint`, `format`, `format:check` and
`typecheck`, and has no way to learn that a fifth check exists and runs in CI.
Nobody omitted it on purpose; the block is a copy of `package.json`, and a copy
is kept true by remembering, seven times in a row, to copy again.

That block is permitted by [0032](0032-decisions-are-append-only.md) §6, which
classes `CLAUDE.md` as description that is "edited freely to keep matching" the
code. Permission is not the problem. 0032's own Context named the mechanism, and
it does not care whether editing is allowed:

> a record which *may* be edited *must* be edited to stay true, and each place
> needing an edit is a place the edit can be missed.

So there are two costs being paid in the same place. A rule that only a person
can execute gets skipped. A fact that is copied gets stale. Both have now been
measured here, and both have a cheaper form.

## Decision

### 1. A rule that a script can check is a script

Where a rule's violation can be decided from the repository — a path, a branch
name, a staged file list, the presence of a line — it is implemented as a script
under `scripts/`, tested like `scripts/changelog.ts` is, and invoked by a hook.
Prose describing that rule stops being the thing that enforces it, and the
record that introduced the rule stays where it is: this changes how a rule is
kept, not why it exists.

Two hooks call the same script, because they bind different people.

- A **git hook** (`.husky/`) binds everyone who commits or pushes, including a
  person and including a future contributor. It fires after the fact — the edit
  is already written — which is right for anything cheap to undo.
- A **Claude Code hook** (`.claude/settings.json`, `PreToolUse`) binds only an
  agent working in this repository, and fires *before* the action. That timing
  is worth having for the rules where the damage is the edit itself.

Neither replaces the other and neither is optional. 0043's Consequences already
settled the shape of that argument — "build it whole and cut it if it hurts, not
to make the expensive half optional in advance" — and named the two tasks where
an optional gate stopped running.

### 2. An agent has no escape hatch; a person has `--no-verify`

[0032](0032-decisions-are-append-only.md) §3 allows a typo or a broken link to
be fixed in a committed decision. That exception is real and rare, and it is the
only reason the append-only guard ever needs to be bypassed.

It is given to the person, not to the agent. A git hook is bypassed with
`git commit --no-verify`, which is deliberate, visible in the shell, and
available to anyone who has decided the exception applies. The `PreToolUse` hook
has no equivalent and gains none: an agent that can talk itself past a guard is
not guarded, and the exception it would be reaching for is one a person can
perform in a second.

This is the answer to [0043](0043-e2e-runs-before-push.md) §3's warning about
gates that teach everyone to reach for `--no-verify`. The warning holds for a
gate that fires wrongly and often. It does not hold for one whose bypass is
reserved for a case that has arisen twice in forty-five records.

### 3. A directory's `CLAUDE.md` holds no inventory

The rules a script cannot check are placed where they are read at the moment
they apply: a `CLAUDE.md` in the directory the rule governs, which Claude Code
loads when it touches a file there.

Two conditions, and both must hold. The content is **invariant under adding a
file** — a contract, a convention, a prohibition, never a list of what exists.
And it is **needed while editing in that directory** — not background, not
history, not a summary of a decision that reads fine from `decisions/`.

The first condition is 0032 §3's sentence applied to a smaller box, which is
what these files are:

> An inventory that has to be maintained is a living SPEC in a smaller box.

A source tree map, a command table, a flag list and a dependency list are all
inventories, and `ls`, `--help`, `docs/` and `package.json` each answer one of
them from the thing itself. A directory `CLAUDE.md` that carries one has moved
the staleness rather than removed it. This is also why these files stay short:
a long one is nearly always an inventory that has not been recognised as one.

### 4. An entry document does not copy a source it can point at

`CLAUDE.md` loses its `## Commands` and `## Tech Stack` blocks. `package.json`
holds both, exactly, and is read by the tooling rather than by memory. What
survives is what `package.json` cannot say: which scripts are the ones a person
runs, and that `changelog` takes a version.

The paragraph below the block — what `pre-push` does, what
`GDRIVE_CLI_E2E_FOLDER` changes, what stays a manual pass — is not a copy of
anything and stays. That is the test to apply: if the source could be edited
without this text becoming wrong, it is not a copy.

### 5. What is executed lands through review

[0033](0033-implementation-lands-through-review.md) §1 enumerated what needs a
branch and a pull request and did not mention `scripts/`, which has been going
through one anyway since #13. `.husky/` and `.claude/` join that list explicitly,
for the reason `.github/` is already on it: they run on everyone's machine, and
a broken one stops work that has nothing to do with the change.

A directory's `CLAUDE.md` lands the same way. It is read by an agent doing
implementation work, so it belongs with the code it describes, and a claim in it
is exactly the kind of thing §2 of 0033 sends a fresh reader to check.

The chicken-and-egg is real and small: a pull request that breaks `pre-commit`
cannot be committed to without `--no-verify`, which §2 leaves available for
precisely that.

## Out of scope (deferred)

- **Retrofitting the rules in 0001 to 0031.** §1 binds the rules named in its own
  Context and any written after. Auditing forty-four records for further
  candidates is the sweep [0042](0042-deferred-work-is-an-issue.md) §2 says to
  disown rather than file, and the ones worth having were the ones that had
  already failed visibly.
- **The `what` still sitting in 0004, 0008 to 0011 and 0013.** Command tables,
  output shapes and the source tree map remain in those records.
  [0032](0032-decisions-are-append-only.md) §3 forbids editing them and its `Out
  of scope` already refused the reconciliation. §3 here binds what is written
  from now on. Not filed: nobody wants it.
- **Enforcing the rules an agent's brief carries.** The reviewer reads the plan
  by ref ([0044](0044-the-reviewer-gets-the-current-plan.md) §2), does not share
  a working tree (§3), and names a class rather than a symptom
  ([0040](0040-a-review-finding-names-a-class.md)). A reviewer runs outside this
  repository's hooks, so none of it is reachable from here. It stays in the brief
  that starts the review.
- **Branch protection on main.** Still what
  [0033](0033-implementation-lands-through-review.md)'s `Out of scope` says: the
  direct commits §1 depends on would be blocked by it. §1's landing-path check is
  a local hook, not a server-side gate, and is bypassable by design.

## Consequences

- `pre-commit` gains checks and therefore time. How much is not known until they
  are written, and the order is 0043's: build them whole, measure, then cut what
  hurts. Cutting is a later record if it changes a rule and a commit if it only
  changes a script.
- `.claude/settings.json` enters the repository, so this project's agent
  configuration becomes reviewable and shared rather than per-machine. Nothing
  currently in `~/.claude/` is project-specific, so nothing moves.
- A rule can now be in three places — a script, a directory `CLAUDE.md`, or a
  record — and choosing wrongly is the new failure mode. §1 and §3 are the test.
  When a rule is checkable and gets written into prose anyway, the prose is the
  bug.
- The rules that reach only an agent are now visibly separate from the rules that
  reach everyone. `.husky/` and CI bind a person; `.claude/` and a directory
  `CLAUDE.md` do not. Anything that must hold for a human contributor cannot live
  only in the second pair.
- `CLAUDE.md` becomes shorter and stops being a place where a fact about the
  build can be found. That is the intended loss: the fact was wrong.
