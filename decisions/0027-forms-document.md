# 0027: A form is one YAML document; `forms read` and `forms responses`

Date: 2026-08-03
Status: accepted

## Context

Google Forms is the one Workspace file type this CLI cannot touch at all. `ls`
reports a form as `type: file`, `download` refuses it because Drive's export
does not serve Forms, and there is no command that reads a question or a
response. For a tool whose primary consumer is an AI agent, the responses are
the most valuable data in a Drive account and the only ones currently
unreachable.

Two findings shape the design.

**No new OAuth scope is needed.** `forms.get`, `forms.responses.list` and
`forms.batchUpdate` each accept `https://www.googleapis.com/auth/drive`, which
[0005](0005-auth-and-scopes.md) already requests. Forms costs no re-consent and
no revision to 0005 — unlike a `drive.file`-scoped tool, the full `drive` scope
0005 chose for a different reason turns out to cover the whole Forms API.

**Responses are keyed by `questionId`, not by question text.** A `FormResponse`
carries `answers` as a map from question id to an answer value. Nothing in the
response says what was asked. Read on its own, the API's own shape is unusable
by a human or an agent.

## Decision

### 1. The form is a single YAML document, identical on both sides

`gdrive forms read <form>` emits a YAML document describing the whole form, and
[0028](0028-forms-write.md)'s write side accepts the same document back. There
are no per-question commands: an agent that wants to change question 3 reads the
form, edits one node, and writes it back.

YAML rather than JSON because the document is the one place in this CLI where
multi-line prose is a first-class value — a question's title and description are
often paragraphs, and JSON renders them as a single line of `\n` escapes that
neither a human nor a diff can read. The cost is a runtime dependency, `yaml`,
the fifth in the project; [0002](0002-tech-stack.md) is updated to list it.

This is deliberately *not* the choice the rest of the CLI makes. `-f json` stays
the machine interface for every command including this one (§5), so the YAML is
an additional surface, not a replacement.

### 2. The document is a flat projection, not the API resource

The API nests a choice question's options at
`items[].questionItem.question.choiceQuestion.options[].value`, behind two
unions. The document flattens that to a `type` and its fields:

```yaml
title: 2026 Engagement survey
description: |
  Takes about five minutes.
  Answers are anonymous.
revision_id: "00000007"
items:
  - id: 1a2b3c4d
    question_id: 5e6f7g8h
    type: choice
    choice_type: radio
    title: Which team are you on?
    required: true
    options: [Sales, Engineering, {value: Other, other: true}]

  - id: 2b3c4d5e
    question_id: 6f7g8h9i
    type: scale
    title: How satisfied are you?
    required: true
    low: 1
    high: 5
    low_label: Not at all
    high_label: Very

  - id: 3c4d5e6f
    type: unsupported
    raw: {videoItem: {video: {youtubeUri: "https://…"}}}
```

`type` names exactly one API shape, so the flattening is reversible — which is
what makes one document serve both directions. The exhaustive field list per
`type` belongs in `docs/`, not here; this record fixes only that the projection
is flat, that `type` is the discriminator, and that the subset is defined as
*exactly what `read` emits*, the same contract [0021](0021-markdown-writes.md)
§1 set for Markdown.

### 3. Ids are carried, and `question_id` is the join key

Every item carries `id` (the API's `itemId`); every question also carries
`question_id`. Both are output-only here and load-bearing elsewhere: `id` is how
[0028](0028-forms-write.md) decides update-versus-create, and `question_id` is
the key `answers` uses, so §6's join has something to join on.

### 4. What the CLI cannot model round-trips untouched

An item whose type the schema does not cover is emitted as `type: unsupported`
with the API resource verbatim under `raw`. It is not dropped and not
approximated.

The reason is the write side: an agent that reads a form, edits one question,
and writes it back must not silently destroy a video item it could not parse.
Emitting it as an opaque node makes the round trip lossless without teaching the
schema every corner of the API. `read` also reports the count through the
`unsupported` channel [0021](0021-markdown-writes.md) §3 already defines — one
line on stderr in text mode, a field in JSON — so a caller learns that the
document is not fully modelled without parsing it.

### 5. `forms read` text is the document; `-f json` is the same structure

Text output is the YAML document itself, ready to redirect to a file. `-f json`
puts *the same structure* in `data.form` as JSON — not the YAML as a string.

An agent on the JSON path therefore never needs a YAML parser to read a form,
and only needs one to write one. `docs read` puts its Markdown in `data.content`
as a string because Markdown is prose; a form is a data structure, and hiding it
in a string would make `-f json` strictly worse than useless.

### 6. `forms responses` joins with the form and tabulates

```console
$ gdrive forms responses "Surveys/2026 Engagement"
submitted             Which team are you on?  How satisfied are you?
2026-07-01T10:22:00Z  Sales                   4
2026-07-01T11:05:00Z  Engineering             5
```

`forms responses` always fetches the form as well and uses the question titles
as column headers, joining on `question_id`. That is one extra round trip on
every call, unconditionally, and it is the whole value of the command: the
alternative is the API's own output, which names no question.

`--as table|csv|json` follows `sheets read`. A checkbox answer is several
values: `table` and `csv` join them with `; `, `json` keeps the array. A file
upload answer reports the file ids, which are Drive ids `gdrive info` accepts.
Two questions with the same title get ` (<question_id>)` appended to
disambiguate, rather than a silently duplicated column.

The linked response spreadsheet stays reachable — `read` reports
`linked_sheet_id`, and `gdrive sheets read` on it is often what a user wants.
But a form need not have one, and `forms responses` is what works either way.

## Out of scope (deferred)

- **Writing** — `forms write` / `forms create`, [0028](0028-forms-write.md).
- **Response filtering** (`forms.responses.list` takes a timestamp filter) and
  fetching a single response by id. Both are additive once the table exists.
- **Quiz grading data.** `totalScore` and per-answer `grade` are read from the
  API but not projected; a quiz reads as its questions and answers.
- **`--type form` in `ls`/`search`.** It belongs with the `FileType` work in
  [0025](0025-shortcuts.md)'s task, not here.

## Consequences

- `yaml` becomes the project's fifth runtime dependency, and the first format
  besides TOML and JSON the CLI parses. [0002](0002-tech-stack.md) lists it.
- `lib/forms-api.ts` joins `docs-api.ts` and `sheets-api.ts`, with its params
  checked against the generated `forms_v1` types like every other client
  ([0015](0015-no-type-assertions.md)).
- `forms responses` costs two round trips and cannot be made to cost one. That
  is stated here so a later reader does not "optimize" the join away.
- A form's document is only as complete as the schema. §4 keeps that honest
  rather than hidden, but a form built mostly of unmodelled items will read as
  mostly `raw`, and that is the signal to extend the schema.
