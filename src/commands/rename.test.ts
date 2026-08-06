import { describe, expect, it, vi } from "vitest";
import { handleRename } from "./rename.ts";
import type { DriveFile } from "../types/index.ts";

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "R1",
    name: "Notes 2026",
    mime_type: "application/vnd.google-apps.document",
    type: "doc",
    size: null,
    parents: ["rep1"],
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

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

describe("handleRename", () => {
  it("renames the file the argument resolves to, by id or by path", async () => {
    for (const arg of ["R1", "Reports/Notes"]) {
      const resolvePath = vi.fn(async () => "R1");
      const renameFile = vi.fn(async (_id: string, _name: string) => file());
      await handleRename({
        resolvePath,
        renameFile,
        file: arg,
        name: "Notes 2026",
        format: "text",
        quiet: false,
        write: () => {},
        warn: () => {},
      });
      expect(resolvePath).toHaveBeenCalledWith(arg);
      expect(renameFile).toHaveBeenCalledWith("R1", "Notes 2026");
    }
  });

  it("renders text, quiet and JSON", async () => {
    const deps = {
      resolvePath: async () => "R1",
      renameFile: async () => file(),
      file: "Reports/Notes",
      name: "Notes 2026",
      warn: () => {},
    };

    const text = collect();
    await handleRename({ ...deps, format: "text", quiet: false, write: text.write });
    expect(text.output).toBe("Renamed to Notes 2026 (R1)");

    const quiet = collect();
    await handleRename({ ...deps, format: "text", quiet: true, write: quiet.write });
    expect(quiet.output).toBe("R1");

    const json = collect();
    await handleRename({ ...deps, format: "json", quiet: false, write: json.write });
    expect(JSON.parse(json.output)).toMatchObject({
      success: true,
      data: { file: { id: "R1", name: "Notes 2026" } },
    });
  });

  it("refuses an empty or whitespace-only name before it asks Drive anything", async () => {
    for (const name of ["", "   ", "\t\n"]) {
      const resolvePath = vi.fn(async () => "R1");
      const renameFile = vi.fn(async () => file());
      await expect(
        handleRename({
          resolvePath,
          renameFile,
          file: "Reports/Notes",
          name,
          format: "text",
          quiet: false,
          write: () => {},
          warn: () => {},
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGS" });
      // Resolving a path is itself a Drive call, so nothing may run first.
      expect(resolvePath).not.toHaveBeenCalled();
      expect(renameFile).not.toHaveBeenCalled();
    }
  });
});
