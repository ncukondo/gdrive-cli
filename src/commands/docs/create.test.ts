import { describe, expect, it, vi } from "vitest";
import { handleDocsCreate } from "./create.ts";
import type { ParagraphBoundary } from "../../lib/docs-api.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

/** A document created a moment ago is one empty paragraph, both of whose edges
 * index 1 is — so the content it is given is the whole of it (0045 §2). */
const EMPTY: ParagraphBoundary = { atParagraphStart: true, atParagraphEnd: true };

const baseDeps = () => ({
  resolvePath: vi.fn(async () => "PID"),
  createDocument: vi.fn(async (title: string) => ({ id: "NEW", title })),
  insertText: vi.fn(
    async (_id: string, _index: number, _text: string, _b: ParagraphBoundary) => {},
  ),
  insertMarkdown: vi.fn(
    async (_id: string, _index: number, _source: string, _o: { boundary: ParagraphBoundary }) => [],
  ),
  warn: vi.fn(),
  moveFile: vi.fn(async (_id: string, _parentId: string) => {}),
  readInput: vi.fn(async (arg: string) => `<${arg}>`),
  title: "Plan",
  format: "text" as const,
  quiet: false,
  write: () => {},
});

describe("handleDocsCreate", () => {
  it("creates an empty document with no content or parent", async () => {
    const d = baseDeps();
    const out = collect();
    await handleDocsCreate({ ...d, write: out.write });
    expect(d.createDocument).toHaveBeenCalledWith("Plan");
    expect(d.insertText).not.toHaveBeenCalled();
    expect(d.moveFile).not.toHaveBeenCalled();
    expect(d.resolvePath).not.toHaveBeenCalled();
    expect(out.output).toBe("Created Plan (NEW)");
  });

  /** A title carrying a newline must not turn one confirmation into two. */
  it("keeps a title holding a newline on one line", async () => {
    const d = baseDeps();
    const out = collect();
    await handleDocsCreate({ ...d, title: "Q1\nplan", write: out.write });
    expect(out.output).toBe("Created Q1 plan (NEW)");
  });

  it("inserts --content as Markdown at the start of the body", async () => {
    const d = baseDeps();
    await handleDocsCreate({ ...d, content: "@notes.md" });
    expect(d.readInput).toHaveBeenCalledWith("@notes.md");
    expect(d.insertMarkdown).toHaveBeenCalledWith("NEW", 1, "<@notes.md>", { boundary: EMPTY });
    expect(d.insertText).not.toHaveBeenCalled();
  });

  it("--as text inserts --content verbatim", async () => {
    const d = baseDeps();
    await handleDocsCreate({ ...d, content: "@notes.md", as: "text" });
    expect(d.insertText).toHaveBeenCalledWith("NEW", 1, "<@notes.md>", EMPTY);
    expect(d.insertMarkdown).not.toHaveBeenCalled();
  });

  it("skips the insert when the content is empty", async () => {
    const d = baseDeps();
    await handleDocsCreate({ ...d, content: "", readInput: vi.fn(async () => "") });
    expect(d.insertText).not.toHaveBeenCalled();
    expect(d.insertMarkdown).not.toHaveBeenCalled();
  });

  it("moves the document into --parent", async () => {
    const d = baseDeps();
    const out = collect();
    await handleDocsCreate({ ...d, parent: "Reports", format: "json", write: out.write });
    expect(d.resolvePath).toHaveBeenCalledWith("Reports");
    expect(d.moveFile).toHaveBeenCalledWith("NEW", "PID");
    expect(JSON.parse(out.output)).toEqual({
      success: true,
      data: { id: "NEW", title: "Plan", parent_id: "PID" },
    });
  });

  it("prints the new id in quiet mode", async () => {
    const d = baseDeps();
    const out = collect();
    await handleDocsCreate({ ...d, quiet: true, write: out.write });
    expect(out.output).toBe("NEW");
  });
});
