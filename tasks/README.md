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
- Implementation lands on a `task/00NN-slug` branch through a pull request,
  reviewed by an agent holding no implementation context; `decisions/` and
  `tasks/` commit straight to main. What counts as implementation is
  [`0033`](../decisions/0033-implementation-lands-through-review.md) §1 as
  widened by [`0047`](../decisions/0047-rules-are-executed.md) §5 — read it
  there. A directory's `CLAUDE.md` is on the reviewed side even though it sits
  in a records directory.
- Docs (`docs/`, `README.md`) updates implied by a task are part of its DoD.
- **A task stays current while it is being reviewed**
  ([`0041`](../decisions/0041-the-task-is-current-during-review.md)): a decision
  made mid-branch, or a scope that turned out wider than the plan, is committed
  here before the next review round. A sentence the branch now contradicts is
  corrected, not annotated.
- **A note below is written to survive its own task.** This file is never
  archived, and nothing in the merge routine revisits its prose. A note that
  describes how the repository behaves today is written in the past tense, or it
  becomes a false present-tense claim the moment the task it describes merges.
  The review of 0038 found the first one.
- **A deferral is tracked or disowned**
  ([`0042`](../decisions/0042-deferred-work-is-an-issue.md)): work left undone at
  archive time either names a GitHub issue or says it will not be done. This
  table holds work in flight; the tracker holds work that is not.

