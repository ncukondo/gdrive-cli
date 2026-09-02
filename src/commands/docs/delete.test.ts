import { describe, expect, it, vi } from "vitest";
import { handleDocsDelete } from "./delete.ts";
import type { DocumentRaw } from "../../lib/docs-api.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

const run = (text: string, startIndex: number) => ({ startIndex, textRun: { content: text } });

/**
 * Three paragraphs and a table between the second and third, which is the shape
 * the report is about: a Markdown insert that became a real Docs table
 * (decision 0021 §6), and which no marker can reach inside.
 *
 * A paragraph's `endIndex` is its `startIndex` plus the length of its content,
 * newline included — so these are arithmetic, not decoration.
 *
 * ```
 *  1..19   "Draft starts here\n"        18 characters
 * 19..35   "the middle line\n"          16
 * 35..55   <table>
 * 55..71   "Draft ends here\n"          16
 * 71..81   "第1回ミーティング\n"           10   <- the anchor the insert went before
 * ```
 */
const document: DocumentRaw = {
  documentId: "D1",
  title: "Minutes",
  body: {
    content: [
      { startIndex: 1, endIndex: 19, paragraph: { elements: [run("Draft starts here\n", 1)] } },
      { startIndex: 19, endIndex: 35, paragraph: { elements: [run("the middle line\n", 19)] } },
      {
        startIndex: 35,
        endIndex: 55,
        table: {
          tableRows: [
            {
              tableCells: [
                { content: [{ startIndex: 38, paragraph: { elements: [run("a cell\n", 38)] } }] },
              ],
            },
          ],
        },
      },
      { startIndex: 55, endIndex: 71, paragraph: { elements: [run("Draft ends here\n", 55)] } },
      { startIndex: 71, endIndex: 81, paragraph: { elements: [run("第1回ミーティング\n", 71)] } },
    ],
  },
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    resolvePath: vi.fn(async () => "D1"),
    getDocument: vi.fn(async () => document),
    deleteRange: vi.fn(async () => {}),
    file: "Minutes",
    format: "json" as const,
    quiet: false,
    write: () => {},
    ...overrides,
  };
}

describe("handleDocsDelete (issue #41, decision 0062)", () => {
  it("removes from the start of --from through the end of --to", async () => {
    const d = deps();
    await handleDocsDelete({ ...d, from: "Draft starts here", to: "Draft ends here" });

    // 1 is where the first marker begins; 71 is the end of "Draft ends here"'s
    // paragraph *including its newline*, so nothing is left where it was.
    expect(d.deleteRange).toHaveBeenCalledWith("D1", { startIndex: 1, endIndex: 71 });
  });

  /**
   * The report's actual complaint. `replace --replace ""` takes the text and
   * leaves the paragraph, so undoing a 35-paragraph insert leaves 35 blank
   * lines. A range that reaches a paragraph's last character takes its newline
   * too (0062 §3), and that off-by-one is the whole difference.
   */
  it("takes the paragraph mark, so no blank line is left behind", async () => {
    const d = deps();
    await handleDocsDelete({ ...d, from: "the middle line", to: "the middle line" });
    expect(d.deleteRange).toHaveBeenCalledWith("D1", { startIndex: 19, endIndex: 35 });
  });

  it("spans a table, which is the thing no marker can reach into", async () => {
    const d = deps();
    await handleDocsDelete({ ...d, from: "the middle line", to: "Draft ends here" });
    expect(d.deleteRange).toHaveBeenCalledWith("D1", { startIndex: 19, endIndex: 71 });
  });

  /** Docs refuses to remove the body's final newline (0062 §3). */
  it("stops one character short of the document's last paragraph mark", async () => {
    const d = deps();
    await handleDocsDelete({ ...d, from: "Draft starts here", to: "第1回ミーティング" });
    expect(d.deleteRange).toHaveBeenCalledWith("D1", { startIndex: 1, endIndex: 80 });
  });

  it("deletes an explicit index and length", async () => {
    const d = deps();
    await handleDocsDelete({ ...d, index: "19", length: "16" });
    expect(d.deleteRange).toHaveBeenCalledWith("D1", { startIndex: 19, endIndex: 35 });
  });

  describe("refusals, none of which reach the document", () => {
    it("refuses a marker that matches more than once", async () => {
      const twice: DocumentRaw = {
        documentId: "D1",
        body: {
          content: [
            { startIndex: 1, endIndex: 7, paragraph: { elements: [run("HERE\n", 1)] } },
            { startIndex: 7, endIndex: 13, paragraph: { elements: [run("HERE\n", 7)] } },
          ],
        },
      };
      const d = deps({ getDocument: vi.fn(async () => twice) });
      await expect(handleDocsDelete({ ...d, from: "HERE", to: "HERE" })).rejects.toMatchObject({
        code: "INVALID_ARGS",
      });
      expect(d.deleteRange).not.toHaveBeenCalled();
    });

    it("refuses a marker that matches nothing", async () => {
      const d = deps();
      await expect(
        handleDocsDelete({ ...d, from: "nowhere", to: "Draft ends here" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(d.deleteRange).not.toHaveBeenCalled();
    });

    it("refuses --to before --from, rather than sending an inverted range", async () => {
      const d = deps();
      await expect(
        handleDocsDelete({ ...d, from: "Draft ends here", to: "Draft starts here" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGS" });
      expect(d.deleteRange).not.toHaveBeenCalled();
    });

    it("refuses a position that is neither pair", async () => {
      const d = deps();
      await expect(handleDocsDelete({ ...d, from: "Draft starts here" })).rejects.toMatchObject({
        code: "INVALID_ARGS",
      });
      await expect(handleDocsDelete({ ...d })).rejects.toMatchObject({ code: "INVALID_ARGS" });
      await expect(handleDocsDelete({ ...d, index: "1" })).rejects.toMatchObject({
        code: "INVALID_ARGS",
      });
      expect(d.deleteRange).not.toHaveBeenCalled();
    });

    it("refuses a length that would delete nothing", async () => {
      const d = deps();
      await expect(handleDocsDelete({ ...d, index: "5", length: "0" })).rejects.toMatchObject({
        code: "INVALID_ARGS",
      });
      expect(d.deleteRange).not.toHaveBeenCalled();
    });
  });

  /**
   * 0062 §4. What a deletion removes is not visible in its arguments — two
   * markers name two ends and the caller is trusting their memory of what lies
   * between them.
   */
  it("--dry-run reports the range and its ends, and writes nothing", async () => {
    const out = collect();
    const d = deps({ write: out.write });
    await handleDocsDelete({
      ...d,
      from: "Draft starts here",
      to: "Draft ends here",
      dryRun: true,
    });

    expect(d.deleteRange).not.toHaveBeenCalled();
    const parsed: unknown = JSON.parse(out.output);
    expect(parsed).toMatchObject({
      success: true,
      data: {
        id: "D1",
        dry_run: true,
        deleted: false,
        range: { start_index: 1, end_index: 71 },
        characters: 70,
      },
    });
  });

  it("reports what it removed", async () => {
    const out = collect();
    const d = deps({ write: out.write });
    await handleDocsDelete({
      ...d,
      from: "the middle line",
      to: "the middle line",
      write: out.write,
    });

    expect(JSON.parse(out.output)).toMatchObject({
      data: { id: "D1", deleted: true, characters: 16 },
    });
  });

  it("-q prints the character count, which is the one number a script wants", async () => {
    const out = collect();
    const d = deps({ write: out.write, format: "text" as const, quiet: true });
    await handleDocsDelete({ ...d, from: "the middle line", to: "the middle line" });
    expect(out.output).toBe("16");
  });
});
