# Task 0029: `gdrive forms read` / `forms responses`

Status: todo (move to `tasks/archive/` when done)
Depends on: —
Parallel: yes (worktree-safe) — a new command tree (`commands/forms/*`) and a
new `lib/forms-api.ts`. It touches `src/commands/index.ts` (one append-only
registration) and `package.json`; both are shared integration points, so it can
run alongside 0027/0028 but must merge with them cleanly.

## Goal

A form's structure is readable as a YAML document, and its responses are
readable as a table whose columns are question titles.

## Context

- Decisions: [`0027`](../decisions/0027-forms-document.md) is the
  specification. [`0028`](../decisions/0028-forms-write.md) consumes the same
  schema — read it before fixing the schema's shape, because 0029 is where the
  round trip is either possible or lost.
- No new OAuth scope: `forms.get` and `forms.responses.list` both accept the
  `drive` scope [`0005`](../decisions/0005-auth-and-scopes.md) already requests.
  Do not touch the scope list.
- Also relevant: [`0007`](../decisions/0007-output-and-errors.md) (envelope,
  `--as` conventions), [`0015`](../decisions/0015-no-type-assertions.md)
  (`GeneratedParamChecks` against `forms_v1`),
  [`0021`](../decisions/0021-markdown-writes.md) §3 (the `unsupported`
  reporting channel this reuses), [`0013`](../decisions/0013-architecture.md).
- Prior art in this repo: `lib/sheets-api.ts` + `commands/sheets/read.ts` for
  the `--as table|csv|json` shape; `commands/docs/format.ts` for
  `reportUnsupported`.

## Scope

- `package.json` — add the `yaml` runtime dependency.
- `src/lib/forms-api.ts` — the client port (`forms.get`,
  `forms.responses.list`) and its generated-param checks.
- `src/lib/form-document.ts` — the API resource ⇆ document projection and its
  zod schema. Keep the *to-document* and *from-document* directions in this one
  file so 0030 extends it rather than writing a second projection.
- `src/commands/forms/{index,read,responses}.ts` + tests — new.
- `src/commands/index.ts` — one `registerForms(program)` call (append-only).
- `tests/helpers/` — a Forms client fake.

## Out of scope

- `forms write` / `forms create` — task 0030.
- Response filtering, single-response fetch, quiz grades, `--type form` — all
  deferred in 0027.

## TDD plan

1. **The projection** (`lib/form-document.ts`) — the largest piece; do it first
   and without any API in the picture.
   - **Red** — a raw `Form` with one item of each modelled type projects to the
     document in 0027 §2: `choice` (radio / checkbox / dropdown, including an
     `other` option), `scale` with its labels, `text` with `paragraph`, `date`
     with `include_time` / `include_year`, `time`, `file_upload`, `page_break`,
     `text_item`. Every item carries `id`; every question carries
     `question_id`. An item type the schema does not model becomes
     `type: unsupported` with `raw` holding the API resource verbatim, and is
     counted as an unsupported note.
   - **Green** — implement the projection and the zod schema for it.
   - **Refactor** — one discriminated union keyed on `type`, so 0030's reverse
     direction is a `switch` over the same key, not a second taxonomy.

2. **The client port** (`lib/forms-api.ts`)
   - **Red** — `getForm` requests the form and surfaces a 404 as `NOT_FOUND`
     and a 403 as `PERMISSION_DENIED`
     ([`0017`](../decisions/0017-permission-denied-error-code.md));
     `listResponses` pages through `nextPageToken` and returns every response,
     not just the first page.
   - **Green** — implement, with the params checked against `forms_v1`.

3. **`forms read`**
   - **Red** — text output is the YAML document and parses back to the same
     structure; `-f json` puts the structure itself in `data.form`, not a YAML
     string; quiet prints the form id; a form with an unmodelled item warns once
     on stderr in text mode and carries `unsupported` in JSON; the `<form>`
     argument goes through the same path/id resolution as every other command.
   - **Green** — implement.

4. **`forms responses`**
   - **Red** — with two responses and three questions, `--as table` has one
     column per question titled by its question text plus a `submitted` column;
     `--as csv` quotes correctly; `--as json` keeps checkbox answers as arrays
     while table and csv join them with `; `; a file-upload answer reports file
     ids; two questions with the same title get ` (<question_id>)` appended; a
     question with no answer in a given response is an empty cell; a form with
     no responses prints a header-only table (and an empty array in JSON).
   - **Green** — implement, fetching the form and the responses.
   - **Refactor** — assert that exactly two API calls happen; 0027 §6 states the
     cost, and the test is what keeps the statement true.

5. **Docs**
   - `docs/commands.md` gains a `forms` section: the document schema field by
     field per `type` (0027 §2 delegates the exhaustive list here), `read`,
     `responses`, and the `unsupported` behavior.
   - `README.md` highlights gain a Forms bullet.
   - No decision file is edited ([`0032`](../decisions/0032-decisions-are-append-only.md)).
     0027 already records both the `yaml` dependency and the fact that Forms
     needs no new scope; 0002 and 0005 stay as written.

## Acceptance criteria

- [ ] `gdrive forms read "Surveys/2026" > form.yaml` writes a document that
      round-trips through a YAML parser unchanged
- [ ] `gdrive forms read "Surveys/2026" -f json` carries the structure in
      `data.form`
- [ ] A form containing a video item reads with `type: unsupported` and warns
- [ ] `gdrive forms responses "Surveys/2026"` prints a table headed by question
      titles; `--as csv` and `--as json` agree with it
- [ ] A form with no linked response sheet still returns responses
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` and `README.md` updated, in the same pull request as the
      code ([`0033`](../decisions/0033-implementation-lands-through-review.md) §1)

## Verification

- `bun run test src/lib/form-document.test.ts` — the projection, per item type
- `bun run test src/commands/forms` — both commands, including the call-count
  assertion for `responses`
- Manual, against a real account: build a form in the UI with a radio question,
  a checkbox question, a scale, a paragraph, a section break and a video; submit
  two responses; then `forms read` and `forms responses`. The video item and the
  checkbox joining are the two things a fake cannot prove.
