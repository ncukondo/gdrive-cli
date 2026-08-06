# 0049: The directory is the index, so the index is deleted

Date: 2026-08-06
Status: accepted — revises [0032](0032-decisions-are-append-only.md) §4, extends [0047](0047-rules-are-executed.md) §3

## Context

[0032](0032-decisions-are-append-only.md) §4 made `decisions/README.md`'s table
the map for reading this directory, and its Consequences made that table
load-bearing on one stated ground:

> The index in `README.md` becomes load-bearing. It is **the only place** a
> relationship between two decisions is visible at a glance, so a new decision is
> not finished until its row is there.

That ground is false, and was false when it was written. Every relationship is
declared in the record that has it, so the whole map is one command:

```console
$ grep -h '^Status:' decisions/*.md
```

The table has 48 rows and the directory has 48 files. Deriving that list is `ls`.
Deriving the relationships is the line above. Of the file's 96 lines, 52 are the
table, 22 are the sibling-repository section that root `CLAUDE.md` already
carries in full, and 20 are conventions.

It has drifted in both halves that could. The format line named two `Status`
verbs while [0046](0046-replace-as-text-keeps-its-reach.md), the newest record in
the directory, used a third. Five rows — 0025, 0026, 0028, 0030 and 0031 — assert
a relationship their records never declared, so the only place `0031 revises
0007` is written down is a file that is not a record. That is the reverse of what
§4 intended: instead of the index making a record's relationship visible, the
index became the sole holder of it, in a file that [0032](0032-decisions-are-append-only.md)
§6 classes as freely editable description.

[0047](0047-rules-are-executed.md) §3 forbids exactly this shape — "an inventory
that has to be maintained is a living SPEC in a smaller box" — and
`decisions/CLAUDE.md`, written under that rule, says "do not write a `what` … a
record that carries one has created a copy somebody must maintain". Both were
written into this directory while the 48-row copy sat beside them. The rule was
applied to the new file and not to the old one.

## Decision

### 1. `decisions/README.md` is deleted

Not reduced to a signpost. A file that survives as a stub is a place to put one
more useful thing, and every line this record removes was once one more useful
thing. The obligation §4 created — "a new decision is not finished until its row
is there" — ends with the file.

`ls decisions/` is the list. `grep -h '^Status:' decisions/*.md` is the map.
`head -1 decisions/*.md` is the table of contents, and unlike the table it cannot
be wrong, because it reads the records.

### 2. A relationship is declared in the record and nowhere else

The `Status` line is where a record says what it does to an earlier one, and
after this there is no second place for it to be written. The five rows above are
the argument: a relationship recorded outside the record is a relationship the
record cannot be trusted about, and no rule said which one wins.

This does not reach back. 0025, 0026, 0028, 0030 and 0031 keep their bare
`Status: accepted`, because [0032](0032-decisions-are-append-only.md) §3 forbids
the edit that would fix them and §1 has always said the code decides what is
true. What is lost is five editorial observations about records that shipped
years of commits ago.

### 3. The conventions move to `decisions/CLAUDE.md`

The format of a record, the verbs and what each means, and the instruction to
read from the highest number down are rules for whoever writes a record here.
`CLAUDE.md` is loaded when a file in this directory is edited; `README.md` was
read when somebody thought to open it. Moving them is
[0047](0047-rules-are-executed.md) §1 applied to prose rather than to a script:
put the rule where it is read at the moment it applies.

### 4. The forty summaries are lost, and that is the price

Forty of the 48 rows carried a description written independently of the record's
own title, and several say more than the title does. They cannot be moved into
the records they describe, because those records are frozen
([0032](0032-decisions-are-append-only.md) §3). Deleting the table destroys them.

This is the real cost of this record and it is accepted rather than argued away.
What replaces them is `head -1 decisions/*.md` — coarser, and always true. The
reason a summary was wanted was to survey the directory without opening 48 files,
and a title list does that at a lower resolution and at no maintenance cost. A
scan that is slightly worse and cannot go stale beats one that is better until
somebody forgets.

## Out of scope (deferred)

- **Repairing `decisions/0002`'s pointer**, and the several archived tasks that
  point here. [0032](0032-decisions-are-append-only.md) §3's exception would
  permit it, but the destination is root `CLAUDE.md`, one level up, where anyone
  following the pointer will land anyway. Editing frozen records to chase a moved
  file is the maintenance obligation 0032 removed. Will not be done.
- **A generated index.** It would be a build step and a new failure mode, which
  is what [0035](0035-docs-are-downstream.md)'s `Out of scope` refused for the
  same shape of problem. `ls` and `grep` are already the generator, run on demand.
- **`tasks/README.md`.** It holds a plan — work in flight, with dependencies and
  status — which is state, not an inventory of files, and nothing derives it.
  It stays.

## Consequences

- `scripts/lint-records.ts` loses `checkIndexRow`, and the corpus test loses the
  case that ran it. Both were written to enforce this index; a guard whose
  subject is deleted goes with it. That is the second time in a week that
  executing a rule has been how its defect was found — the first was
  [0048](0048-staging-refuses-a-class.md).
- `decisions/CLAUDE.md` grows by the four rules §3 moves, and stops pointing at
  `README.md`'s format line for the verb list. Root `CLAUDE.md`'s two pointers
  become pointers to the directory.
- A reader arriving at `decisions/` on GitHub now sees a file list and no prose.
  That is the affordance being given up. The entry point for this repository is
  root `CLAUDE.md`, which is where every path into this directory already starts.
- This directory now holds records and one guide, and nothing that describes its
  own contents. Whether that generalises to `tasks/` is answered above: it does
  not, because a plan is not a description of the files beside it.