Before starting, read `decisions/0013-architecture.md` (source-tree map +
command-registration contract) and `decisions/0012-testing-strategy.md`
(fs/client injection + E2E policy). Rows below are grouped by parallel group,
**not strict task number** — always start from the top row and honor
`Depends on`. Sibling reference repos live at `../gcal-cli` and
`../yaml-form-cli` (see the root `CLAUDE.md`).

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
| [0027 Shortcuts resolve by argument role](archive/0027-shortcuts.md) | — | — | done |
| [0028 `gdrive ln` creates a shortcut](archive/0028-ln.md) | 0027 | — | done |
| [0029 `forms read` / `forms responses`](archive/0029-forms-read.md) | — | D | done |
| [0030 `forms write` / `forms create`](archive/0030-forms-write.md) | 0029 | D | done |
| [0031 `slides read`](archive/0031-slides-read.md) | 0029 | E | done |
| [0032 `slides write` / `slides create`](archive/0032-slides-write.md) | 0031, 0030 | E | done |
| [0033 `cp -r` copies a folder tree](archive/0033-recursive-copy.md) | 0027 | — | done |
| [0034 What the live verification found](archive/0034-live-verification-fixes.md) | 0027, 0029 | — | done |
| [0035 The release notes carry the breaking changes](archive/0035-release-notes.md) | — | F | done |
| [0036 The table stays a table](archive/0036-renderer-properties.md) | 0034 | F | closed unmerged |
| [0037 The default is machine-readable](archive/0037-machine-format-by-default.md) | 0034 | — | done |
| [0038 `bun run test` runs the suite once](archive/0038-test-runs-once.md) | — | — | done |
| [0039 The first E2E suite, and the hook that runs it](archive/0039-e2e-suite.md) | 0038 | — | done |
| [0040 An insert stops inheriting the formatting next to it](archive/0040-inserted-content-is-default-styled.md) | — | — | done |
| [0041 The rules that can be checked become scripts](archive/0041-rules-are-executed.md) | — | G | done |
| [0042 The rules a script cannot check move to where they are read](archive/0042-rules-are-read-where-they-apply.md) | — | G | done |
| [0043 `gdrive rename`](archive/0043-rename.md) | — | — | done |
| [0044 A name this CLI cannot address is refused](archive/0044-addressable-names.md) | 0033, 0043 | H | done |
| [0045 The live suite reaches the write paths](archive/0045-e2e-write-paths.md) | — | H | done |
| [0046 A `create` that fails leaves nothing in My Drive's root](archive/0046-create-lands-in-its-parent.md) | 0045 | — | done |
| [0047 The Docs port learns about tabs, and `docs tabs` manages them](0047-docs-tabs-port-and-coordinate.md) | — | I | todo |
| [0048 A read covers every tab, and a write names the one it means](0048-docs-read-covers-every-tab.md) | 0047 | I | todo |
| [0049 `gdrive auth` refuses where nobody can read the URL](archive/0049-auth-refuses-without-a-reader.md) | — | J | done |
| [0050 The generated-type guard reaches inside a Drive `requestBody`](archive/0050-the-guard-reaches-inside-a-request-body.md) | — | J | done |
| [0051 A `PRUNE_REQUIRED` refusal carries the plan it refused](archive/0051-a-refusal-carries-its-plan.md) | — | J | done |
| [0052 The e2e exclusion stops depending on the shell](archive/0052-the-e2e-exclusion-leaves-the-shell.md) | — | J | done |
| [0053 A listing says when it stopped early](archive/0053-a-listing-says-when-it-stopped.md) | — | K | done |
| [0054 A copied question keeps all of its navigation or none](archive/0054-navigation-is-all-or-nothing.md) | — | K | done |
| [0055 `gdrive docs delete` removes a range](archive/0055-docs-delete.md) | — | L | done |
| [0056 An `elements` entry's text is writable](archive/0056-an-element-is-writable-by-id.md) | — | L | done |
| [0057 A marker is addressable in a header, footer or footnote](0057-a-marker-is-addressable-anywhere.md) | 0055 | L | todo |

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
- **Group F** (0035 / 0036): disjoint scopes — `.github/workflows/release.yml`
  plus a new root `CHANGELOG.md`, against `commands/file-format.ts` and its
  tests. Neither reads the other's files.
- **Group H** (0044 / 0045): disjoint — 0044 owns `src/commands/` and a new
  naming helper, 0045 owns `tests/e2e/` and nothing else. They meet at one point
  and it is worth knowing: once 0044 lands, a fixture that creates two
  same-named siblings is refused, so an e2e file written against today's
  behaviour can go red for a reason that is not a regression. 0045's fixtures
  should give every object a distinct name from the start.
- **Group G** (0041 / 0042): the two halves of decision 0047, and they share no
  file. 0041 owns `scripts/`, `.husky/`, `.claude/`, `package.json` and
  `ci.yml`; 0042 owns `CLAUDE.md` files and nothing else. Either order of merge
  works: 0042's `decisions/CLAUDE.md` is exempted by name from the landing check
  0041 builds, and until 0041 merges there is no check to satisfy.
- **Group I** (0047 / 0048): Docs tabs, and *sequential* rather than parallel —
  the group letter records that they are one piece of work, not that they can run
  side by side. Both own `lib/docs-api.ts` and `commands/docs/`, and 0048 needs
  0047's coordinate resolver and its `docs tabs add` to build a multi-tab fixture
  at all. The order is chosen so the damaging half closes first: 0047 removes the
  ability to edit an unseen tab, 0048 then widens what a read covers.
- **Group J** (0049 / 0050 / 0051 / 0052): the four open issues that needed no
  new position taken before code. Disjoint by construction — 0049 owns
  `commands/auth.ts`, 0050 owns `lib/google-clients.ts` and `lib/api.ts`'s body
  types, 0051 owns the two planners and a new `lib/prune-refusal.ts`, and 0052
  owns the vitest configs, `package.json`'s `scripts` and `.husky/pre-commit`.
  They meet at one file and it is worth knowing: 0049 and 0051 both edit
  `src/index.ts` — 0049 adds the flow's gate beside `canPrompt`, 0051 makes
  `handleError`'s `quiet` required, and the two hunks are a hundred lines apart.
  Whichever merges second rebases; nothing else about the order matters.

- **Group K** (0053 / 0054): the two open issues that needed a position taken
  first — 0060 and 0061. Disjoint: 0053 owns `lib/api.ts`'s pagination and
  `lib/copy-tree.ts`, 0054 owns `commands/forms/`. 0053 collides with 0050 in
  `lib/api.ts` — different regions of the same file — so whichever lands second
  rebases.

- **Group L** (0055 / 0056 / 0057): the three issues whose answer needed
  designing rather than finding — 0062, 0063 and 0064. 0056 is disjoint from the
  other two (`commands/slides/`) and runs beside either. **0055 and 0057 are
  sequential and share `lib/docs-api.ts`**: 0055 adds a third caller to the
  marker walk and 0057 changes what that walk returns, so doing 0057 first would
  mean building `docs delete` against a range type nothing else used yet.

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

0028, 0030 and 0031 ran side by side in three worktrees and merged together, and
what that batch is worth remembering for is not the parallelism. Each branch
passed its unit suite, its type check and a fresh reviewer, and a live pass
against a real account then found **five defects none of those could reach** —
four of them on 0030's write side. The shape repeated: a fake client accepts any
request its author thought was right, and an unedited round trip builds no
request at all, so a write-side encoding error survives both. `{value, isOther}`
together, an item id copied out of another form through `goToSectionId`, a
`fileUploadQuestion` the API refuses to create, and a form whose Drive name stays
`Untitled form` because `documentTitle` is settable only at creation — that last
one being unfixable after the fact, since nothing here renames a file. 0031's
half was cheaper but the same kind: a real deck showed the second `BODY` of
`TITLE_AND_TWO_COLUMNS` landing among the elements, which is what
[`decisions/0051`](../decisions/0051-elements-holds-placeholders-too.md) answers.

0043 came out of that same stretch, and out of a claim that turned out to be too
strong. The `Untitled form` defect was called unrepairable, which is why it was
fixed before the merge rather than after — and the reason given was that nothing
here renames a file. That much was true; the conclusion was not. Measuring
afterwards showed a Drive rename repairs the part this CLI resolves paths by, and
that only a form's `documentTitle` is genuinely frozen, because for a Doc, a
Sheet and a deck the Drive name and the in-document title are one field.
`decisions/0052` records the four measurements and settles what they raise:
renaming is its own verb rather than a second meaning for `mv`, since Drive
permits two files with one name and `mv` would have to guess, and its argument
takes the entry role so renaming a shortcut renames the shortcut.

Its third section did not survive the day. It had `rename` report, on a form,
that the title in the Forms editor was out of its reach — and `decisions/0053`
withdrew that, because the measurement under it read `documentTitle` the instant
after the Drive rename returned. Read again three seconds later, it has followed.
A form is not the exception the table made it, and the closing section of 0053 is
the part worth carrying forward: a measurement of a *negative* needs a second
observation before it becomes a record, since one read cannot tell "never" from
"not yet".

0032, 0033 and 0043 merged together, and what they are worth remembering for is
what the two-stage check caught. Every branch passed its unit suite, its type
check and a fresh reviewer before either stage ran. The live pass then found the
`Copy of` naming defect and the `Untitled form` one; the reviewers then found
`cp -r /` copying My Drive into itself for ever, a transport failure discarding
the whole progress report, and — in the branch the live pass had cleared — that
an omitted text field silently empties it. Neither stage subsumes the other, and
the order matters less than that both happen.

The `cp -r /` defect is the one to remember. `resolvePath` answers the literal
`root` for `/`, while `parents` carries My Drive's real id, so the cycle guard
compared two strings that could never match. The same branch had already resolved
that alias on the destination side, with a test. A guard is only as good as the
identifiers it compares, and the half that was written second is the half that
was wrong.

0045 answers issue #30, which had been open since the batch before this one and
which every live pass since has made more expensive. Six write-side defects
reached review this year through a full unit suite and were caught by a person
running the CLI by hand; `tests/e2e/` covered Drive, Docs and Sheets and none of
the write paths those defects lived in. The task aims its cases at that class
rather than at coverage — an encoding the API refuses and a fake accepts — and
its manual step is to break one of the six fixes locally and watch the matching
case go red, because a live suite nobody has seen fail is one nobody knows is
wired up.

0044 and 0045 merged together, and between them they closed the loop this
stretch had been running open: 0045 gave the live suite the write paths, and
0044 was then the first branch whose behaviour change could be checked *by* that
suite rather than by a person remembering to. It passed, 43 cases, which is the
first time an answer to "did this break the live behaviour" came from a command
rather than from a pass somebody might skip.

0044 is also the clearest case yet of a review overturning a decision rather
than a line of code. Its first implementation refused any name the resolver
would not read as a single path segment — which is a false refusal for
`Meeting_notes_2026_08` and any other ordinary name of twenty-odd word
characters, in every folder that is not a drive root, with no `--force` to
escape by. The justification in the code was wrong too: the distinction that
matters is only whether the parent *is* a drive root, and that is decidable from
its id. 0056 §2 had already said so; the code had drifted from the record it was
built against, and the review is what noticed.

The last turn of that screw is worth keeping. Told to narrow the rule, the
implementing agent found the instruction self-contradictory — it claimed all
five readings are harmless at a shared drive's root while prescribing a test that
refuses there — and took the test, because **My Drive's own root id has the same
`0A` + 17 shape a shared drive root has** (`0AIhndZ7Jnt6JUk9PVA`). The two cannot
be told apart from an id, so the choice is a false accept at My Drive's root,
where files are lost, or a false refusal at a shared drive's root, narrow and
visible. Measuring beat the instruction.

0046 came out of 0045's review rather than from the survey, and it is where the
two-stage check paid for itself twice over. Writing live tests
for the write paths exposed that all four `create` commands are create-fill-move,
so a fill that fails leaves the file in My Drive's root — outside every sandbox,
with its id lost, on the one path the tests exist for. `tests/e2e/forms.test.ts`
answered it with a rule ("never make a create here fail after the form exists"),
and the reviewer's objection is the useful part: a rule that holds exactly when
the tests are green and fails exactly when they are red is not containment. The
fix is a reordering, and it is worth the task because `.husky/pre-push` runs that
suite on every push.

0047 and 0048 open a line of work from a question rather than from an issue: a
Doc can hold a tree of tabs, and nothing in this repository had ever mentioned
them. Measuring on 2026-08-08 against a four-tab document found the Docs port
reading and writing the first tab throughout, silently — and one thing worse than
silence. **Docs v1's default for an omitted tab differs by request type**: an
omitted `tabId` on a `Location` or a `Range` meant the first tab, while an
omitted `tabsCriteria` on `replaceAllText` meant every tab. `docs-api.ts` omitted
both, so `docs replace` was scoped one way in its Markdown mode and the other
under `--as text`, and the run that measured it reported *Replaced 3 occurrences*
after rewriting two sibling tabs and one nested tab — none of which any command
here could display. `decisions/0058` settles the shape; the split is by layer,
with the damaging half first.

Two things from that measurement are worth carrying past these tasks. **A
single-tab fixture cannot tell "the first tab" from "every tab"**, because for
one tab the two defaults produce the same document — so no fake, and no live test
written before somebody thought of tabs, could have failed on this. The fixture
has to contain the distinction before a test can hold it, which is
`decisions/0012`'s argument arriving at a case it does not name. And
`download --export-as md` had been returning every tab the whole time, so the CLI
already disagreed with itself about how much of a document it read, depending on
which verb was used; a second reader of the same data is where that kind of
disagreement stays hidden longest.

0044 is the class 0054 §3 turned out to be one member of. Reviewing the `cp -r`
and `rename` branches found that `rename` can give a file a name a sibling
already holds, after which `resolve-path.ts` answers `INVALID_ARGS` for *both*
files and neither is reachable by path — and that `mkdir`, `upload`, `ln`,
`cp --name` and every `create` can do the same. A second finding was the same
defect in different clothes: a name with a leading space is stored with it and
then never matches, because path resolution trims each segment. `decisions/0055`
states the shape both share — this CLI hands a file a name and then cannot find
it by that name — and refuses it everywhere rather than at the two places a
review happened to look. That framing is `decisions/0050`'s, and 0054 §3 was the
round it describes.

Two things followed from it. `decisions/0043` gave the live suite a cadence but
`tests/e2e/` still covers only Drive, Docs and Sheets — issue #30 — and until it
covers a write path, the manual pass is the only thing standing between an
encoding error and a merge. And a test can be real and still blind: 0030's
"carries none of the document's ids" asserted `itemId` and `questionId`, which is
the implementation's own definition of an id, so the field that was also an id
walked through it. It now asserts that no id the source form had appears anywhere
in the request body at all.

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

0038 is not a feature. `bun run test` was `vitest`, which watches and never
exits, and it was the command every acceptance criterion in this directory names.
Task 0037 raised it in four review rounds and corrected the one file it was
holding, which is exactly what `decisions/0040` §1 forbids; this task answered
the class. It also excluded `tests/e2e/**` from the scripts, because `test:all`
was an unfiltered `vitest run` and would have sent CI at a real Google account on
the day that directory gained a file.

0039 builds the layer `decisions/0012` described and nobody ever wrote.
`tests/e2e/` has never held a file on any branch, so what has actually verified
this CLI against Google is a manual pass written into each task's `Verification`
section. That pass finds what nothing else can — all three of 0023's defects came
from it — and it is skipped when the task is nearly over: 0027 and 0029 both
merged with `NOT DONE` in the file, and task 0034 exists to fix what they missed.
Decision 0043 gives it a cadence (`pre-push`), a containment rule (one folder,
created per run, trashed after), and a smaller job for the manual pass, which
survives for what needs a tty or a person. 0039 depends on 0038 because until the
scripts excluded `tests/e2e/**`, the first file placed there broke CI and the
release job.

0041 and 0042 split decision 0047 along the line it draws, and both are now
**done**. The failure it
answers had happened four times: 0027 and 0029 merged with the manual pass marked
`NOT DONE`, task 0037's `runFlow` deferral was archived eight minutes after it
was written, and #16's reviewer measured a five-file branch against a three-file
plan. Each produced a record — 0043, 0042, 0044 — that closed one instance and
left the rest of the rules where they were. The fourth was measured while 0047
was being written and had never been noticed: `scripts/lint-casts.ts` had gated
CI since 2026-07-24, and the root document's `## Commands` block, edited seven
times since, had never listed it — while its last line still named 0.8.0 after
0.9.0 shipped. 0041 turns the rules a script can decide into scripts that a git
hook and a Claude Code hook both run; 0042 moves the rest into the directory
where they are read and deletes the blocks that copy `package.json`. The split is
not cosmetic — a git hook binds every contributor and a directory `CLAUDE.md`
binds only an agent, so which half a rule lands in decides who it reaches.

Seven review rounds across the two produced four more records — 0048, 0049, 0050
and the corrections carried back into both plans — and every round found the same
shape: the previous one had fixed the instance it named and left another member
of the same class. Executing a rule is what shows where its sentence stopped, and
that is an argument for executing rules early rather than for writing them more
carefully (0050 Consequences).

0049 through 0052 come from the issue tracker rather than from a survey, and
they are the half of it that needed no new position taken first. The tracker had
nine open issues when they were written; five turned on a question the records
had not answered — what a truncated listing owes its caller, what a copy does
with a half-navigated option set, how a document addresses a second `BODY` — and
those wait for a decision. These four did not, and two of them had been waiting
on something that had already arrived.

That is the part worth keeping. Issue #31 said "there is nothing to build here
before 0033" and 0033 had been archived for a month; the `data` field it was
waiting for was in `src/types/index.ts` with two other commands already using
it. Issue #18 said the quoting bug "does not bite yet" because `tests/e2e/` was
empty, and tasks 0039 and 0045 had since put seven files there. A deferral
records the world on the day it was written, and neither issue was wrong when
filed. Nothing re-reads them when the thing they waited for lands, which is an
argument for checking a blocked issue's premise before its priority.

Two of the four then found, in implementation, that the mechanism they were
copying did not work. 0050's `UnknownRequestKeys` compared an optional field's
inner keys against `never`, and its `X extends Schema ? true : never` companion
was inert in all six places it appeared — a tuple element that evaluates to
`never` is legal TypeScript, so those assertions had asserted nothing since task
0016. 0051's payload was built correctly and then dropped, because
`handleError`'s `quiet` parameter defaulted and thirty-nine of forty-four call
sites left it out. Both are the same shape as 0047's own subject, one layer
down: a guard nobody has watched fail is one nobody knows is wired up.

0055, 0056 and 0057 close the tracker, and what they have in common is that
each needed a position taken rather than a defect found. Two of the three turned
out smaller than their issues suggested once the position was written.

0056 is the clearest. [`0051`](../decisions/0051-elements-holds-placeholders-too.md)
§3 held the write for a schema question — how a document names the second `BODY`
on a slide — and the answer was already in the document: every `elements` entry
carries the object id `insertText` addresses. The record that deferred it was
right to defer; what it needed was somebody to look, not somebody to invent.

0057 is the one that is genuinely large, and it is large in a way the issue
does not show. The visible half is that the marker walk reads the body only. The
half that reaches everywhere is that a Docs index means nothing without a
`segmentId`, so every request this CLI builds gains a field and the
"matches exactly once" rule changes meaning: a marker in a body and in a header
now matches twice, and an `insert` that worked yesterday is refused. That is the
correct failure and it is still a breaking change.

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
