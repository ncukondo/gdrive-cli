# src/

Conventions that hold while you edit anything here. What files exist is
answered by `ls`; what the CLI does is answered by the code and by `docs/`.
Neither is repeated below ([`0047`](../decisions/0047-rules-are-executed.md) §3).

- **A handler validates, delegates, and emits — in that order.** Parse arguments
  with zod, call into `lib/*`, and print through `lib/output.ts`. Never build a
  JSON envelope by hand ([`0013`](../decisions/0013-architecture.md)).
- **The unit tests beside this source follow
  [`tests/CLAUDE.md`](../tests/CLAUDE.md).** That file does not load when you open
  a `*.test.ts` here, and most of this project's tests are here. Read it before
  writing one.
- **A handler never calls `process.exit`.** It throws `AppError { code }`;
  `src/index.ts` maps the code to an exit code and a format
  ([`0013`](../decisions/0013-architecture.md),
  [`0007`](../decisions/0007-output-and-errors.md)).
- **`commands/index.ts` is the only shared edit outside your own scope**, and it
  is append-only: one import and one `registerXxx(program)` call per command
  area, so parallel worktrees merge mechanically
  ([`0013`](../decisions/0013-architecture.md)).
- **The default output is the machine one.** `-f text` asks for the convenience
  layer; a command whose output _is_ a document emits that document's own format
  ([`0036`](../decisions/0036-machine-format-by-default.md) §1).
- **Nothing computes how wide a string draws**, and text output separates fields
  with a tab and pads nothing. This is the rule most worth understanding before
  you work around it: every available answer to "how wide is this?" disagrees
  with the terminals that have to draw it, so a computed column is a column that
  does not line up, and for a machine reader that is the id running into the
  name. A person who wants columns pipes the output through a formatter
  ([`0036`](../decisions/0036-machine-format-by-default.md) §2–§3).
- **Parse at the edges instead of asserting.** Anything crossing a boundary into
  this program goes through a zod schema, and a closed string set goes through
  `lib/args.ts`. No type assertions anywhere
  ([`0015`](../decisions/0015-no-type-assertions.md)).
