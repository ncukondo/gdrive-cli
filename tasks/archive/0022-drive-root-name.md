# Task 0022: `info <drive root>` prints the drive's name, not "Drive"

Status: done
Depends on: — (stacked on 0021 only for the `decisions/` and `tasks/` index
tables)
Parallel: no — touches `getFile` and the `DriveClient` port in `src/lib/api.ts`.

## Goal

`gdrive info 0ANPgzMZtaAa6Uk9PVA` reports the shared drive's own name, matching
what `gdrive drives` prints for the same ID. Every other `info` is unchanged and
costs the same one round trip it did before.

## Context

- [issue #6](https://github.com/ncukondo/gdrive-cli/issues/6).
- Relevant decisions: `decisions/0020` (this change), `decisions/0016` §3 (the
  root-ID shape), `decisions/0015` (the port + generated param check),
  `decisions/0012` (fakes, no network).
- Relevant docs: `docs/commands.md` (`info`, shared drives).

## Scope

- `src/lib/api.ts` — `SHARED_DRIVE_ROOT_ID` moves here; `getFile` gains the
  substitution; `DriveClient.drives.get`.
- `src/lib/google-clients.ts` — one more `GeneratedParamChecks` entry.
- `src/lib/resolve-path.ts` — imports the pattern instead of declaring it.
- `tests/helpers/fake-drive.ts` — `drives.get` in the tree fake.
- `decisions/0020`, `decisions/README.md`, `docs/commands.md`.

## Out of scope

- A `drive` file type or an `is_shared_drive` field (decision 0020 §3).
- Correcting the name anywhere but `getFile`; `ls` reports children, which
  carry their own names already.

## TDD plan

1. **Red** — `src/lib/api.test.ts`:
   - `getFile` on a `0A`+17 ID whose response is named `Drive` returns the name
     from `drives.get`, called with that ID as `driveId`;
   - the same ID whose response is named something else does **not** call
     `drives.get` (a drive that Google names correctly one day);
   - a normal ID whose file is genuinely named `Drive` does not call it either;
   - a throwing `drives.get` leaves the name as `Drive` and still resolves.
2. **Green** — move the pattern, add the port method and the substitution.
3. **Refactor** — keep the substitution a single named helper; `getFile` stays
   readable as fetch → parse → normalize.

## Acceptance criteria

- [x] `info <drive root ID>` prints the drive's name
- [x] No extra call for any other file, including one named `Drive`
- [x] A failed `drives.get` degrades to the generic name, not to an error
- [x] `resolve-path` still accepts the 19-character root ID (unchanged tests)
- [x] `bun run typecheck` / `lint` / `lint:casts` / `format:check` / `test:unit`

## Outcome notes

- The substitution sits after the `try`, so `getFile` still reads as fetch →
  parse → normalize and the drive lookup cannot be swallowed by the mapper that
  wraps the file fetch.
- Both guards are tested separately, including the two near-misses: an ordinary
  file genuinely named `Drive`, and a drive root that Google names correctly.
  The second is what makes this fix a no-op if the API is ever fixed upstream.
- `drives.get` was added to the port rather than reusing `drives.list`, so the
  cost is one round trip regardless of how many drives the account can see. The
  new `GeneratedParamChecks` entry ties it to
  `drive_v3.Params$Resource$Drives$Get`.
- `SHARED_DRIVE_ROOT_ID` moved to `api.ts` and `resolve-path.ts` now imports
  it. `looksLikeId`'s behavior is unchanged, and its existing tests still pin
  the 19-character shape from the other side.

## Verification

- `bun run test:unit` (436 passed), `typecheck`, `lint`, `lint:casts`,
  `format:check`.
- **Not** verified against a live shared drive. The tests assert the shape of
  the fix, not the premise: that `files.get` on a root really answers `Drive`
  is taken from the issue's own console transcript, which was captured against
  a real account. If the string differs by locale, the substitution silently
  does nothing — the failure mode is the status quo, not a new bug.
