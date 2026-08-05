# tests/

Conventions that hold while you edit anything here, including the unit tests
that live beside their source under `src/`.

- **A test asserts what the program does, never what it is made of.** Given
  these inputs, this output; given this state, this change. Not which functions
  exist, not what a file contains, not how something is spelled
  ([`0037`](../decisions/0037-tests-assert-behaviour.md) §1).
- **A rule about form is tested through its consequence.** "No renderer aligns"
  is not "no file calls `padEnd`". Its consequence is the **field round trip** —
  split a rendered row on the separator and get back exactly the fields that went
  in, which a padded field fails for every alignment scheme. Row independence,
  where widening one field changes that row alone, is worth asserting beside it
  but is the weaker of the two: constant-width padding is row-independent and
  slips through. The question to ask of a proposed test: _can this fail when the
  program is wrong, and pass when it is right?_
  ([`0037`](../decisions/0037-tests-assert-behaviour.md) §2 for the rule, §3 for
  where a form rule goes instead, and
  [`0039`](../decisions/0039-what-0036-and-0037-got-wrong.md) §2, which measured
  0037's own example and found it insufficient. Read down from the highest
  number — including when the record you are quoting is days old.)
- **Output correctness is asserted at the renderer, as a property.** Every type
  is followed by a separator; every field that is present is shown. A property
  holds for inputs nobody thought of, which is what the defects that produced
  this rule had in common ([`0035`](../decisions/0035-docs-are-downstream.md) §1).
- **Nothing under `docs/` or `README.md` is a fixture.** No test may require
  either to contain a particular string. They are downstream and free to be
  reworded ([`0035`](../decisions/0035-docs-are-downstream.md) §2).
- **Inject rather than reach out.** The filesystem goes through `FsAdapter`;
  Drive, Docs, Sheets and OAuth clients are constructor arguments to the
  `lib/*-api.ts` wrappers; stdin is passed in. Production wires the real thing
  and a test passes a fake ([`0012`](../decisions/0012-testing-strategy.md)).
- **A fake is shared from `tests/helpers/`.** The first task needing one creates
  it there and later tasks import it, so parallel worktrees cannot disagree about
  what the API looks like ([`0012`](../decisions/0012-testing-strategy.md)).
- **E2E's subject is the boundary with Google** — which requests are accepted,
  what a returned field means, which error arrives. Not output correctness, which
  belongs to the renderer above ([`0043`](../decisions/0043-e2e-runs-before-push.md) §5).
- **When E2E fails, fix the implementation.** Do not add a mock to bypass it, do
  not adjust the expectation to match broken behaviour, do not skip or delete the
  test. A fake can only confirm what its author believed the API does; this is
  Google contradicting them ([`0012`](../decisions/0012-testing-strategy.md),
  "E2E policy (CRITICAL)").
