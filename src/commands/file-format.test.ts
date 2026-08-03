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

/**
 * Names chosen for what each one broke while the table padded: a full-width
 * name drifted every column right of it, a name of exactly the old `NAME_W`
 * lost its separator entirely, a longer one pushed its row out of line, and an
 * emoji with a modifier was measured one or two columns short.
 */
const AWKWARD_NAMES = [
  "Budget",
  "研修医へのフィードバックシート",
  "x".repeat(27),
  "y".repeat(64),
  "❤️ 👍🏽 notes",
];

describe("formatFileDetail on a shortcut (decision 0025 §2)", () => {
  it("prints what the shortcut points at, and what kind of thing that is", () => {
    const detail = formatFileDetail(shortcut());
    expect(detail).toContain("Type:\tshortcut");
    expect(detail).toContain("Target:\t1AbC (sheet)");
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
 * cannot bring the collision back — a tab separates the two fields whatever the
 * label is, and the type is recoverable rather than merely visible.
 */
describe("formatFileTable fields", () => {
  const MODIFIED = "2026-07-24 06:17";

  /*
   * The round trip below is what guards decision 0036 §2. A padded field comes
   * back from `split("\t")` with its padding, so it fails for every alignment
   * scheme — constant-width or data-dependent — which the row-independence
   * property further down does not (decision 0039 §2, measured by restoring
   * each previous renderer in turn).
   */

  it.each([...FILE_TYPES])("keeps the type its own field: %s", (type) => {
    const [, row = ""] = formatFileTable([file({ type })]).split("\n");
    expect(row.split("\t")).toEqual([type, MODIFIED, "Budget", "id1"]);
  });

  it("names its columns in the header", () => {
    const [header = ""] = formatFileTable([file()]).split("\n");
    expect(header.split("\t")).toEqual(["Type", "Modified", "Name", "ID"]);
  });

  it.each(AWKWARD_NAMES)("round-trips a row split on tabs: %s", (name) => {
    const [, row = ""] = formatFileTable([file({ name })]).split("\n");
    expect(row.split("\t")).toEqual(["sheet", MODIFIED, name, "id1"]);
  });

  it("round-trips every row of one table, whatever the other names are", () => {
    const files = AWKWARD_NAMES.map((name, i) => file({ name, id: `id${i}` }));
    const rows = formatFileTable(files).split("\n").slice(1);
    expect(rows.map((row) => row.split("\t"))).toEqual(
      AWKWARD_NAMES.map((name, i) => ["sheet", MODIFIED, name, `id${i}`]),
    );
  });
});

/**
 * A supplement to the round trip above, not a substitute for it. Widening one
 * name repads every row of a table sized from its data, so this catches that
 * kind directly and cheaply — but `padEnd` to a *constant* width leaves rows
 * independent by construction, and four of this project's six renderers used
 * constants. Decision 0037 §2 called it sufficient; decision 0039 §2 corrects
 * that after measuring it against each previous renderer.
 */
describe("a row does not depend on the other rows", () => {
  it("leaves every other row byte-identical when one name grows", () => {
    const files = AWKWARD_NAMES.map((name, i) => file({ name, id: `id${i}` }));
    const widened = files.map((f, i) =>
      i === 0 ? { ...f, name: `${f.name} 🏥 拡張された名前` } : f,
    );
    const before = formatFileTable(files).split("\n");
    const after = formatFileTable(widened).split("\n");
    expect(after.filter((_, i) => i !== 1)).toEqual(before.filter((_, i) => i !== 1));
    expect(after[1]).not.toBe(before[1]);
  });
});

describe("a file name cannot forge a field or a row", () => {
  it("keeps a name holding a tab and a newline inside one field of one row", () => {
    const table = formatFileTable([file({ name: "quarter\tone\nreport" })]);
    const lines = table.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]?.split("\t")).toEqual([
      "sheet",
      "2026-07-24 06:17",
      "quarter one report",
      "id1",
    ]);
  });

  it("keeps such a name on one line of a detail too", () => {
    const lines = formatFileDetail(file({ name: "quarter\tone\nreport" })).split("\n");
    expect(lines[0]?.split("\t")).toEqual(["Name:", "quarter one report"]);
  });
});

describe("formatFileDetail fields", () => {
  it.each(AWKWARD_NAMES)("round-trips a label and its value: %s", (name) => {
    const lines = formatFileDetail(file({ name })).split("\n");
    expect(lines[0]?.split("\t")).toEqual(["Name:", name]);
  });

  it("leaves every other line byte-identical when the name grows", () => {
    const before = formatFileDetail(file()).split("\n");
    const after = formatFileDetail(file({ name: "研修医へのフィードバックシート" })).split("\n");
    expect(after.slice(1)).toEqual(before.slice(1));
  });
});
