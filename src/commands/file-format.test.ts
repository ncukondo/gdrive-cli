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
