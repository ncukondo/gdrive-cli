import { describe, expect, it, vi } from "vitest";
import { handleSheetsCreate } from "./create.ts";
import { childrenNamed, ROOT_ID } from "../../lib/resolve-path.ts";
import { createWritableTreeDrive, type DriveNode } from "../../../tests/helpers/fake-drive.ts";

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
  createSpreadsheet: vi.fn(async (title: string) => ({ id: "NEW", title })),
  moveFile: vi.fn(async (_id: string, _parentId: string) => {}),
  findSiblings: vi.fn(async (_p: string, _n: string) => []),
  title: "Budget",
  format: "text" as const,
  quiet: false,
  write: () => {},
});

describe("handleSheetsCreate", () => {
  it("creates a spreadsheet in My Drive by default", async () => {
    const d = baseDeps();
    const out = collect();
    await handleSheetsCreate({ ...d, write: out.write });
    expect(d.createSpreadsheet).toHaveBeenCalledWith("Budget");
    expect(d.moveFile).not.toHaveBeenCalled();
    expect(out.output).toBe("Created Budget (NEW)");
  });

  it("moves the spreadsheet into --parent", async () => {
    const d = baseDeps();
    const out = collect();
    await handleSheetsCreate({ ...d, parent: "Reports", format: "json", write: out.write });
    expect(d.resolvePath).toHaveBeenCalledWith("Reports");
    expect(d.moveFile).toHaveBeenCalledWith("NEW", "PID");
    expect(JSON.parse(out.output)).toEqual({
      success: true,
      data: { id: "NEW", title: "Budget", parent_id: "PID" },
    });
  });

  it("prints the new id in quiet mode", async () => {
    const out = collect();
    await handleSheetsCreate({ ...baseDeps(), quiet: true, write: out.write });
    expect(out.output).toBe("NEW");
  });

  /**
   * Decision 0055 §1–§2. The title is the Drive name, so the same `create` run
   * twice is the collision — and §2 puts the check ahead of
   * `spreadsheets.create`, because a refusal afterwards leaves a spreadsheet the
   * caller has to go and delete.
   */
  describe("a title that would not address the new spreadsheet", () => {
    const against = (nodes: DriveNode[]) => {
      const { client } = createWritableTreeDrive(nodes);
      return {
        ...baseDeps(),
        findSiblings: (parentId: string, name: string) => childrenNamed(client, parentId, name),
      };
    };

    it("refuses a title --parent already holds, and creates nothing", async () => {
      const d = against([{ id: "E1", name: "Budget", parents: ["PID"] }]);
      await expect(handleSheetsCreate({ ...d, parent: "Reports" })).rejects.toMatchObject({
        code: "INVALID_ARGS",
        message: expect.stringContaining("E1"),
      });
      expect(d.createSpreadsheet).not.toHaveBeenCalled();
      expect(d.moveFile).not.toHaveBeenCalled();
    });

    it("refuses a title the My Drive root already holds", async () => {
      const d = against([{ id: "E1", name: "Budget", parents: [ROOT_ID] }]);
      await expect(handleSheetsCreate(d)).rejects.toMatchObject({ code: "INVALID_ARGS" });
      expect(d.createSpreadsheet).not.toHaveBeenCalled();
    });

    it.each([" Budget", "Budget ", "Q1/Q2"])(
      "refuses %j without asking Drive anything",
      async (title) => {
        const d = baseDeps();
        await expect(handleSheetsCreate({ ...d, title })).rejects.toMatchObject({
          code: "INVALID_ARGS",
        });
        expect(d.findSiblings).not.toHaveBeenCalled();
        expect(d.createSpreadsheet).not.toHaveBeenCalled();
      },
    );
  });
});
