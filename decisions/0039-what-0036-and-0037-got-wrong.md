# 0039: Two claims in 0036 and 0037 were never measured

Date: 2026-08-03
Status: accepted — revises [0036](0036-machine-format-by-default.md) and
[0037](0037-tests-assert-behaviour.md)

## Context

[0035](0035-docs-are-downstream.md), [0036](0036-machine-format-by-default.md)
and [0037](0037-tests-assert-behaviour.md) were each written after finding a
claim that nobody had checked. `CLAUDE.md`'s Releasing step 1 now forbids
sourcing a changelog claim from a decision's `Context`, because four false
statements in 0.8.0's first draft came from one.

Review of pull request #15 found a fifth, and its source was 0036's own
`Context`. Both errors below are in decisions written today, by the same author
who wrote the rule about not trusting them.

## Decision

### 1. 0036's `U+4DC0` example is false; its conclusion holds on other evidence

0036's Context says Unicode Annex #11 calls U+4DC0 two columns while
`Bun.stringWidth` and `string-width@5` call it one. Measured:

| character | Annex #11 | `string-width@5.1.2` | `Bun.stringWidth` |
| --- | --- | --- | --- |
| `䷀` U+4DC0 | `N` — one column | 1 | 1 |
| `🟰` U+1F7F0 | `W` — two columns | **1** | **2** |

U+4DC0 is where all three *agree*. The disagreement is real but it is U+1F7F0:
`string-width@5`, the version already in this project's dependency closure, is
stale against a standard that Bun tracks. The chain that produced the wrong
example is the finding, not the example: #14's review asserted the range from a
file it had open, #14's author repeated it, 0036's Context repeated that, and
`CHANGELOG.md` quoted 0036 — four hops, no measurement.

0036 §1 and §2 are unaffected. What they rest on is that no oracle can be
trusted across versions and terminals, and U+1F7F0 shows that inside one
dependency tree.

### 2. 0037's row-independence property does not catch constant-width padding

0037 §2 offers "a row's rendering does not depend on the other rows" as the
behavioural form of "no renderer aligns", and claims it "fails for any alignment
scheme". It does not. `padEnd` to a constant width is row-independent: widening
one field changes that row alone. Review confirmed it by restoring the previous
renderers one at a time — four of six left the property green.

The property that does catch padding is the **field round trip**: split a
rendered row on the separator and get back exactly the fields that went in. A
padded field comes back with its padding, so the round trip fails for every
alignment scheme, constant or data-dependent. Row independence stays worth
asserting — it catches the data-dependent kind directly and cheaply — but it is
the weaker of the two and must not be described as sufficient.

0037 §1 and §3 are unaffected.

### 3. An illustration inside a decision is a claim

Both errors are examples, offered to make a principle concrete, and neither was
run. An example is what a reader remembers and what the next document quotes, so
it carries more weight than the prose around it, not less. `CLAUDE.md`'s rule
about not sourcing claims from a `Context` is the symptom; this is the cause.

## Out of scope (deferred)

- **Auditing every example in `decisions/`.** Two are corrected because review
  found them. A sweep has no reader, and 0032 §1 already says the code decides
  when a record and the code disagree.
- **Replacing `string-width`.** It is a transitive dependency, not a direct one,
  and nothing in this project calls it.

## Consequences

- `CHANGELOG.md`'s 0.8.0 entry must lose the U+4DC0 sentence. It is the fifth
  false claim traced to a decision's `Context`, and the first where the author of
  the rule was the source.
- The suites keep both properties, with the round trip named as the one that
  guards [0036](0036-machine-format-by-default.md) §2 and row independence as a
  supplement.
- Two decisions written hours ago needed correcting by measurement, which is the
  argument for [0032](0032-decisions-are-append-only.md) rather than against it:
  the record is a dated account, and the correction is a new number rather than a
  quiet edit to a file someone has already read.
