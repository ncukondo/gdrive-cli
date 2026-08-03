# Tasks

One file per unit of work, created from [`_template.md`](_template.md). A task
decides what to build while there is no code to read, so it expires when its code
lands: move it to [`archive/`](archive/) (keep the filename) in the commit after
its pull request merges, correcting it once on the way out if the implementation
diverged ([`decisions/0032`](../decisions/0032-decisions-are-append-only.md) §5).

Rules (see [`decisions/0001`](../decisions/0001-development-process.md),
[`0032`](../decisions/0032-decisions-are-append-only.md),
[`0033`](../decisions/0033-implementation-lands-through-review.md)):

- Work **TDD-first**: the task file lists the failing tests to write before
  implementation. A task is done when its acceptance criteria are checked and
  `bun run test` / `bun run typecheck` pass.
- Each task declares `Depends on` and `Parallel`. Parallel-safe tasks have
  disjoint file scopes and can run in separate `git worktree`s.
- Don't restate decisions — link to `decisions/NNNN-*.md`. If work needs a
  decision change, record a **new** decision first; never edit a committed one.
- Implementation (`src/`, `tests/`, `docs/`, `package.json`) lands on a
  `task/00NN-slug` branch through a pull request, reviewed by an agent holding no
  implementation context. `decisions/` and `tasks/` commit straight to main.
- Docs (`docs/`, `README.md`) updates implied by a task are part of its DoD.

Before starting, read `decisions/0013-architecture.md` (source-tree map +
command-registration contract) and `decisions/0012-testing-strategy.md`
(fs/client injection + E2E policy). Rows below are grouped by parallel group,
**not strict task number** — always start from the top row and honor
`Depends on`. Sibling reference repos live at `../gcal-cli` and
`../yaml-form-cli` (see `decisions/README.md`).

## Current plan

| Task | Depends on | Parallel group | Status |
| ---- | ---------- | -------------- | ------ |
| [0001 Project setup & tooling](archive/0001-project-setup.md) | — | — | done |
| [0002 Output & error core](archive/0002-output-and-errors.md) | 0001 | A | done |
| [0003 Config (TOML) & discovery](archive/0003-config.md) | 0001 | A | done |
| [0004 OAuth + multi-account auth](archive/0004-auth-multi-account.md) | 0002, 0003 | — | done |
| [0005 Account commands](archive/0005-account-commands.md) | 0004 | — | done |
| [0006 Drive API wrapper & path resolution](archive/0006-drive-api.md) | 0004 | — | done |
| [0007 Drive read commands (ls/search/info/download)](archive/0007-drive-read.md) | 0006 | B | done |
| [0008 Drive write commands (upload/mkdir/mv/cp/rm)](archive/0008-drive-write.md) | 0006 | B | done |
| [0009 Docs commands](archive/0009-docs.md) | 0006 | C | done |
| [0010 Sheets commands](archive/0010-sheets.md) | 0006 | C | done |
| [0014 Share/permissions commands](archive/0014-share.md) | 0006 | C | done |
| [0011 `init` command](archive/0011-init.md) | 0003, 0004 | — | done |
| [0012 Distribution, installer & `upgrade`](archive/0012-distribution.md) | 0007, 0008, 0009, 0010, 0014 | — | done |
| [0013 README & user docs](archive/0013-docs-site.md) | 0012 | — | done |
| [0016 Remove type assertions](archive/0016-remove-type-assertions.md) | — | — | done |
| [0015 Upgrade googleapis (130 → 173)](archive/0015-googleapis-upgrade.md) | 0016 | — | done |
| [0017 Shared drive support](archive/0017-shared-drive-support.md) | — | — | done |
| [0018 Shared-drive review fixes](archive/0018-shared-drive-review-fixes.md) | 0017 | — | done |
| [0019 `PERMISSION_DENIED` for a role-denied 403](archive/0019-permission-denied-error-code.md) | — | — | done |
| [0020 `share add` grants the shared-drive roles](archive/0020-shared-drive-roles.md) | — | — | done |
| [0021 `drive:<name>/<path>` addressing](archive/0021-shared-drive-paths.md) | — | — | done |
| [0022 `info` names a shared drive root](archive/0022-drive-root-name.md) | — | — | done |
| [0023 `docs` writes take Markdown by default](archive/0023-markdown-writes.md) | — | — | done |
| [0024 `insert --before` / `--after <marker>`](archive/0024-insert-at-marker.md) | 0023 | — | done |
| [0025 List numbering & links](archive/0025-list-numbering-and-links.md) | 0023 | — | done |
| [0026 Soft line breaks](archive/0026-soft-line-breaks.md) | 0025 | — | done |
| [0027 Shortcuts resolve by argument role](0027-shortcuts.md) | — | — | todo |
| [0028 `gdrive ln` creates a shortcut](0028-ln.md) | 0027 | — | todo |
| [0029 `forms read` / `forms responses`](0029-forms-read.md) | — | D | todo |
| [0030 `forms write` / `forms create`](0030-forms-write.md) | 0029 | D | todo |
| [0031 `slides read`](0031-slides-read.md) | 0029 | E | todo |
| [0032 `slides write` / `slides create`](0032-slides-write.md) | 0031, 0030 | E | todo |
| [0033 `cp -r` copies a folder tree](0033-recursive-copy.md) | 0027 | — | todo |

