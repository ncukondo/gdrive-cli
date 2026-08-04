# 0043: E2E exists, runs before a push, and writes only inside one folder

Date: 2026-08-04
Status: accepted — revises [0012](0012-testing-strategy.md)

## Context

[0012](0012-testing-strategy.md) defined three test layers and gave the third a
location (`tests/e2e/**/*.test.ts`), a policy ("Requires real OAuth; local
only"), a cadence ("E2E runs locally before commit") and a section headed
CRITICAL about what not to do when it fails. None of it has ever applied to
anything. `git log --all -- tests/e2e` is empty: the directory has never held a
file on any branch at any point.
`tasks/archive/0004-auth-multi-account.md:54` lists the first E2E as pending, and
it stayed pending through thirty-seven tasks.

What has run instead is a manual pass, written per task into a `Verification`
section. It finds things nothing else does.
`tasks/archive/0023-markdown-writes.md:126` says all three real bugs came from
it and that none of them could have come from the unit tests.
`tasks/archive/0017-shared-drive-support.md:75` names a defect found in manual
verification and not by the suite. In 0020 the manual pass corrected the decision
it was verifying.

It also gets skipped. Tasks 0027 and 0029 both merged with
`Manual, against a real account — NOT DONE` in the file, and task 0034 exists
because of it: three defects that a real Drive showed and no fake could. A
checklist read by a tired person after the review rounds are over is not a gate,
and calling it one has now failed twice.

The reason the gap is invisible is worth stating exactly, because it decides what
E2E is for. A fake encodes what its author believes the API does. Every test
written against it can only confirm that belief. Two of task 0034's three
defects were exactly that: nobody knew what `Link` Drive returns for a shortcut,
so 0027 declined to print one, and a form read as `type: file` because the map
said so. Google is the only party that can contradict the author, and until now
nothing in the pipeline let it.

One thing changed recently that makes this possible at all. Until task 0038,
`test:all` was an unfiltered `vitest run` and `vitest.config.ts` includes
`tests/**/*.test.ts`, so the first file placed under `tests/e2e/` would have sent
CI and the release job at a real Google account with no credentials. The
directory could not be used. It can now.

## Decision

### 1. E2E runs before a push

`tests/e2e/**/*.test.ts` is invoked by a `pre-push` hook. Not by CI, which has no
account and, per §3 below and 0012's original judgement, is not getting one. Not
by `pre-commit`, which fires often enough that a network round trip would be paid
for a typo fix.

`pre-push` is the last moment before work leaves the machine and the moment a
pull request is about to exist. It is also the point where the cost is
proportionate: once per branch-worth of commits rather than once per commit.

### 2. It writes, inside one folder, and never outside it

Read-only would be safer and would miss most of what has actually been found:
every one of 0023's three defects was on the write side, in index arithmetic that
only a real Docs document exposes. So E2E writes.

What makes that safe is a single invariant, not care. A folder in a real account
is named by `GDRIVE_CLI_E2E_FOLDER`. Each run creates a uniquely named subfolder
under it, performs every write inside that subfolder, and trashes it at the end.
No test addresses a path outside that subtree, and no test touches a shared
drive: 0018's manual pass used `専門医部会` read-only, and there is no reason to
bring writes to someone else's drive.

A run that fails leaves its subfolder behind, because the contents are the
evidence. The next run prunes what is older than a day.

### 3. No credentials means skipped, not failed

A fresh clone, a second machine, another person, and CI all lack an account.
There the E2E suite reports skipped. A hard failure in those places would teach
everyone to reach for `--no-verify`, and a hook that is routinely bypassed
guards nothing.

### 4. The manual pass survives, with a smaller job

E2E cannot reach what needs a terminal or a person: the OAuth consent screen in
a browser, a confirmation prompt, how text output looks at a real width, and any
judgement about whether what came back is readable. `pre-push` runs without a tty
and without a human, so those stay manual.

A task's `Verification` section names the two separately, so that "the automated
one passed" cannot stand in for the part it never ran. This is the failure mode
to expect once both exist.

### 5. E2E is not where output correctness is asserted

The third of task 0034's defects — `shortcut` being eight characters against a
column width of eight — is a property of the renderer, and
[0035](0035-docs-are-downstream.md) §1 already says where that belongs. A manual
pass finding something does not make it E2E's job. E2E's subject is the boundary
with Google: which requests are accepted, what a returned field means, and which
error arrives.

## Out of scope (deferred)

- **Running E2E in GitHub Actions.** It is possible: a refresh token in a secret,
  materialised into a token file by the workflow. It would make E2E a gate on
  every pull request rather than a habit. It also puts a real account's
  credentials in CI, cannot work for a fork, and turns an expired token into a
  red X on unrelated work. If `pre-push` proves easy to bypass, this is the
  escalation to consider. Not filed as an issue
  ([0042](0042-deferred-work-is-an-issue.md) §2): nobody wants it yet.
- **Write tests against a shared drive.** §2.
- **Restating 0012's CRITICAL policy.** It stands unchanged and now has a
  subject: when E2E fails, find the cause and fix the implementation. Do not mock
  around it, do not adjust the expectation to match broken behaviour, do not skip
  the test.

## Consequences

- 0012's E2E row and 0013's `e2e/` directory become true for the first time.
  Neither file is edited ([0032](0032-decisions-are-append-only.md) §3); this
  record is where the layer acquires a cadence and a containment rule.
- `pre-push` gains network time. How much is unknown until it is written. The
  order is to build it whole and cut it if it hurts, not to make the expensive
  half optional in advance: an optional gate is the one that stopped running in
  0027 and 0029.
- The `runFlow` tty block filed under [0042](0042-deferred-work-is-an-issue.md)
  is precisely what §4 keeps manual. `pre-push` has no browser, so E2E will never
  reach it, and the issue says so.
- A second account's worth of setup joins the contributor path: a folder, and an
  environment variable naming it. §3 keeps that from being mandatory.
