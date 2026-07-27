import { describe, expect, it, vi } from "vitest";
import { handleDocsAppend } from "./append.ts";
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

const document = (endIndex: number): DocumentRaw => ({
  documentId: "D1",
  title: "Meeting notes",
  body: { content: [{ startIndex: 1, endIndex, paragraph: {} }] },
});

const baseDeps = () => ({
  resolvePath: vi.fn(async () => "D1"),
  getDocument: vi.fn(async () => document(7)),
  insertText: vi.fn(async (_id: string, _index: number, _text: string) => {}),
  insertMarkdown: vi.fn(
    async (_id: string, _index: number, _source: string, _o?: { leadingNewline?: boolean }) => [],
  ),
  readInput: vi.fn(async (arg: string) => arg),
  warn: vi.fn(),
  file: "Notes",
  text: "new line",
  format: "text" as const,
  quiet: false,
  write: () => {},
});

describe("handleDocsAppend", () => {
  it("appends Markdown at the end of the body by default", async () => {
    const d = baseDeps();
    const out = collect();
    await handleDocsAppend({ ...d, write: out.write });
    expect(d.resolvePath).toHaveBeenCalledWith("Notes");
    expect(d.insertMarkdown).toHaveBeenCalledWith("D1", 6, "new line", { leadingNewline: true });
    expect(d.insertText).not.toHaveBeenCalled();
    expect(out.output).toBe("Appended to Meeting notes (D1)");
  });

  it("--as text appends the exact bytes, as it always did", async () => {
    const d = baseDeps();
    await handleDocsAppend({ ...d, as: "text" });
    expect(d.insertText).toHaveBeenCalledWith("D1", 6, "\nnew line");
    expect(d.insertMarkdown).not.toHaveBeenCalled();
  });

  it("does not add a leading newline to an empty document", async () => {
    const d = baseDeps();
    await handleDocsAppend({ ...d, getDocument: vi.fn(async () => document(1)) });
    expect(d.insertMarkdown).toHaveBeenCalledWith("D1", 1, "new line", { leadingNewline: false });

    const t = baseDeps();
    await handleDocsAppend({ ...t, as: "text", getDocument: vi.fn(async () => document(1)) });
    expect(t.insertText).toHaveBeenCalledWith("D1", 1, "new line");
  });

  it("reads the text through the @file/stdin reader", async () => {
    const d = baseDeps();
    const readInput = vi.fn(async () => "from file");
    await handleDocsAppend({ ...d, as: "text", text: "@note.txt", readInput });
    expect(readInput).toHaveBeenCalledWith("@note.txt");
    expect(d.insertText).toHaveBeenCalledWith("D1", 6, "\nfrom file");
  });

  it("rejects an --as value that is neither format", async () => {
    await expect(handleDocsAppend({ ...baseDeps(), as: "html" })).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
  });

  it("warns in text mode and reports in JSON what stayed literal", async () => {
    const notes = [{ line: 2, kind: "image" as const }];
    const d = { ...baseDeps(), insertMarkdown: vi.fn(async () => notes) };
    await handleDocsAppend(d);
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining("image (line 2)"));

    const j = collect();
    const json = { ...baseDeps(), insertMarkdown: vi.fn(async () => notes) };
    await handleDocsAppend({ ...json, format: "json", write: j.write });
    expect(JSON.parse(j.output).data.unsupported).toEqual(notes);
    expect(json.warn).not.toHaveBeenCalled();
  });

  it("rejects empty text with INVALID_ARGS", async () => {
    const d = baseDeps();
    await expect(
      handleDocsAppend({ ...d, text: "", readInput: vi.fn(async () => "") }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("prints the document id in quiet mode and the envelope in JSON", async () => {
    const q = collect();
    await handleDocsAppend({ ...baseDeps(), quiet: true, write: q.write });
    expect(q.output).toBe("D1");

    const j = collect();
    await handleDocsAppend({ ...baseDeps(), format: "json", write: j.write });
    expect(JSON.parse(j.output)).toEqual({
      success: true,
      data: { id: "D1", title: "Meeting notes" },
    });
  });
});
