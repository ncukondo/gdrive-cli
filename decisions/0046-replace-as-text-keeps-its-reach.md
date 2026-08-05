# 0046: `replace --as text` keeps its reach, and so keeps the style it replaced

Date: 2026-08-05
Status: accepted — corrects [0045](0045-inserted-content-is-default-styled.md) §3

## Context

[0045](0045-inserted-content-is-default-styled.md) §3 says `--as text` resets
what it wrote, on every path, because the flag is about parsing and not about
formatting. Task 0040 implemented that for `create --content`, `append` and
`insert`, and the review of pull request #20 found the fourth path was not
implemented and could not be: `replace --as text` goes through `replaceAllText`
([0021](0021-markdown-writes.md) §6), which reports how many occurrences it
changed and nothing about where they were.

A reset needs a range. There is no range to be had here, and the three ways to
get one are each worse than the gap:

- **Route `--as text` through the Markdown path** — find the marker's ranges,
  delete, insert. It would reset correctly and it would silently lose reach:
  `replaceAllText` substitutes in headers, footers and footnotes, and
  `findMarkerRanges` walks `body.content` only, skipping table cells on purpose
  (0021 §6). A marker in a header would stop being replaced, and nothing in the
  output would say so.
- **Re-read afterwards and reset wherever the replacement text now appears.**
  That restyles occurrences of the same string that were already in the
  document — writing over text this command did not write, which is the one
  thing [0045](0045-inserted-content-is-default-styled.md) §2 refuses.
- **Widen `findMarkerRanges` to every segment.** A real option, and a larger
  piece of work than the gap justifies: headers, footers and footnotes are
  outside what `read` renders and what 0021 scoped, so it would be the first
  code in the repository to address them.

## Decision

`replace --as text` keeps `replaceAllText`, and therefore keeps the formatting
of the text it replaced. It is the one write path that inherits, and both
`docs/commands.md` and the release notes say so next to the rule rather than
leaving the reader to find it.

Every other path is unchanged by this record: `replace` in its default Markdown
mode deletes the marker and inserts structure at its index, so 0045 applies to
it in full, as it does to `create --content`, `append` and `insert` under either
flag.

The correction 0045 §3 needs is therefore one clause: *both paths reset, except
`replace --as text`, whose substitution the API performs without telling us
where.*

## Out of scope (deferred)

- **Reading and writing headers, footers and footnotes.** Filed as
  [issue #21](https://github.com/ncukondo/gdrive-cli/issues/21) — it is what
  would make the first option above lossless, and it is worth doing on its own
  terms rather than as a side effect of a style fix.

## Consequences

- One documented exception, in the two places a user looks: the `--as`
  paragraph in `docs/commands.md` and the 0.9.0 release notes.
- A test pins it, so the exception cannot quietly become a regression in either
  direction.
- The pattern that produced this record is worth naming: 0045 §3 was written
  about the flag rather than about the four commands the flag appears on, and
  the path where the flag means something different was not checked before the
  record was accepted. A record that says "every X" is a claim about a set
  somebody has to enumerate.
