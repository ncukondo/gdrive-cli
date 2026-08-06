import { describe, expect, it, vi } from "vitest";
import { handleDocsCreate } from "./create.ts";
import type { ParagraphBoundary } from "../../lib/docs-api.ts";
import { childrenNamed, ROOT_ID } from "../../lib/resolve-path.ts";
import { createWritableTreeDrive, type DriveNode } from "../../../tests/helpers/fake-drive.ts";
import { UNPATHABLE_ANYWHERE, UNPATHABLE_AT_A_DRIVE_ROOT } from "../../../tests/helpers/names.ts";

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

/**
 * `calls` records the order the Drive and Docs calls go out in, which is the
 * subject of the cases below: a document is moved into `--parent` before
 * anything is written into it, so a write that fails leaves it there rather
 * than in My Drive's root (issue #36).
 */
const baseDeps = (calls: string[] = []) => ({
  resolvePath: vi.fn(async () => "PID"),
  createDocument: vi.fn(async (title: string) => {
    calls.push("create");
    return { id: "NEW", title };
  }),
  insertText: vi.fn(async (_id: string, _index: number, _text: string, _b: ParagraphBoundary) => {
    calls.push("insert");
  }),
  insertMarkdown: vi.fn(
    async (_id: string, _index: number, _source: string, _o: { boundary: ParagraphBoundary }) => {
      calls.push("insert");
      return [];
    },
  ),
  warn: vi.fn(),
  moveFile: vi.fn(async (_id: string, _parentId: string) => {
    calls.push("move");
  }),
  findSiblings: vi.fn(async (_p: string, _n: string) => []),
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

  /**
   * Issue #36. The Docs API ignores a parent, so a document exists in My Drive's
   * root from the moment it is created; the move is the only thing that takes it
   * out. Doing that *before* the content goes in is what keeps a failed write
   * from leaving a document outside the folder the caller named — and outside
   * the sandbox the live suite writes inside (0043 §2).
   */
  it("moves the document into --parent before it writes any content", async () => {
    const calls: string[] = [];
    const d = baseDeps(calls);
    await handleDocsCreate({ ...d, parent: "Reports", content: "@notes.md" });
    expect(calls).toEqual(["create", "move", "insert"]);
  });

  it("leaves a document whose content failed inside --parent", async () => {
    const calls: string[] = [];
    const d = baseDeps(calls);
    await expect(
      handleDocsCreate({
        ...d,
        parent: "Reports",
        content: "@notes.md",
        insertMarkdown: async () => {
          throw new Error("Docs said no");
        },
      }),
    ).rejects.toThrow("Docs said no");
    expect(d.moveFile).toHaveBeenCalledWith("NEW", "PID");
    expect(calls).toEqual(["create", "move"]);
  });

  it("issues no move at all without --parent", async () => {
    const calls: string[] = [];
    const d = baseDeps(calls);
    await handleDocsCreate({ ...d, content: "@notes.md" });
    expect(calls).toEqual(["create", "insert"]);
  });

  it("prints the new id in quiet mode", async () => {
    const d = baseDeps();
    const out = collect();
    await handleDocsCreate({ ...d, quiet: true, write: out.write });
    expect(out.output).toBe("NEW");
  });

  /**
   * Decision 0055 §1–§2. The title is the Drive name, so the same `create` run
   * twice is the collision — and §2 puts the check ahead of `documents.create`,
   * because a refusal afterwards leaves a document the caller has to go and
   * delete, content and all.
   */
  describe("a title that would not address the new document", () => {
    const against = (nodes: DriveNode[]) => {
      const { client } = createWritableTreeDrive(nodes);
      return {
        ...baseDeps(),
        findSiblings: (parentId: string, name: string) => childrenNamed(client, parentId, name),
      };
    };

    it("refuses a title --parent already holds, and creates nothing", async () => {
      const d = against([{ id: "E1", name: "Plan", parents: ["PID"] }]);
      await expect(
        handleDocsCreate({ ...d, parent: "Reports", content: "@notes.md" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGS", message: expect.stringContaining("E1") });
      expect(d.createDocument).not.toHaveBeenCalled();
      expect(d.insertMarkdown).not.toHaveBeenCalled();
      expect(d.moveFile).not.toHaveBeenCalled();
    });

    it("refuses a title the My Drive root already holds", async () => {
      const d = against([{ id: "E1", name: "Plan", parents: [ROOT_ID] }]);
      await expect(handleDocsCreate(d)).rejects.toMatchObject({ code: "INVALID_ARGS" });
      expect(d.createDocument).not.toHaveBeenCalled();
    });

    it.each(UNPATHABLE_ANYWHERE)(
      "refuses %j wherever it would land, without asking Drive anything",
      async (title) => {
        for (const parent of [undefined, "Notes"]) {
          const d = baseDeps();
          await expect(
            handleDocsCreate({ ...d, title, ...(parent === undefined ? {} : { parent }) }),
          ).rejects.toMatchObject({ code: "INVALID_ARGS" });
          expect(d.findSiblings).not.toHaveBeenCalled();
          expect(d.createDocument).not.toHaveBeenCalled();
        }
      },
    );

    it.each(UNPATHABLE_AT_A_DRIVE_ROOT)(
      "refuses %j with no --parent, where the title is the whole path argument",
      async (title) => {
        const d = baseDeps();
        await expect(handleDocsCreate({ ...d, title })).rejects.toMatchObject({
          code: "INVALID_ARGS",
        });
        expect(d.findSiblings).not.toHaveBeenCalled();
        expect(d.createDocument).not.toHaveBeenCalled();
      },
    );

    /** Decision 0056 §2's other half: below a root every one of them works. */
    it.each(UNPATHABLE_AT_A_DRIVE_ROOT)("creates %j inside --parent", async (title) => {
      const d = baseDeps();
      await handleDocsCreate({ ...d, title, parent: "Notes" });
      expect(d.createDocument).toHaveBeenCalledWith(title);
    });
  });
});
