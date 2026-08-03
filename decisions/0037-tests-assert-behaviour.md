# 0037: A test asserts what the program does, never what it is made of

Date: 2026-08-03
Status: accepted — extends [0035](0035-docs-are-downstream.md)

## Context

[0035](0035-docs-are-downstream.md) removed a test that required a file under
`docs/` to quote what a renderer printed. It was the wrong shape because it
reached downstream: it could not fail on a wrong renderer, only on a reworded
description.

One task later the same error appeared pointing the other way. Task 0037's plan
proposed a test asserting that no file under `src/` contains `padEnd`, to keep
[0036](0036-machine-format-by-default.md) §2 from being undone by someone who
wanted a prettier table. That test reads the source tree. It cannot fail on
output; it fails on spelling. A renderer that aligns by building a string of
spaces and concatenating it passes, and a renderer that calls `padEnd` for
something that is not alignment fails.

Both come from the same impulse: wanting a rule to stay followed, and reaching
for the nearest thing that can be checked mechanically rather than the thing
that matters. The impulse is worth naming because it is strong and it produces
tests that feel like guarantees while guaranteeing nothing.

There is a second reason the impulse misleads here. A decision states a position
at a date; a later decision may revise it, which is the whole mechanism of
[0032](0032-decisions-are-append-only.md) §4. So a decision does not want a test
that makes it permanent. It wants the behaviour it asks for to be verified, and
to be revisable by the same route every other decision is.

## Decision

### 1. A test asserts behaviour

Given these inputs, this output. Given this state, this change. That is the
whole subject. Not which functions exist, not what a file contains, not how
something is spelled, not where a symbol lives.

### 2. A rule about form is tested through its consequence

When a rule constrains how something is built, the test is what that rule buys,
not the rule's own wording. "No renderer aligns" is not "no file calls
`padEnd`". Its consequence is that **a row's rendering does not depend on the
other rows**, and that is a property over output: render a list, render it again
with one name made longer, and every other row must be byte-identical. That
fails for any alignment scheme, including one that never calls `padEnd` — so it
is both stricter than the source-tree check and immune to spelling.

### 3. What has no behavioural consequence is not a test's job

Some rules really are about form: a naming convention, an import direction, a
banned API. Those belong to lint, to types, or to review, all of which are
honest about being about form and none of which claim to be tests. The
distinction is not that one is stronger. It is that a test that inspects form
reports a false subject, and a reader trusts it for something it never checked.

## Out of scope (deferred)

- **Adding a lint rule for the `padEnd` ban.** §3 says that is where such a rule
  would belong; whether this project wants one is a separate question, and
  [0036](0036-machine-format-by-default.md) §2's property is what actually
  matters.
- **Auditing the existing suite for form-shaped assertions.** The two known cases
  are handled. A sweep has no reader until a third appears.

## Consequences

- Task 0037's step 5 becomes a property over rendered output rather than a scan
  of `src/`, and gets stronger for it: it catches alignment however it is built.
- The guard against [0036](0036-machine-format-by-default.md) §2 being undone is
  weaker in one way and stronger in another. Someone who deliberately deletes the
  property can align again — but they must delete a test that describes a real
  behaviour, rather than one that reads as housekeeping.
- Together with [0035](0035-docs-are-downstream.md) this fixes the shape of the
  question to ask of any proposed test: *can this fail when the program is wrong,
  and pass when the program is right?* Both rejected tests fail that question in
  opposite directions.
