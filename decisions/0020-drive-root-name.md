# 0020: `info` on a shared drive root reports the drive's name

Date: 2026-07-27
Status: accepted

## Context

```console
$ gdrive info 0ANPgzMZtaAa6Uk9PVA
Name:      Drive
Type:      folder
ID:        0ANPgzMZtaAa6Uk9PVA
```

`files.get` on a shared drive's root returns a generic folder resource whose
`name` is the literal string `Drive` — the same for every drive
([issue #6]). The ID is right and everything downstream works; only the label is
wrong, and it is wrong identically for all of them, so `info` cannot tell two
drives apart.

This became reachable in v0.4.0: before `supportsAllDrives`
([0016](0016-shared-drive-scope.md) §1) the call failed at `NOT_FOUND`, and
before `looksLikeId` accepted the 19-character shape (0016 §3) the ID was not
even recognized as an ID. `gdrive drives` reports the real names, so the impact
is cosmetic — but `info` is the command an agent uses to confirm *what* an ID
refers to, and "Drive" is an answer that identifies nothing.

## Decision

### 1. `getFile` substitutes the real name, in `lib/api.ts`

When a `files.get` response comes back with `name === "Drive"` **and** the ID
matches the shared-drive root shape (`0A` + 17 characters), `getFile` fetches
the drive with `drives.get` and uses its name.

Both conditions are required. The name alone would fire on any file a user
called "Drive"; the ID shape alone would fire on every drive-root fetch,
including the ones where a future API returns the right name already. Together
they describe exactly the case in the issue, and the substitution is a no-op the
day Google starts answering correctly.

The fix lives in `getFile` rather than in the `info` command because the wrong
name is a property of the response, not of one command's rendering. Everything
that reads a file through the port gets the corrected name.

### 2. A failed `drives.get` keeps the generic name

If the lookup throws — no permission to read the drive resource, API trouble —
`info` still prints `Drive` and succeeds. The name is a nicety; failing an
otherwise-good `info` to avoid an imprecise label would be a worse trade, the
same reasoning as the shared-drive hint in
[0019](0019-shared-drive-paths.md) §3.

### 3. `type` stays `folder`; no new field

A drive root really does behave as a folder — `ls` lists it, `--parent` accepts
it, `mkdir` creates in it — and that is what `type` describes. Adding a
`drive` type, or an `is_shared_drive` flag, would change the file object's
contract ([0008](0008-drive-commands.md)) to carry information the ID shape and
`gdrive drives` already provide.

### 4. `drives.get` joins the port

`DriveClient.drives` gains `get`, checked against
`drive_v3.Params$Resource$Drives$Get` by `GeneratedParamChecks`
([0015](0015-no-type-assertions.md)) like every other method. `drives.list` +
find-by-ID would have avoided the new method, but it pages through every drive
the account can see to answer a question about one known ID.

## Consequences

- One extra round trip for `info <drive root ID>`, and only for that: the name
  check gates it, and no ordinary file can hold a 19-character `0A…` ID.
- The `SHARED_DRIVE_ROOT_ID` pattern moves from `lib/resolve-path.ts` to
  `lib/api.ts`, where `getFile` needs it, and `resolve-path` imports it from
  there. `looksLikeId` is unchanged in behavior; 0016 §3's description of it
  still holds.
- `gdrive info` on a drive root now prints the same name as `gdrive drives`,
  which is the pair a user cross-checks.

[issue #6]: https://github.com/ncukondo/gdrive-cli/issues/6