## Parallelism notes

- **Group A** (0002 / 0003): disjoint scopes — `lib/output.ts` + `types/` vs
  `lib/config.ts`. Run in parallel worktrees after 0001 lands.
- **Group B** (0007 / 0008): Drive read vs write commands; share `lib/api.ts`
  as a *dependency* (0006) but own different `commands/*.ts` files.
- **Group C** (0009 / 0010 / 0014): Docs vs Sheets vs Share — disjoint command
  trees (`commands/docs/*` vs `commands/sheets/*` vs `commands/share/*`). 0009
  and 0010 add their own `lib/*-api.ts`; 0014 extends `lib/api.ts` (0006) with
  permission methods, so it merges after 0006 and coordinates with 0007/0008 on
  `lib/api.ts` edits.
- **Group D** (0029 / 0030): Forms. Disjoint from the shortcut tasks — a new
  `commands/forms/` tree and a new `lib/forms-api.ts`, touching no file 0027 or
  0028 owns. Within the group they are *sequential*, not parallel: 0030 extends
  the projection and the client port 0029 creates. 0029 may run in a worktree
  beside 0027; their only shared points are the append-only registration in
  `src/commands/index.ts` and `package.json`.
- **Group E** (0031 / 0032): Slides. Same shape as group D and disjoint from it
  (`commands/slides/`, `lib/slides-api.ts`), so D and E can run side by side.
  Sequential within the group. 0031 needs 0029 only for the `yaml` dependency
  and the document conventions; 0032 also waits on 0030, which builds the
  planner, the plan output, `--dry-run` and `PRUNE_REQUIRED` that 0032 reuses
  rather than reinvents.

