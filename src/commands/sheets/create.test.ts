import { describe, expect, it, vi } from "vitest";
import { handleSheetsCreate } from "./create.ts";

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
});
