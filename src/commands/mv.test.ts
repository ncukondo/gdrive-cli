import { describe, expect, it, vi } from "vitest";
import { handleMv } from "./mv.ts";
import type { DriveFile } from "../types/index.ts";

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "M1",
    name: "doc",
    mime_type: "text/plain",
    type: "file",
    size: 1,
    parents: ["DEST"],
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

describe("handleMv", () => {
  it("resolves the source and the destination separately, then moves", async () => {
    // Two deps because the two arguments play different roles: the source is an
    // entry, the destination a container (decision 0025 §1, §3).
    const resolvePath = vi.fn(async () => "M1");
    const resolveFolder = vi.fn(async () => "DEST");
    const moveFile = vi.fn(async (_id: string, _p: string) => file());
    await handleMv({
      resolvePath,
      resolveFolder,
      moveFile,
      file: "doc",
      dest: "Folder",
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(resolvePath).toHaveBeenCalledWith("doc");
    expect(resolvePath).not.toHaveBeenCalledWith("Folder");
    expect(resolveFolder).toHaveBeenCalledWith("Folder");
    expect(moveFile).toHaveBeenCalledWith("M1", "DEST");
  });

  it("renders text and quiet", async () => {
    const out = collect();
    await handleMv({
      resolvePath: async () => "M1",
      resolveFolder: async () => "DEST",
      moveFile: async () => file({ id: "M1", name: "doc" }),
      file: "doc",
      dest: "Folder",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toBe("Moved doc to DEST");

    const q = collect();
    await handleMv({
      resolvePath: async () => "M1",
      resolveFolder: async () => "DEST",
      moveFile: async () => file({ id: "M1" }),
      file: "doc",
      dest: "Folder",
      format: "text",
      quiet: true,
      write: q.write,
    });
    expect(q.output).toBe("M1");
  });
});
