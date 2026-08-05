# decisions/

Conventions that hold while you write or read a record here. `README.md`'s index
is the map; this is how to move on it.

- **Read from the highest number down.** The current position on a topic is the
  first record that answers, and then the code. No file here is true in
  isolation, and none announces its own obsolescence
  ([`0032`](0032-decisions-are-append-only.md) §4).
- **A committed file is never edited again** — not its `Decision`, not its
  `Context`, not its `Status` line, not a list inside it. A change is a *new*
  number that states its position in full, so it reads without the one it
  replaces, and whose `Status` names the relationship. The new file carries the
  pointer; the old one gains nothing, including a back-pointer
  ([`0032`](0032-decisions-are-append-only.md) §3). Knowing this before you reach
  for the edit is what saves the work.
- **The relationship verbs are what the records use**, not what any one record
  glosses. `README.md`'s format line above the index is where they are listed;
  it currently holds `revises`, `extends` and `corrects`, and it gains one when a
  record needs one — never the other way round.
- **Do not write a `what`.** A command table, a flag list, an output shape or a
  dependency list belongs to `docs/` and the code, which are the only things that
  have to stay true. A record that carries one has created a copy somebody must
  maintain ([`0032`](0032-decisions-are-append-only.md) §3,
  [`0047`](0047-rules-are-executed.md) §3). Some early records carry command
  tables and one carries a source-tree map — 0047's `Out of scope` names which.
  They are frozen history, not a pattern to follow.
- **Every `Out of scope (deferred)` entry names a GitHub issue or says plainly
  that the work will not be done.** A description of work in a document that
  freezes, with no way to ask later whether it happened, is the third thing this
  rule exists to prevent. Most deferrals should be disowned, and that is a real
  answer ([`0042`](0042-deferred-work-is-an-issue.md) §2).
- **A record is dated prose, not a specification.** It is true of the moment it
  was written and makes no claim about today. Where it and the code disagree, the
  code wins ([`0032`](0032-decisions-are-append-only.md) §1–§2) — so a `Context`
  section is never a source for a claim about how the software behaves now.
