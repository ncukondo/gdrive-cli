# 0055: A name this CLI cannot address afterwards is refused, everywhere

Date: 2026-08-06
Status: accepted — extends [0054](0054-a-copy-keeps-its-name.md) §3

## Context

[0054](0054-a-copy-keeps-its-name.md) §3 refuses a `cp` that would leave two
files with one name in one folder, because Drive permits it and this CLI cannot
address the result. Reviewing the branch that implemented it, and the `rename`
branch beside it, showed the rule was written one command too narrowly — twice
over.

`gdrive rename "Reports/Notes" "Budget"` with `Reports/Budget` already there
succeeds. Afterwards `gdrive info "Reports/Budget"` answers `INVALID_ARGS` —
*Ambiguous path segment* ([resolve-path.ts](../src/lib/resolve-path.ts)) — so
**neither** file is reachable by path. That is 0054 §3's harm exactly, produced
by a different verb.

And `rename` is not the second instance, it is one of many. `mkdir`, `upload`,
`ln --name`, `cp --name` and every `create` can each produce the same pair. So
can `cp` itself, with `--name` set to the name the source already has, which
0054 §3's letter permits because it says "without `--name`".

A second finding from the same review is the same defect wearing different
clothes. `gdrive rename X " Notes "` stores a name with its spaces, and
`resolve-path.ts` trims each path segment before matching, so the file is
immediately unreachable by the name it was just given. A `/` in a name does the
same thing, by splitting the segment.

The common shape is not "duplicates are bad". It is that **this CLI hands a file
a name and then cannot find it by that name**, and says nothing at the moment it
happens.

[0050](0050-the-index-is-what-is-guarded.md) is about this pattern rather than
about any of these commands: a round fixes the instance it was shown and leaves
the other members of the class. 0054 §3 was that round. This is the class.

## Decision

### 1. A name that cannot address the file it names is refused

Any command that gives a file a name — `rename`, `mkdir`, `upload`, `cp`, `ln`,
and each `create` — refuses a name whose owner this CLI could not then find by
path. Two cases:

- **The name is already taken by a sibling.** The destination folder already
  holds a file with that name, so a path naming it becomes ambiguous.
- **The name cannot survive a path.** It differs from itself after the trimming
  `resolve-path.ts` applies to every segment, or it contains the separator that
  splits one.

The error is `INVALID_ARGS`, it names the collision or the character, and it
names what to pass instead. Nothing is created or changed.

`--name` is not an exemption. 0054 §3 said "without `--name`" because `cp`'s
default name was the only one in view; a caller who passes the colliding name
deliberately has still asked for something this CLI cannot address.

### 2. It is checked before anything is written, not after

A refusal after a create is worthless — the file exists and the caller has to
undo it. Every one of these commands already knows its destination folder before
it writes, so the check is a query against that folder, and it costs the command
that pays it one round trip.

`rename` pays two, because it must learn the file's parent first. That is the
price of the guarantee and it is not a hot path.

### 3. Drive's own tolerance is not adopted

Drive permits duplicate names and the Drive UI is usable with them, because it
addresses files by id and shows you a list. This CLI offers paths as a first-class
way to name a file ([0019](0019-shared-drive-paths.md)), and a path is the only
addressing an agent
can construct without having seen the file. A duplicate that Drive shrugs at is
a file this CLI has lost.

Where a caller genuinely wants two files alike, the answer is two distinct names,
which is what §1's error asks for.

## Consequences

- Several commands gain a failure they did not have. Each is discoverable at the
  moment it happens, with the remedy in the message, rather than as an
  `INVALID_ARGS` from an unrelated command later.
- [0014](0014-pre-1.0-compatibility.md) applies: this changes behaviour before
  1.0, so the release notes carry it and say that a distinct name is the fix.
- 0054 §3 is subsumed. Its `cp`-shaped rule becomes one instance of §1, including
  the `--name` case its wording had let through.
- A folder listing and a path now agree about what is in a folder, which nothing
  guaranteed before.

## Out of scope (will not be done)

- **A `--force` that permits an unaddressable name.** It would reintroduce the
  state §1 exists to prevent, and every intent it might serve is expressible by
  choosing a name. If someone needs a duplicate for a reason nobody has thought
  of yet, they still have `-f json` and the ids.
- **Repairing the duplicates an account already holds.** Nothing here scans for
  them, and a command that renamed files it did not create would be a worse idea
  than the state it cleans up. `gdrive rename` is available for anyone who finds
  one.
