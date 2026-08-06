# decisions/

Design and process decisions, one file per topic, numbered in the order they
were made. They are the source of truth for *why*; the *what* lives in the code
and in [`docs/`](../docs/). Conventions for writing and reading one:

- **The directory is the index** ([`0049`](0049-the-directory-is-the-index.md)).
  There is no summary file, and adding one back is what 0049 deleted. To survey:

  ```sh
  head -1 decisions/0*.md      # every record's title
  awk '/^Status:/{s=$0; while ((getline l)>0 && l!="") s=s" "l; print FILENAME": "s; nextfile}' \
      decisions/0*.md          # every relationship
  ```

  The glob is `0*.md`, not `*.md`, so it does not pick up this file. And a
  `Status` line may wrap onto the next line — 0039's does — which is why the
  second one is not a `grep`. 0049 §1 illustrates both with shorter commands that
  drop a relationship and print this file's heading; it is a dated record and the
  working versions are here.
- **Read from the highest number down.** The current position on a topic is the
  first record that answers, and then the code. No file here is true in
  isolation, and none announces its own obsolescence
  ([`0032`](0032-decisions-are-append-only.md) §4).
- **A record is `Date`, `Status`, `Context`, `Decision`, `Consequences`**, plus
  an `Out of scope (deferred)` section where there is one. `Status` opens with
  `accepted`, and names a relationship after it where there is one. Keep the
  record short; link to others rather than restating them.
- **A committed file is never edited again** — not its `Decision`, not its
  `Context`, not its `Status` line, not a list inside it. A change is a *new*
  number that states its position in full, so it reads without the one it
  replaces, and whose `Status` names the relationship. The new file carries the
  pointer; the old one gains nothing, including a back-pointer
  ([`0032`](0032-decisions-are-append-only.md) §3). Knowing this before you reach
  for the edit is what saves the work.
- **The relationship verbs are what the records use**, not what any one record
  glosses. Today that is `revises` (narrows or contradicts), `extends` (adds
  without contradicting) and `corrects` (fixes a factual claim without changing
  the position taken) — the second command above lists them as they stand. The
  set follows the records rather than leading them: a verb is used by a record
  first, and only then is it one of the verbs.
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
