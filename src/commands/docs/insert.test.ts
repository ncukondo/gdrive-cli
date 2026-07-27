import { describe, expect, it, vi } from "vitest";
import { handleDocsInsert, resolveInsertIndex } from "./insert.ts";
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

const document: DocumentRaw = {
  documentId: "D1",
  title: "Meeting notes",
  body: { content: [{ startIndex: 1, endIndex: 12, paragraph: {} }] },
};

/** A body whose paragraphs carry markers, for the --before/--after tests. */
const run = (text: string, startIndex: number) => ({ startIndex, textRun: { content: text } });
const marked: DocumentRaw = {
  documentId: "D1",
  title: "Meeting notes",
  body: {
    content: [
      { startIndex: 1, endIndex: 21, paragraph: { elements: [run("before HERE after\n", 1)] } },
      {
        startIndex: 21,
        endIndex: 40,
        table: {
          tableRows: [
            {
              tableCells: [
                { content: [{ startIndex: 24, paragraph: { elements: [run("HERE\n", 24)] } }] },
              ],
            },
          ],
        },
      },
      { startIndex: 40, endIndex: 50, paragraph: { elements: [run("tail here\n", 40)] } },
    ],
  },
};

const baseDeps = () => ({
  resolvePath: vi.fn(async () => "D1"),
  getDocument: vi.fn(async () => document),
  insertText: vi.fn(async (_id: string, _index: number, _text: string) => {}),
  insertMarkdown: vi.fn(async (_id: string, _index: number, _source: string) => []),
  readInput: vi.fn(async (arg: string) => arg),
  warn: vi.fn(),
  file: "Notes",
  text: "hi",
  format: "text" as const,
  quiet: false,
  write: () => {},
});

describe("resolveInsertIndex", () => {
  it("maps --at start to 1 and --at end to the body end", () => {
    expect(resolveInsertIndex({ at: "start" }, document)).toBe(1);
    expect(resolveInsertIndex({ at: "end" }, document)).toBe(11);
  });

  // "before HERE after" at 1, a cell holding HERE at 24, "tail here" at 40.
  it("resolves --before to the marker's start and --after to its end", () => {
    expect(resolveInsertIndex({ before: "HERE", matchCase: true }, marked)).toBe(8);
    expect(resolveInsertIndex({ after: "HERE", matchCase: true }, marked)).toBe(12);
  });

  it("is NOT_FOUND when the marker is absent", () => {
    expect(() => resolveInsertIndex({ before: "NOPE" }, marked)).toThrow(/NOPE/);
    try {
      resolveInsertIndex({ before: "NOPE" }, marked);
    } catch (error) {
      expect(error).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("is INVALID_ARGS with the count when the marker is ambiguous", () => {
    // case-insensitively, "HERE" also matches the "here" in "tail here"
    try {
      resolveInsertIndex({ before: "HERE" }, marked);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_ARGS" });
      expect((error as Error).message).toMatch(/2 times/);
    }
  });

  it("narrows an ambiguous marker with --match-case", () => {
    expect(resolveInsertIndex({ before: "here", matchCase: true }, marked)).toBe(45);
  });

  it("does not see a marker that only exists inside a table cell", () => {
    const inTable: DocumentRaw = { body: { content: marked.body?.content?.slice(1, 2) ?? [] } };
    expect(() => resolveInsertIndex({ before: "HERE" }, inTable)).toThrow(/HERE/);
  });

  it("takes exactly one position, still", () => {
    expect(() => resolveInsertIndex({ before: "HERE", at: "start" }, marked)).toThrow(
      /only one of/i,
    );
    expect(() => resolveInsertIndex({ before: "HERE", index: "4" }, marked)).toThrow(
      /only one of/i,
    );
    expect(() => resolveInsertIndex({}, marked)).toThrow(/Specify a position/);
  });

  it("uses --index verbatim", () => {
    expect(resolveInsertIndex({ index: "5" }, document)).toBe(5);
  });

  it("rejects a missing position, both options, bad values", () => {
    expect(() => resolveInsertIndex({}, document)).toThrow(/--index/);
    expect(() => resolveInsertIndex({ index: "3", at: "end" }, document)).toThrow(/only one/i);
    expect(() => resolveInsertIndex({ index: "0" }, document)).toThrow(/--index/);
    expect(() => resolveInsertIndex({ index: "x" }, document)).toThrow(/--index/);
    expect(() => resolveInsertIndex({ at: "middle" }, document)).toThrow(/--at/);
  });
});

describe("handleDocsInsert", () => {
  it("inserts Markdown at an explicit index by default", async () => {
    const d = baseDeps();
    const out = collect();
    await handleDocsInsert({ ...d, index: "4", write: out.write });
    expect(d.insertMarkdown).toHaveBeenCalledWith("D1", 4, "hi");
    expect(d.insertText).not.toHaveBeenCalled();
    expect(out.output).toBe("Inserted into Meeting notes (D1)");
  });

  it("--as text inserts the exact bytes", async () => {
    const d = baseDeps();
    await handleDocsInsert({ ...d, index: "4", as: "text" });
    expect(d.insertText).toHaveBeenCalledWith("D1", 4, "hi");
    expect(d.insertMarkdown).not.toHaveBeenCalled();
  });

  it("inserts at a marker end to end", async () => {
    const d = baseDeps();
    await handleDocsInsert({
      ...d,
      getDocument: vi.fn(async () => marked),
      before: "HERE",
      matchCase: true,
      text: "@table.md",
      readInput: vi.fn(async () => "| a |\n| --- |"),
    });
    expect(d.insertMarkdown).toHaveBeenCalledWith("D1", 8, "| a |\n| --- |");
  });

  it("inserts at the end of the body with --at end", async () => {
    const d = baseDeps();
    await handleDocsInsert({ ...d, at: "end" });
    expect(d.insertMarkdown).toHaveBeenCalledWith("D1", 11, "hi");
  });

  it("reads the text through the @file/stdin reader and rejects empty text", async () => {
    const d = baseDeps();
    const readInput = vi.fn(async () => "from stdin");
    await handleDocsInsert({ ...d, text: "-", readInput, at: "start", as: "text" });
    expect(readInput).toHaveBeenCalledWith("-");
    expect(d.insertText).toHaveBeenCalledWith("D1", 1, "from stdin");

    await expect(
      handleDocsInsert({ ...baseDeps(), at: "start", text: "", readInput: vi.fn(async () => "") }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("prints the document id in quiet mode and the envelope in JSON", async () => {
    const q = collect();
    await handleDocsInsert({ ...baseDeps(), at: "end", quiet: true, write: q.write });
    expect(q.output).toBe("D1");

    const j = collect();
    await handleDocsInsert({ ...baseDeps(), at: "end", format: "json", write: j.write });
    expect(JSON.parse(j.output)).toEqual({
      success: true,
      data: { id: "D1", title: "Meeting notes", index: 11 },
    });
  });
});
