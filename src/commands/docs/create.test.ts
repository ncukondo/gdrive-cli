import { describe, expect, it, vi } from "vitest";
import { handleDocsCreate } from "./create.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

const baseDeps = () => ({
  resolvePath: vi.fn(async () => "PID"),
  createDocument: vi.fn(async (title: string) => ({ id: "NEW", title })),
  insertText: vi.fn(async (_id: string, _index: number, _text: string) => {}),
  insertMarkdown: vi.fn(async (_id: string, _index: number, _source: string) => []),
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
    expect(d.insertMarkdown).toHaveBeenCalledWith("NEW", 1, "<@notes.md>");
    expect(d.insertText).not.toHaveBeenCalled();
  });

  it("--as text inserts --content verbatim", async () => {
    const d = baseDeps();
    await handleDocsCreate({ ...d, content: "@notes.md", as: "text" });
    expect(d.insertText).toHaveBeenCalledWith("NEW", 1, "<@notes.md>");
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
