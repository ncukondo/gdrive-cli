import { describe, expect, it } from "vitest";
import { formatFileDetail, formatFileTable } from "./file-format.ts";
import { FILE_TYPES } from "../types/index.ts";
import type { DriveFile } from "../types/index.ts";

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "id1",
    name: "Budget",
    mime_type: "application/vnd.google-apps.spreadsheet",
    type: "sheet",
    size: null,
    parents: ["root"],
    trashed: false,
    web_view_link: null,
    created: null,
    modified: "2026-07-24T06:17:02.000Z",
    owners: [],
    target_id: null,
    target_type: null,
    ...overrides,
  };
}

const shortcut = () =>
  file({
    id: "1Lnk",
    name: "link-to-budget",
    mime_type: "application/vnd.google-apps.shortcut",
    type: "shortcut",
    target_id: "1AbC",
    target_type: "sheet",
  });

describe("formatFileDetail on a shortcut (decision 0025 §2)", () => {
  it("prints what the shortcut points at, and what kind of thing that is", () => {
    const detail = formatFileDetail(shortcut());
    expect(detail).toContain("Type:      shortcut");
    expect(detail).toContain("Target:    1AbC (sheet)");
  });

  it("prints no target line for anything else", () => {
    expect(formatFileDetail(file())).not.toContain("Target");
  });
});

describe("formatFileTable", () => {
  it("shows shortcut in the type column, with no extra column (0025 out of scope)", () => {
    const table = formatFileTable([shortcut()]);
    expect(table).toContain("shortcut");
    expect(table).not.toContain("->");
  });
});

/**
 * A real listing printed `shortcut2026-08-03 04:51`: the width was written down
 * as 8, and `shortcut` is 8 characters, so `padEnd` added nothing. Asserted over
 * the whole vocabulary rather than for `shortcut`, so the next member added
 * cannot bring the collision back.
 */
describe("formatFileTable column widths", () => {
  const MODIFIED = "2026-07-24 06:17";

  it.each([...FILE_TYPES])("keeps the type clear of the timestamp: %s", (type) => {
    const [header = "", row = ""] = formatFileTable([file({ type })]).split("\n");
    expect(row.startsWith(`${type} `)).toBe(true);
    expect(row.indexOf(MODIFIED)).toBe(header.indexOf("Modified"));
  });
});

/**
 * The columns are a display property, so the assertions below are about display
 * offsets — and a test that asked the renderer how wide a string is would agree
 * with the renderer about a name it measures wrongly, which is exactly the bug.
 * So the test measures with a table of its own.
 *
 * What that table is, precisely, because the first version of it claimed more:
 * it is a hand-written list of the sequences these fixtures use, each checked to
 * draw two columns, plus printable ASCII at one column, plus **an error for
 * anything else**. The error is the part that matters. An allowlist that
 * defaulted to 1 could only ever disagree with the renderer about characters
 * already known to be wide, so a character missing from both tables passed
 * silently — the oracle shared not the implementation but the habit of
 * enumerating, and neither could be surprised. Refusing to guess is what a
 * second opinion can honestly offer here: it cannot confirm the range data, but
 * it cannot quietly ratify a hole in it either.
 *
 * Entries are sequences rather than characters so that `⚠️` and `👍🏽` are
 * measured as what a terminal draws, without the test restating the renderer's
 * rules for variation selectors and modifiers.
 */
const WIDE_ALONE = [..."会議研修医へのフィードバックシート要約契書📊🟰䷀"];

const TWO_COLUMNS: readonly string[] = [
  "⚠️", // U+26A0 is narrow alone; VS16 asks for the emoji, which is wide
  "👍\u{1F3FD}", // the modifier recolours the hand rather than adding a glyph
  ...WIDE_ALONE,
].sort((a, b) => b.length - a.length);

/** Printable ASCII, the only characters this test is willing to assume about. */
const ONE_COLUMN = /^[\x20-\x7e]$/;

/** Non-ASCII hand-checked as narrow. `—` is East Asian Width `A`, one column outside a CJK context. */
const ALSO_ONE_COLUMN = new Set(["—"]);

function displayColumns(text: string): number {
  let columns = 0;
  let at = 0;
  while (at < text.length) {
    const wide = TWO_COLUMNS.find((token) => text.startsWith(token, at));
    if (wide !== undefined) {
      columns += 2;
      at += wide.length;
      continue;
    }
    const code = text.codePointAt(at) ?? 0;
    const char = String.fromCodePoint(code);
    if (!ONE_COLUMN.test(char) && !ALSO_ONE_COLUMN.has(char)) {
      throw new Error(
        `this test has no hand-checked width for U+${code.toString(16).toUpperCase().padStart(4, "0")}` +
          ` in ${JSON.stringify(text)}. Check what a terminal draws and add it to TWO_COLUMNS;` +
          ` do not ask the renderer.`,
      );
    }
    columns += 1;
    at += char.length;
  }
  return columns;
}

/**
 * Where each field starts, in display columns, asserting on the way that the
 * field before it left a separator behind.
 */
