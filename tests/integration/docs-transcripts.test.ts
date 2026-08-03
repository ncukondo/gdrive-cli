import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatFileDetail, formatFileTable } from "../../src/commands/file-format.ts";
import type { DriveFile } from "../../src/types/index.ts";

/**
 * Every transcript in `docs/commands.md` that a renderer produces, re-rendered
 * and required to appear in the document verbatim.
 *
 * Task 0034's second defect was a documented transcript that disagreed with
 * what the CLI prints, and its first was a column width. Deriving the width
 * from the type vocabulary fixed the collision for good, but it also means the
 * next label added silently rewidens all three tables — the suite would report
 * a filter-clause failure and say nothing about the docs. This is the loop
 * closed: a width change fails here, naming the block to regenerate.
 *
 * A failure is not a bug in the renderer. Re-render the block and paste it in.
 */

const DOCS_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../docs/commands.md");
const DOCS = readFileSync(DOCS_PATH, "utf8");

/** The body of the ```console block that runs this command line. */
function consoleBlock(command: string): string {
  const blocks = [...DOCS.matchAll(/```console\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  const match = blocks.find((block) => block.includes(command));
  if (match === undefined)
    throw new Error(`docs/commands.md has no console block running: ${command}`);
  return match;
}

function fixture(overrides: Partial<DriveFile>): DriveFile {
  return {
    id: "id1",
    name: "File",
    mime_type: "application/octet-stream",
    type: "file",
    size: null,
    parents: [],
    trashed: false,
    web_view_link: null,
    created: null,
    modified: null,
    owners: [],
    target_id: null,
    target_type: null,
    ...overrides,
  };
}

const budget = fixture({
  id: "1S6cRd...",
  name: "Budget",
  mime_type: "application/vnd.google-apps.spreadsheet",
  type: "sheet",
  modified: "2026-07-24T06:17:02.000Z",
});

describe("the ls and search tables in docs/commands.md", () => {
  it("matches what formatFileTable renders for `ls --type sheet`", () => {
    const rendered = formatFileTable([
      budget,
      fixture({
        id: "1QwErT...",
        name: "Headcount",
        mime_type: "application/vnd.google-apps.spreadsheet",
        type: "sheet",
        modified: "2026-06-02T11:40:00.000Z",
      }),
    ]);
    expect(consoleBlock('$ gdrive ls "Reports/2026" --type sheet')).toContain(rendered);
  });

  it("matches what formatFileTable renders for `search --type sheet`", () => {
    expect(consoleBlock("$ gdrive search budget --type sheet")).toContain(
      formatFileTable([budget]),
    );
  });

  it("matches what formatFileTable renders for `ls --type form`", () => {
    const rendered = formatFileTable([
      fixture({
        id: "1FoRm...",
        name: "2026 Engagement survey",
        mime_type: "application/vnd.google-apps.form",
        type: "form",
        modified: "2026-08-03T04:51:00.000Z",
      }),
      fixture({
        id: "1OtHeR...",
        name: "Untitled form",
        mime_type: "application/vnd.google-apps.form",
        type: "form",
        modified: "2026-07-11T16:20:00.000Z",
      }),
    ]);
    expect(consoleBlock("$ gdrive ls Surveys --type form")).toContain(rendered);
  });
});

describe("the info transcripts in docs/commands.md", () => {
  it("matches what formatFileDetail renders for a sheet", () => {
    const rendered = formatFileDetail(
      fixture({
        ...budget,
        created: "2026-07-24T06:17:00.000Z",
        owners: ["me@gmail.com"],
        web_view_link: "https://docs.google.com/spreadsheets/d/1S6cRd.../edit",
      }),
    );
    expect(consoleBlock('$ gdrive info "Reports/2026/Budget"')).toContain(rendered);
  });

  /**
   * The `Link:` line 0027 left out because nothing had confirmed what Drive
   * returns for a shortcut. It points at the shortcut's own id, not the
   * target's, which is the part of this block worth pinning.
   */
  it("matches what formatFileDetail renders for a shortcut, Link line included", () => {
    const rendered = formatFileDetail(
      fixture({
        id: "1LnkAbC...",
        name: "link-to-doc",
        mime_type: "application/vnd.google-apps.shortcut",
        type: "shortcut",
        modified: "2026-08-01T09:12:44.000Z",
        created: "2026-07-30T14:02:10.000Z",
        target_id: "1DocXyZ...",
        target_type: "doc",
        owners: ["me@gmail.com"],
        web_view_link: "https://drive.google.com/file/d/1LnkAbC.../view?usp=drivesdk",
      }),
    );
    expect(consoleBlock('$ gdrive info "Reports/link-to-doc"')).toContain(rendered);
  });
});
