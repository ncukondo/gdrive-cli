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
