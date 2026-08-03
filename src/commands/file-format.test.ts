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
 *
 * `TWO_COLUMN` is therefore an independent measure: the characters these
 * fixtures actually use, listed by hand and checked against a terminal, with
 * everything else counting one column. It knows nothing about Annex #11 ranges,
 * so it cannot share a mistake with the code that does.
 */
const TWO_COLUMN = new Set([..."会議研修医へのフィードバックシート要", "📊"]);

function displayColumns(text: string): number {
  let columns = 0;
  for (const char of text) columns += TWO_COLUMN.has(char) ? 2 : 1;
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
  ];

  it.each(names)("puts the ID column at one display offset: %s", (_label, name) => {
    const long = file({ id: "1LoNgEr", name });
    const [header = "", ...rows] = formatFileTable([long, SHORT]).split("\n");

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
    const [header = "", ...rows] = formatFileTable([file({ id: "1AbCdEf", name }), SHORT]).split(
      "\n",
    );
    const [, , , headerId = 0] = columnStarts(header, HEADER_FIELDS);
    expect(headerId).toBeGreaterThan(55); // the offset a table of short names uses
    expect(columnStarts(rows[1] ?? "", ["sheet", "2026-07-24 06:17", "Budget", "1ShOrT"])).toEqual(
      columnStarts(header, HEADER_FIELDS),
    );
  });
});
