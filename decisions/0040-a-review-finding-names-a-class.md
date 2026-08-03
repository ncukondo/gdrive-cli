# 0040: A review finding names a class, and the list is only its symptoms

Date: 2026-08-03
Status: accepted — extends [0033](0033-implementation-lands-through-review.md)

## Context

[0033](0033-implementation-lands-through-review.md) put a reader with no
implementation context in front of every branch, and it works: three rounds on
pull request #15 found defects the suite and the author could not. What it did
not say is what an implementer owes a finding once it arrives.

Two HIGH findings in that pull request came from the same mistake, and the author
named it themselves:

> Both are me fixing the *instances* on a list instead of the *class* behind it.
> Round one gave me eleven `line` sites and I converted exactly eleven, so
> `rm.ts` stayed broken — in the one command where a forged line asserts a
> deletion. Round one told me a JSON default must not suppress the prompt, and I
> made "was `-f` named" the answer without asking what a prompt actually needs.
> Twice the list became the specification.

The list is easy to satisfy and easy to check, so it displaces the harder
question. It is also produced by someone who was sampling: a reviewer reads until
convinced, then writes down what they found. An enumeration is evidence that a
class exists, not a census of it.

The cost is concrete. `rm.ts` was the fifteenth of fifteen sites, and the one
where a forged confirmation asserts that a file was deleted. Fixing the eleven
named sites left the worst one live through two review rounds.

## Decision

### 1. An implementer answers the class, not the enumeration

A finding is a symptom. Before fixing the instances, state what is wrong in
general, then search for every case — by grep, by type, by whatever makes the
search exhaustive rather than plausible. Report what the search found beyond the
list, including nothing, so the reviewer can see the class was looked for.

Where the general form cannot be searched for, say so. That is a real answer; a
list silently completed is not.

### 2. A reviewer says what it sampled

A finding that enumerates says whether the enumeration is complete. "Fifteen
sites, all of them" and "at least eleven sites, I stopped looking" ask for
different work, and the second is the honest thing to write after reading until
convinced.

### 3. A fix is checked against what the rule is for, not against the finding

`canPrompt` satisfied the finding exactly — a JSON default no longer suppressed
the prompt — and introduced a worse failure, an exit 0 with nothing done, because
nobody asked what a prompt needs. It needs a terminal. The question that catches
this is not "does the finding go away" but "what is this rule for, and does the
fix serve it".

## Out of scope (deferred)

- **A checklist in the review prompt.** §2 is a habit, not a template, and the
  reviewer prompts already vary by task. Turning it into boilerplate would make
  it skimmed.
- **Auditing past merged pull requests for lists that were completed silently.**
  The three earlier tasks were reviewed under the same practice; nothing suggests
  a specific miss, and a sweep has no reader.

## Consequences

- Review rounds get slower and fewer. Answering a class takes longer than
  answering a list, and finds what the next round would have.
- A reviewer's enumeration stops being a contract. That is the point: the
  contract is the class, and both sides now say which one they are describing.
- This is the fourth record this session written because an unverified or
  under-scoped claim reached further than it should have — after
  [0035](0035-docs-are-downstream.md), [0037](0037-tests-assert-behaviour.md) and
  [0039](0039-what-0036-and-0037-got-wrong.md). The pattern is consistent enough
  to state plainly: the cheap answer that satisfies the immediate check is the
  one to distrust.
