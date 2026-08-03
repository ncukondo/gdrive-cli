# 0038: `--quiet` asks for a value, not for a format

Date: 2026-08-03
Status: accepted — revises [0007](0007-output-and-errors.md)

## Context

[0007](0007-output-and-errors.md) gave `--quiet` one sentence about how it
composes: "JSON mode is unaffected by `--quiet`." That was harmless while text
was the default, because a caller reached JSON mode only by asking for it, and
asking for JSON while also asking for terseness is a contradiction the caller
made on purpose.

[0036](0036-machine-format-by-default.md) moved the default, and the sentence
stopped being harmless. `gdrive ls -q` now reaches JSON mode without anyone
asking, so it returns the envelope. A caller who typed `-q` because they wanted
a list of ids to pipe gets a JSON object instead, and the flag does nothing
unless paired with `-f text` — which is to say the flag is dead by default.

Neither record is wrong on its own. The interaction was simply never considered,
because 0007 wrote its sentence about a default 0036 later changed.

## Decision

### 1. `--quiet` selects the terse output, whatever the default is

`-q` is a request for the bare value — the ids, the new id, the path — with no
envelope and no labels. It gets that regardless of what the configured or
built-in default format is. The flag exists to be piped into something, and a
default it cannot survive is not a default, it is a bug.

### 2. An explicit `--format` still wins

`gdrive ls -f json -q` yields JSON, which is what [0007](0007-output-and-errors.md)
said and remains right: the caller named a format, and a named format beats an
unnamed preference for terseness. The rule is that explicit beats implicit, and
0007's sentence was only ever an instance of it.

## Out of scope (deferred)

- **A terse mode for JSON.** `-q` remains text-shaped. A caller wanting one field
  out of the envelope has `jq`, and inventing a projection syntax here would be a
  second query language.
- **Which commands have a meaningful quiet output.** That is a `what`; the call
  sites hold it.

## Consequences

- The rule to carry forward is that a default applies where the caller expressed
  no preference, and `--quiet` is a preference. [0036](0036-machine-format-by-default.md)
  §1's exemption for document commands — whose output already *is* the machine
  representation — is the same rule seen from the other side.
- `-q` is now the shortest way to get a bare id, which is what an agent chaining
  two commands wants and what the flag was for.