function columnStarts(line: string, fields: readonly string[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const [index, field] of fields.entries()) {
    const at = line.indexOf(field, cursor);
    expect(at, `${JSON.stringify(field)} missing from ${JSON.stringify(line)}`).toBeGreaterThan(-1);
    if (index > 0) {
      expect(line.slice(at - 1, at), `no separator before ${JSON.stringify(field)}`).toBe(" ");
    }
    starts.push(displayColumns(line.slice(0, at)));
    cursor = at + field.length;
  }
  return starts;
}

describe("formatFileTable is a table for any name Drive permits", () => {
  const HEADER_FIELDS = ["Type", "Modified", "Name", "ID"] as const;
  const SHORT = file({ id: "1ShOrT", name: "Budget" });

  const names: readonly [label: string, name: string][] = [
    ["a plain ASCII name", "Quarterly report"],
    ["a name of exactly NAME_W units", "Regional rollout plan 2026a"],
    ["a name longer than NAME_W", "Regional rollout plan 2026 — appendix and annexes"],
    ["a full-width name", "研修医へのフィードバックシート"],
    ["a mixed name", "会議 2026-08 notes"],
    ["a name with an emoji", "📊 Q3 dashboard"],
    // Wide by Annex #11 but outside the ranges a pre-5.2 wcwidth table carries,
    // which is what the first version of `WIDE_RANGES` turned out to be.
    ["a name with a hexagram and a heavy equals sign", "🟰 metrics ䷀"],
    // The commonest wide characters of all, and the ones a bare code-point
    // lookup gets wrong: the base character is narrow and VS16 asks for the
    // emoji.
    ["a name with an emoji presentation selector", "⚠️ urgent"],
    ["a name with a skin-tone modifier", "👍🏽 ok"],
  ];

  it.each(names)("puts the ID column at one display offset: %s", (_label, name) => {
    const long = file({ id: "1LoNgEr", name });
    const [header = "", ...rows] = formatFileTable([long, SHORT]).split("\n");

    expect(rows).toHaveLength(2); // one line per file, whatever the name contains
    const headerStarts = columnStarts(header, HEADER_FIELDS);
    const rowStarts = [
      columnStarts(rows[0] ?? "", ["sheet", "2026-07-24 06:17", name, "1LoNgEr"]),
      columnStarts(rows[1] ?? "", ["sheet", "2026-07-24 06:17", "Budget", "1ShOrT"]),
    ];

    for (const starts of rowStarts) expect(starts).toEqual(headerStarts);
  });

  it("keeps a name of exactly NAME_W units clear of its ID", () => {
    const name = "Regional rollout plan 2026a";
    const [, row = ""] = formatFileTable([file({ id: "1AbCdEf", name })]).split("\n");
    const gap = row.slice(row.indexOf(name) + name.length, row.lastIndexOf("1AbCdEf"));
    expect(gap).toMatch(/^ +$/);
  });

  /**
   * A name wider than the column widens the column for the whole table. The
   * alternative — letting one row run long — would put that row's ID somewhere
   * no other row's is, which is the defect rather than a fix for it.
   */
  it("grows the column to fit a name too wide for it", () => {
    const name = "研修医へのフィードバックシート要約 2026";
    const [header = "", ...rows] = formatFileTable([file({ id: "1LoNgEr", name }), SHORT]).split(
      "\n",
    );
    const headerStarts = columnStarts(header, HEADER_FIELDS);
    const [, , , headerId = 0] = headerStarts;

    expect(headerId).toBeGreaterThan(55); // the offset a table of short names uses
    // Both rows, including the one the widening exists for.
    expect(columnStarts(rows[0] ?? "", ["sheet", "2026-07-24 06:17", name, "1LoNgEr"])).toEqual(
      headerStarts,
    );
    expect(columnStarts(rows[1] ?? "", ["sheet", "2026-07-24 06:17", "Budget", "1ShOrT"])).toEqual(
      headerStarts,
    );
  });

  /**
   * Drive accepts a newline in a file name — this was observed against a real
   * account, not inferred from the API docs. Rendered as-is it ends the row and
   * puts the ID at column 0 of a line with no columns at all, so the table stops
   * being a table for reasons that have nothing to do with width. The name shown
   * is lossy where this happens; `-f json` still carries the real one (0007).
   */
  it("keeps a name containing a newline on one row", () => {
    const lines = formatFileTable([file({ id: "1LoNgEr", name: "line1\nline2" }), SHORT]).split(
      "\n",
    );
    const [header = "", ...rows] = lines;

    expect(rows).toHaveLength(2);
    const headerStarts = columnStarts(header, HEADER_FIELDS);
    expect(columnStarts(rows[0] ?? "", ["sheet", "2026-07-24 06:17", "line1", "1LoNgEr"])).toEqual(
      headerStarts,
    );
    expect(columnStarts(rows[1] ?? "", ["sheet", "2026-07-24 06:17", "Budget", "1ShOrT"])).toEqual(
      headerStarts,
    );
  });
});
