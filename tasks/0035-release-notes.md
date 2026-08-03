# Task 0035: The release notes carry the breaking changes

Status: todo (move to `tasks/archive/` when done)
Depends on: —
Parallel: yes (worktree-safe) — `.github/workflows/release.yml` and one new file
at the repo root. It touches nothing any other task owns.

## Goal

Releasing a version whose breaking changes are listed nowhere becomes
impossible, rather than merely discouraged.

## Context

[`0014`](../decisions/0014-pre-1.0-compatibility.md) permits breaking changes
before 1.0 on three conditions, the second being that they "be called out in the
release notes for the version that ships it". Its Consequences section is
explicit about what that costs:

> The release notes become the compatibility record for 0.x, so they have to
> actually list breaking changes rather than lean on `--generate-notes` alone.

`.github/workflows/release.yml` runs `gh release create … --generate-notes` and
nothing else, so the release body is whatever GitHub derives from commit titles.
v0.7.0's is one line: a link to the compare view. Nothing has gone wrong yet only
because no release has carried a breaking change.

0.8.0 carries four. `type` gains `shortcut` and `form`, so files that reported
`type: file` now report something else; the file object gains `target_id` /
`target_type`; shortcuts are followed or not by argument role, so a script
relying on `rm <shortcut>` failing behaves differently; and the `ls` / `search`
text table's first column is two characters wider. A user upgrading has no way
to learn any of that from the release.

This is a gap between a record and the automation that is supposed to honour it,
found while preparing the release rather than by a test. Draft notes for 0.8.0
already exist and are the first content this task ships.

- Also relevant: [`0003`](../decisions/0003-distribution.md) (what a release
  publishes), [`0033`](../decisions/0033-implementation-lands-through-review.md)
  (release commits stay outside a pull request; the workflow that makes them is
  ordinary implementation and does not).

## Scope

- `CHANGELOG.md` — new, at the repo root, newest version first.
- `.github/workflows/release.yml` — the release body comes from the changelog.
- `scripts/` — whatever extracts one version's section, if a script is the
  cleanest way to do it.
- `CLAUDE.md` — the release step, so the next release does not rediscover this.

## Out of scope

- **Automating the version bump**, or moving it into the workflow. It stays a
  deliberate commit ([`0033`](../decisions/0033-implementation-lands-through-review.md)).
- **A changelog entry per commit.** The record 0014 asks for is the breaking
  changes and what shipped, written for a user deciding whether to upgrade, not
  a second copy of the git log.
- **Backfilling 0.1.0 to 0.7.0.** Those releases are what they are; the
  changelog starts where the requirement starts biting.

## TDD plan

The unit under test is a script, not a command, so the tests live beside it.

1. **Extracting one version's notes**
   - **Red** — given a changelog with three versions, extracting `0.8.0` returns
     that section's body without its heading and without the neighbouring
     versions. A version that is not there is an error naming the version and
     the file, not an empty string; the release must fail loudly rather than
     publish a blank body.
   - **Red** — the heading format is fixed and asserted: a section the extractor
     cannot find because the heading drifted is the same failure as a missing
     version, and must say so.
   - **Green** — implement.

2. **The workflow uses it**
   - `release.yml` extracts the section for the tag being released and passes it
     as `--notes-file`, with `--generate-notes` kept only if it can coexist
     (`gh` appends generated notes below the file's content when both are given;
     verify this rather than assuming it).
   - The extraction runs *before* anything is published, so a tag with no
     changelog section fails the job rather than producing a release nobody can
     read.

3. **0.8.0's entry**
   - `CHANGELOG.md` gains the 0.8.0 section, listing the four breaking changes
     above with what a consumer must do about each, what was added
     (`forms read` / `forms responses`, shortcut support, `--type form`), what
     was fixed, and the known gaps. A draft is in the pull request description
     for this task; treat it as material, not as finished text.

## Acceptance criteria

- [ ] `CHANGELOG.md` exists with a 0.8.0 section listing all four breaking changes
- [ ] The extractor returns exactly one version's body, and errors by name on a
      missing version or a drifted heading
- [ ] `release.yml` passes the extracted section as the release body
- [ ] Tagging a version with no changelog section fails the release job before
      anything is published
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `CLAUDE.md` says where the changelog entry is written and when

## Verification

- `bun run test scripts/` — the extractor, including both failure modes
- Manual: run the extractor against the real `CHANGELOG.md` for `0.8.0` and read
  the output as a user would. The workflow itself cannot be verified without
  pushing a tag, so the extractor is where the confidence has to come from.
