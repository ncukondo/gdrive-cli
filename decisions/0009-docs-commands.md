# 0009: Google Docs commands

Date: 2026-07-24
Status: accepted

## Context

Users want to read Google Docs and make *simple* edits from the CLI, including
appending, find & replace, and inserting text at a position. Full structural
document editing is out of scope.

## Decision

Docs commands live under `gdrive docs`. The `<file>` argument uses ID-or-path
addressing (0008).

| Command | Description | Key options |
|---------|-------------|-------------|
| `gdrive docs read <file>` | Export the document body as text | `--as <markdown\|text>` (default `markdown`) |
| `gdrive docs create <title>` | Create a new document | `--content <text\|@file\|->`, `--parent <folder>` |
| `gdrive docs append <file> <text\|@file\|->` | Append a paragraph at end of body | |
| `gdrive docs replace <file>` | Find & replace across the document | `--find <s>` (required), `--replace <s>` (required), `--match-case`, `--all` (default replaces all matches) |
| `gdrive docs insert <file> <text\|@file\|->` | Insert text at a position | `--index <n>` (character index) **or** `--at <start\|end>` |

Notes:
- `read --as markdown` maps headings, bold/italic, lists, and links to
  Markdown on a best-effort basis; `--as text` emits plain paragraph text.
- Edits are applied via the Docs API `batchUpdate` (insertText / replaceAllText
  / insertText at index). `insert --index` uses Docs' 1-based character index
  within body; `--at end` targets the document's end index.
- `replace` reports the number of occurrences replaced.

### Output

Text `read`: the exported document to stdout (Markdown/plain).
Quiet `create`: new document ID. Quiet `append`/`replace`/`insert`: document
ID (replace also fine to stay ID-only; count is in JSON).

JSON examples:
```json
{ "success": true, "data": { "id": "1DeF...", "title": "Meeting notes",
  "format": "markdown", "content": "# Meeting notes\n..." } }

{ "success": true, "data": { "id": "1DeF...", "replaced": 3,
  "message": "Replaced 3 occurrences" } }
```

## Out of scope (deferred)

- Styling/formatting edits, images, tables, comments, suggestions/revisions.
- Rich round-trip Markdown → Docs structure beyond best-effort `read`.

## Consequences

- `lib/docs-api.ts` wraps Docs v1 (`documents.get`, `documents.create`,
  `documents.batchUpdate`) plus a Docs→Markdown/text renderer. Content inputs
  reuse the `@file`/`-`/literal reader from 0007.
