import { describe, expect, it } from "vitest";
import {
  checkArchivedTasks,
  checkDecisionEdits,
  checkIndexRow,
  checkStatusLine,
  isDecisionRecord,
} from "./lint-records.js";

describe("isDecisionRecord", () => {
  it("is true for a numbered decision", () => {
    expect(isDecisionRecord("decisions/0032-decisions-are-append-only.md")).toBe(true);
  });

  it("is false for the index and for a directory guide", () => {
    expect(isDecisionRecord("decisions/README.md")).toBe(false);
    expect(isDecisionRecord("decisions/CLAUDE.md")).toBe(false);
  });

  it("is false outside decisions/", () => {
    expect(isDecisionRecord("tasks/0040-rules-are-executed.md")).toBe(false);
    expect(isDecisionRecord("0032-decisions-are-append-only.md")).toBe(false);
  });
});

describe("checkDecisionEdits", () => {
  it("refuses a modification to a committed decision", () => {
    const found = checkDecisionEdits([{ status: "M", path: "decisions/0008-drive-commands.md" }]);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("0008-drive-commands.md");
  });

  it("refuses a deletion and a rename for the same reason", () => {
    expect(
      checkDecisionEdits([{ status: "D", path: "decisions/0008-drive-commands.md" }]),
    ).toHaveLength(1);
    expect(checkDecisionEdits([{ status: "R", path: "decisions/0008-renamed.md" }])).toHaveLength(
      1,
    );
  });

  it("allows a new decision", () => {
    expect(checkDecisionEdits([{ status: "A", path: "decisions/0046-something.md" }])).toEqual([]);
  });

  it("allows the index, which 0032 §4 requires to be edited", () => {
    expect(checkDecisionEdits([{ status: "M", path: "decisions/README.md" }])).toEqual([]);
  });

  it("says nothing about a task file or a directory CLAUDE.md", () => {
    expect(checkDecisionEdits([{ status: "M", path: "tasks/0040-x.md" }])).toEqual([]);
    expect(checkDecisionEdits([{ status: "M", path: "decisions/CLAUDE.md" }])).toEqual([]);
  });
});

describe("checkIndexRow", () => {
  const readme = "| [0045](0045-rules-are-executed.md) | A checkable rule is a script |\n";

  it("passes when the added decision has its row", () => {
    expect(checkIndexRow(["decisions/0045-rules-are-executed.md"], readme)).toEqual([]);
  });

  it("fails when the row is missing", () => {
    const found = checkIndexRow(["decisions/0046-later.md"], readme);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("0046-later.md");
  });

  it("does not accept a row that links a different file", () => {
    expect(checkIndexRow(["decisions/0045-rules.md"], readme)).toHaveLength(1);
  });

  it("checks every added decision", () => {
    expect(checkIndexRow(["decisions/0046-a.md", "decisions/0047-b.md"], readme)).toHaveLength(2);
  });
});

describe("checkStatusLine", () => {
  const at = (status: string) => `# 0046: Title\n\nDate: 2026-08-06\n${status}\n\n## Context\n`;
  const path = "decisions/0046-x.md";

  it("accepts a bare acceptance", () => {
    expect(checkStatusLine(path, at("Status: accepted"))).toEqual([]);
  });

  it("accepts revises and extends with a link", () => {
    expect(
      checkStatusLine(path, at("Status: accepted — revises [0007](0007-output-and-errors.md) §4")),
    ).toEqual([]);
    expect(
      checkStatusLine(path, at("Status: accepted — extends [0021](0021-markdown-writes.md)")),
    ).toEqual([]);
  });

  it("accepts two relationships on one line", () => {
    const line =
      "Status: accepted — extends [0032](0032-decisions-are-append-only.md) §6, " +
      "[0033](0033-implementation-lands-through-review.md) §1";
    expect(checkStatusLine(path, at(line))).toEqual([]);
  });

  it("accepts a relationship that wraps onto the next line, as 0039's does", () => {
    const source = at(
      "Status: accepted — revises [0036](0036-machine-format-by-default.md) and\n" +
        "[0037](0037-tests-assert-behaviour.md)",
    );
    expect(checkStatusLine(path, source)).toEqual([]);
  });

  it("refuses a relationship with no link to follow", () => {
    expect(checkStatusLine(path, at("Status: accepted — revises 0007"))).toHaveLength(1);
  });

  it("refuses the parenthetical form 0032 §3 outlawed", () => {
    const found = checkStatusLine(
      path,
      at('Status: accepted (revised 2026-07-27; see "Revision")'),
    );
    expect(found).toHaveLength(1);
  });

  it("refuses a back-pointer, which the old file is never supposed to gain", () => {
    expect(
      checkStatusLine(path, at("Status: accepted — role vocabulary revised by [0018](0018-x.md)")),
    ).toHaveLength(1);
  });

  it("refuses superseded, which 0032 §3 removed", () => {
    const found = checkStatusLine(
      path,
      at("Status: superseded by [0018](0018-shared-drive-roles.md)"),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("superseded");
  });

  it("refuses a file with no Status line at all", () => {
    expect(checkStatusLine(path, "# 0046: Title\n\nDate: 2026-08-06\n\n## Context\n")).toHaveLength(
      1,
    );
  });
});

describe("checkArchivedTasks", () => {
  const table = (...rows: string[]) =>
    [
      "| Task | Depends on | Parallel group | Status |",
      "| ---- | ---------- | -------------- | ------ |",
      ...rows,
    ].join("\n");

  it("passes a done task that links into archive/", () => {
    expect(checkArchivedTasks(table("| [0038 x](archive/0038-x.md) | — | — | done |"))).toEqual([]);
  });

  it("fails a done task still sitting in tasks/", () => {
    const found = checkArchivedTasks(table("| [0038 x](0038-x.md) | — | — | done |"));
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("0038-x.md");
  });

  it("passes a todo or in-progress task outside archive/", () => {
    expect(checkArchivedTasks(table("| [0028 x](0028-x.md) | — | — | todo |"))).toEqual([]);
    expect(checkArchivedTasks(table("| [0028 x](0028-x.md) | — | — | in-progress |"))).toEqual([]);
  });

  it("treats any other status as finished, including closed unmerged", () => {
    expect(
      checkArchivedTasks(table("| [0036 x](0036-x.md) | 0034 | F | closed unmerged |")),
    ).toHaveLength(1);
  });

  it("ignores the header and the separator", () => {
    expect(checkArchivedTasks(table())).toEqual([]);
  });

  it("ignores prose that is not a table row", () => {
    expect(checkArchivedTasks("Order of first delivery: 0001 → 0002.\n")).toEqual([]);
  });
});
