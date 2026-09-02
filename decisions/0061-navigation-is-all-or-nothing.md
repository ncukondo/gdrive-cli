# 0061: A copied question keeps all of its navigation or none

Date: 2026-09-02
Status: accepted — extends [0028](0028-forms-write.md) §1

## Context

`forms create --file` cannot copy an ordinary branching form.

[0028](0028-forms-write.md)'s create path strips `goToSectionId` from every
option, because it is an **item id** naming an item of the form the document was
read from — pull request #26's review found that, and it is right. What it did
not know is that the Forms API also requires navigation to be all-or-nothing
within one option list:

```
Invalid Options, Either all or no options should be go to enabled
```

`goToAction` is a constant rather than an id, so it travels. That is what breaks
the copy. In the Forms editor, turning on "go to section based on answer" gives
*every* option a target, and the ones that simply continue get
`goToAction: NEXT_SECTION`. Stripping only the ids leaves that list half
navigated, and the API refuses the whole `batchUpdate` — so a form that reads
fine cannot be recreated at all (issue #37).

Measured while writing the live suite (task 0045). `tests/e2e/forms.test.ts`'s
copy fixture branches *uniformly* for this reason and says so; no red test was
written, because it would have blocked every push while the gap was open.

## Decision

### 1. Dropping any of an option list's navigation drops all of it

When a `goToSectionId` has to go, `goToAction` goes with it, across the whole
option list. The result is a question with no branching, which the API accepts.

An option list that navigates *only* with `goToAction` — every answer continuing
to the next section, or every answer submitting — carries no id, is already
uniform, and is left alone. This is not "strip navigation from copies"; it is
"never leave a list half navigated".

### 2. The question is created, not skipped

Issue #37 proposes the alternative — refuse the item and report it through the
skipped channel, as `fileUploadQuestion` is — and it is the wrong analogy. A
`fileUploadQuestion` **cannot be created at all**, so reporting it is the only
thing left to do. A branching question can be created; only its branching
cannot. Dropping the question would lose the wording, the options and the
required flag along with the flow, and `docs/commands.md` already promises the
opposite: a copy is a copy of the *questions*, not of the form.

### 3. The loss is reported, through the channel that already reports it

`skipped` gains nothing new. The create path already pushes
`kind: "option.goToSectionId"` when it strips a target, and that stays the name:
`goToAction` leaves as a consequence of the id leaving, not as an independent
loss, and renaming the field would break a consumer reading `kind` for no gain
a reader gets.

What has to be said out loud is in `docs/`: the **section structure itself** is
not carried either, so a copied form's flow is rebuilt by hand whichever way
this went. That was true before this record and stays true after it. This
decision is about the copy succeeding, not about the copy being complete.

## Consequences

- An ordinary branching form can be copied. Before this, it could not be copied
  at all — the API refused the entire batch, so the failure was total rather
  than partial.
- A form whose questions branch only with `goToAction` copies with its
  navigation intact, which was already true and is now true on purpose.
- `tests/e2e/forms.test.ts`'s copy fixture can stop branching uniformly, and the
  comment explaining why it had to goes with it. A live case for the mixed form
  is what proves this, because the constraint being worked around is the API's
  and no fake knows it — which is [0012](0012-testing-strategy.md)'s argument in
  the one place it has already been paid for once.