After v0.1.0 shipped, the plan continues with maintenance work. 0016 removed
the type assertions that would let a googleapis bump break silently, so it ran
before 0015 (decision 0015). 0017 fixed shared-drive access (issue #1) under
decision 0016, and 0018 closed the gaps its review found. 0019 then split a
role-denied 403 out of `AUTH_REQUIRED` (issue #3, decision 0017) — a
consequence of 0016 §1, since shared-drive requests only started reaching
Drive's permission checks once `supportsAllDrives` was set.
0020 widened `share add` to the shared-drive roles (issue #4, decision 0018,
which revises 0011), 0021 added `drive:<name>/<path>` addressing (issue #5,
decision 0019, which supersedes 0016 §3), and 0022 made `info` report a drive
root's real name (issue #6, decision 0020). That closes the shared-drive
follow-ups opened after v0.4.0.

0023 and 0024 both come from issue #7 and both extend 0009. 0023 is **done**:
Markdown is now the format on the write side too — a Markdown table arrives as
a Docs table instead of a line of pipes — and the write default flipped to match
`read` (decision 0021; breaking, allowed by 0014). Its manual pass against a
real account is what found the index bugs a fake client cannot show, and 0021 §5
records the approach that failed.

0024 then moved marker-relative positioning out of the `replace` workaround and
into `insert --before/--after` (decision 0022), reusing 0023's marker search so
the two commands cannot disagree on what "found" means. That closes issue #7.

0025 and 0026 are the follow-ups v0.6.0 left: transcribing a real document
found that a numbered document is silently renumbered and that `<https://…>`
stays literal (issue #8, decision 0023), and measuring that turned up a second,
independent bug — `read` emits a raw `U+000B` where the document has a line
break inside a paragraph (issue #9, decision 0024). Both decisions are written
from measurements against Drive's native `text/markdown` import and the Docs
API, which is what 0021 §4 asks for; the numbers are reachable through the API
even though `startNumber` is read-only, and 0023 §2 records the three-step
sequence that gets there. The two tasks run in order because they change the
same parser and the same round-trip test. Both are **done**, and both found the
same shape of thing in implementation: a rule the decision stated correctly but
did not follow through to its arithmetic or its guards. Those corrections are in
each task's outcome notes and, where they change what the record claims, back in
the decision. Issues #8 and #9 are closed by them.

0027 opens a new line of work, from a survey of what the CLI does not handle
rather than from an issue. Drive shortcuts were never modelled at all, so a path
through a folder shortcut is `NOT_FOUND` today and `docs read` on a shortcut
404s. Decision 0025 settles the part that is not mechanical — *which* arguments
follow a shortcut — with a three-role table (container / content / entry) that
keeps `rm` and `share` pointed at the shortcut itself. The task touches
`lib/api.ts`, `lib/resolve-path.ts` and all five command registries at once, so
it does not parallelize with anything else that takes a file argument.

0028 adds `gdrive ln` (decision 0026), which 0025 held back until reading was
settled. It runs after 0027 rather than beside it because it is the first
consumer of `resolveTarget` and of the `shortcut` file type, and because writing
it against a half-built resolver would bake in whichever shape 0027 happened to
land first. Between them the two tasks close the shortcut gap.

0029 and 0030 take the second hole the same survey found: Google Forms, the one
Workspace type the CLI cannot touch at all. Checking the API first paid off —
`forms.get`, `forms.responses.list` and `forms.batchUpdate` all accept the
`drive` scope 0005 already requests, so Forms needs no re-consent and 0005 is
only annotated, not revised. Decision 0027 makes a form one YAML document,
identical in both directions, because the primary consumer is an agent that
should edit a node rather than drive a dozen per-question flags; 0028 applies
that document back by matching on item id, which is what keeps a question's
`questionId` — and therefore its responses — attached across an edit. The two
tasks are group D and run in order: 0030 extends the projection and the client
port 0029 creates. `yaml` joins the runtime dependencies for this and nothing
else (0002).

0031 and 0032 close the last hole, Slides, and it needed a different answer than
Forms did. A Doc is a stream and a form is a list, but a slide is a canvas —
every element carries a transform in EMU and the element array is z-order, not
reading order — so the first question was what to do about geometry. Decision
0029 answers it by not modelling any: a slide is a layout plus its placeholders,
because the API's own `createSlide` path never needs a coordinate either. What
that cannot describe — a hand-placed text box, an image, a table — is listed
read-only under `elements`, which differs from how 0027 hides an unmodelled form
item in `raw`, and for a stated reason: text outside a placeholder is common
enough that burying it would make the ordinary deck read as empty. 0030 then
reuses 0028 wholesale and adds only what Slides forces: rewriting a placeholder
loses its inline formatting, so only changed ones are rewritten and the plan
warns; and editing a read-only `elements` entry is an error rather than a silent
no-op, which is 0028 §3's lesson arriving through a different door.

Every Workspace type the CLI names now has a planned read and write path. What
is uneven is fidelity, not coverage.

0033 comes from the same survey but is not about a file type. `files.copy` does
not copy folders and Drive has no server-side recursive copy, so today an agent
that wants a folder copied runs the walk itself — roughly `2F + N` process
launches, with no record of progress when it dies half-way. Decision 0031 moves
the walk into the CLI and spends most of its length on what happens when it
stops: the run halts at the first non-transient failure, and 0007's error
envelope gains an optional `data` so `success: false` no longer implies nothing
happened. That envelope change is general, not a `cp -r` accommodation, and it
is the third time in this stretch the same principle has decided a design — a
caller must be able to tell what actually happened, not infer it from an exit
code. 0033 depends on 0027 because the walk copies a shortcut without following
it, which needs `shortcut` to be a type first.

Order of first delivery to a usable CLI: 0001 → 0002/0003 → 0004 → 0006 →
0007 (list/read is the first useful surface), then fan out group B (0008) and
group C (0009 / 0010 / 0014). Finish with 0005 / 0011 (account/init), then
0012 (distribution) and 0013 (docs).

### Shared integration points (coordinate across worktrees)

- `src/commands/index.ts` — every command task appends one import + one
  `registerXxx(program)` call (append-only; see `decisions/0013`).
- `tests/helpers/` — shared fakes (fs, Drive/Docs/Sheets clients, OAuth). The
  first task needing a fake creates it here; later tasks import it
  (`decisions/0012`).
- `src/lib/api.ts` — created by 0006, extended by 0014 (permission methods) and
  used by 0007/0008. Coordinate edits; keep additions method-scoped.
