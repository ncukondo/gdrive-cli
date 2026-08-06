# 0056: `mv` belongs to the rule, and a path can lose a name three more ways

Date: 2026-08-06
Status: accepted — extends [0055](0055-a-name-has-to-be-addressable.md) §1

## Context

[0055](0055-a-name-has-to-be-addressable.md) was written to stop a rule being
fixed one command at a time. Implementing it found that it had itself been drawn
one command too narrow, and its two cases were three short.

**`mv`.** §1 enumerates "`rename`, `mkdir`, `upload`, `cp`, `ln`, and each
`create`" — every command that *gives* a file a name. `mv` gives none, and it was
excluded on that reading. But `gdrive mv Inbox/Notes Reports`, with
`Reports/Notes` already there, produces §1's pair exactly, and afterwards
`resolve-path.ts` answers *Ambiguous path segment* for **both** — including the
file that was already in `Reports` and was never touched. "It moves rather than
duplicates" is true of the file and irrelevant to the rule, which is about two
files with one name in one folder.

**The trimming sentence in §1 is wrong.** It says a name is unaddressable when it
"differs from itself after the trimming `resolve-path.ts` applies to every
segment". That function trims the *whole argument* and then splits it. Measured:
`Reports/ Notes` finds the file, `Reports/Notes ` does not, ` Notes` does not.
So only the first segment loses leading whitespace and only the last loses
trailing — which means a **trailing** space is always fatal, because a file's own
name is always the last segment of the path naming it, and a **leading** space is
fatal only when the file is named as the first segment. The refusal 0055 asks for
is right; the mechanism it describes is not.

**Three more ways a name escapes a path**, all measured against the real
resolver:

- A file called `root`, `/`, or the empty string in My Drive's root. The argument
  resolves to the root folder and never reaches the file.
- A file whose name is id-shaped — 20 or more characters of `[A-Za-z0-9_-]` with
  no slash. `looksLikeId` hands the argument to Drive as an id, which is not this
  file's id.
- A file whose name begins with `drive:`. It is parsed as a shared-drive path
  ([0019](0019-shared-drive-paths.md)).

Each is a name this CLI gives and then cannot find. That is 0055's whole subject,
and its "two cases" did not reach them.

## Decision

### 1. `mv` applies the sibling case, and only that one

A move into a folder that already holds a file of that name is `INVALID_ARGS`,
on the same terms as a copy into one. `mv` has no `--name`, so the message names
[`rename`](0052-rename.md) as the way to arrive with a different one.

It does **not** apply the unpathable case. A file whose existing name a path
cannot hold is no worse for being moved, and refusing would strand it where it
is — the rule exists to keep files reachable, not to trap them. Moving a file
into the folder it is already in stays the no-op it was.

### 2. "Cannot survive a path" means all five ways, not two

The second case of 0055 §1 covers a name that leading or trailing whitespace
would lose, a name holding the path separator, a name that is one of the root's
spellings, a name Drive would read as an id, and a name beginning with the
shared-drive prefix.

The list is not the interesting part and will not stay complete on its own. What
holds it together is the test: **a name is refused when passing it back to
`resolvePath`, in the folder it now lives in, would not return this file.** A
sixth spelling added to the resolver is a sixth entry here, and whoever adds one
owns both.

### 3. The refusal is checked against the resolver, not against a description

0055 §1 described a mechanism instead of naming the function, and the description
was wrong within a day. The check asks the same code a path walk asks — one
segment's worth of it — so "a sibling" and "what a path segment matches" cannot
drift apart.

## Consequences

- `mv` gains a failure it did not have, and `0055`'s release-note obligation
  under [0014](0014-pre-1.0-compatibility.md) covers it.
- Every command in the class pays one listing; `rename` and `mv` pay a lookup
  first, to learn the folder they are asking about.
- 0055 §1's enumeration of verbs and of cases should be read through this record.
  Its principle is unchanged, and it is the reason both gaps were found: the
  branch that implements a rule is where the rule's edges become visible.

## Consequences for the next rule written this way

0055 exists because 0054 §3 was written about `cp` when it was about a class. It
then made the same mistake one level up: it enumerated the commands it could see
and the two failures it had met, and both lists were short. The instance-to-class
move is not one step, and a record that takes it should say what the class *is* —
0055 §3's "a duplicate that Drive shrugs at is a file this CLI has lost" — rather
than trusting the enumeration under it to be complete. §2 above is an attempt at
that: a test anyone can apply to a case nobody has met yet.
