# 0011: Sharing & permissions commands

Date: 2026-07-24
Status: accepted

## Context

Managing who can access a file/folder is a core Drive operation and is included
from the start (not deferred). The full `drive` scope (0005) already grants
permission management, so no new scope is needed. The primary consumer is an AI
agent, so permission objects must carry stable ids and be fully described in
JSON.

## Decision

Sharing commands live under `gdrive share`. The `<file>` argument uses
ID-or-path addressing (0008).

| Command | Description | Key options |
|---------|-------------|-------------|
| `gdrive share list <file>` | List all permissions on the file | |
| `gdrive share add <file>` | Grant access | grantee (one of `--to <email>` / `--domain <domain>` / `--anyone`), `--role <reader\|commenter\|writer>` (default `reader`), `--notify`, `--message <s>`, `--allow-discovery` |
| `gdrive share remove <file>` | Revoke access | `--to <email>` **or** `--permission-id <id>` |
| `gdrive share link <file>` | Ensure an "anyone with link" permission and print the shareable link | `--role <reader\|commenter\|writer>` (default `reader`) |

Semantics:
- Grantee **type** is inferred: `--to` → `user` (or `group` if the address is a
  group), `--domain` → `domain`, `--anyone` → `anyone`.
- `--role owner` (ownership transfer) is **out of scope** initially — it has
  special constraints; a later decision may add `share transfer`.
- `--notify` controls `sendNotificationEmail`; default is no email for
  `user`/`group` grants to keep agent runs quiet, but Google may force a
  notification for some grants.
- `share remove` requires either the grantee email (resolved to its permission
  id) or an explicit `--permission-id`.

### Output

Text `share list`:
```
Role       Type    Grantee                 Permission ID
owner      user    me@gmail.com            perm-owner
writer     user    alice@example.com       perm-abc
reader     anyone  (anyone with link)      perm-anyone
```

Quiet `share list`: one permission id per line. Quiet `share add`: new
permission id. Quiet `share link`: the URL. Quiet `share remove`: no output.

JSON `data` carries a `permissions` array (or single `permission`):

```json
{ "id": "perm-abc", "type": "user", "role": "writer",
  "email": "alice@example.com", "display_name": "Alice",
  "domain": null, "allow_file_discovery": false, "deleted": false }
```

`share link` JSON adds `{ "web_view_link": "https://...", "permission": { ... } }`.

## Out of scope (deferred)

- Ownership transfer (`--role owner` / `share transfer`).
- Shared-drive-specific permission semantics, capabilities, expiration times.

## Consequences

- `lib/api.ts` gains permission methods (`permissions.list/create/delete`) and
  a grantee→type inference helper. Task 0014 owns the `commands/share/*` wiring.
