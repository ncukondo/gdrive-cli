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
  replaces, and whose `Status` names the relationship: `revises` narrows or
  contradicts, `extends` adds without contradicting. The new file carries the
  pointer; the old one gains nothing, including a back-pointer
  ([`0032`](0032-decisions-are-append-only.md) §3). A commit hook and a
  `PreToolUse` hook both refuse the edit, but knowing this before you reach for
  one is what saves the work.
- **Do not write a `what`.** A command table, a flag list, an output shape or a
  dependency list belongs to `docs/` and the code, which are the only things that
  have to stay true. A record that carries one has created a copy somebody must
  maintain ([`0032`](0032-decisions-are-append-only.md) §3,
  [`0047`](0047-rules-are-executed.md) §3). Records 0004 and 0008–0011 carry
  command tables; they are frozen history, not a pattern to follow.
- **Every `Out of scope (deferred)` entry names a GitHub issue or says plainly
  that the work will not be done.** A description of work in a document that
  freezes, with no way to ask later whether it happened, is the third thing this
  rule exists to prevent. Most deferrals should be disowned, and that is a real
  answer ([`0042`](0042-deferred-work-is-an-issue.md) §2).
- **A record is dated prose, not a specification.** It is true of the moment it
  was written and makes no claim about today. Where it and the code disagree, the
  code wins ([`0032`](0032-decisions-are-append-only.md) §1–§2) — so a `Context`
  section is never a source for a claim about how the software behaves now.
