# 0010: Google Sheets commands

Date: 2026-07-24
Status: accepted

## Context

Users want to read Sheets ranges and make *simple* edits — write a range,
append rows, clear a range — plus create sheets and target a specific tab.
Formulas-as-values, formatting, and charts are out of scope.

## Decision

Sheets commands live under `gdrive sheets`. The `<file>` argument uses
ID-or-path addressing (0008). A `<range>` is A1 notation, optionally
tab-qualified (e.g. `Sheet1!A1:C10`, or `Sheet1` for the whole tab). When a
range omits the tab, commands default to the first visible tab unless
`--tab <name>` is given.

| Command | Description | Key options |
|---------|-------------|-------------|
| `gdrive sheets tabs <file>` | List tabs (sheets) in the spreadsheet | |
| `gdrive sheets read <file> [<range>]` | Read values | `--tab <name>`, `--as <table\|csv\|json>` (default `table`) |
| `gdrive sheets write <file> <range>` | Overwrite a range with values | `--values <csv\|json\|@file\|->` (required), `--tab` |
| `gdrive sheets append <file> [<range>]` | Append rows after the table | `--values <csv\|json\|@file\|->` (required), `--tab` |
| `gdrive sheets clear <file> <range>` | Clear a range's values | `--tab` |
| `gdrive sheets create <title>` | Create a new spreadsheet | `--parent <folder>` |

Value encoding for `--values` / `--as`:
- **csv**: rows are lines, cells comma-separated (RFC 4180 quoting).
- **json**: a 2-D array `[["a","b"],["c","d"]]`.
- Read defaults to `table` (aligned columns) for humans.

Semantics:
- `write` uses `values.update` (RAW input by default; `--input-mode user` to
  let Sheets parse formulas/dates). `append` uses `values.append`. `clear`
  uses `values.clear`.
- `read` on a whole tab returns its used range.

### Output

Text `tabs`:
```
Index  Rows  Cols  Title
0      100   26    Sheet1
1      50    10    Summary
```

Text `read --as table`: aligned grid. Quiet `read`: CSV to stdout. Quiet
`write`/`append`/`clear`: updated cell count (or nothing). Quiet `create`: new
spreadsheet ID.

JSON examples:
```json
{ "success": true, "data": { "id": "1GhI...", "range": "Sheet1!A1:B2",
  "values": [["name","score"],["alice","90"]], "rows": 2, "cols": 2 } }

{ "success": true, "data": { "id": "1GhI...", "updated_cells": 6,
  "updated_range": "Sheet1!A1:B3", "message": "Updated 6 cells" } }
```

## Out of scope (deferred)

- Cell formatting, formulas authoring beyond `--input-mode user`, charts,
  conditional formatting, named ranges, data validation.

## Consequences

- `lib/sheets-api.ts` wraps Sheets v4 (`spreadsheets.get` for tabs,
  `values.get/update/append/clear`, `spreadsheets.create`) plus CSV/JSON/table
  codecs. Value inputs reuse the `@file`/`-`/literal reader from 0007.
