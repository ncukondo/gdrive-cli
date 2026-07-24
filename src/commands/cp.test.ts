import { describe, expect, it, vi } from "vitest";
import { handleCp } from "./cp.ts";
import type { DriveFile } from "../types/index.ts";

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "C1",
    name: "copy",
    mime_type: "text/plain",
    type: "file",
    size: 1,
    parents: ["DEST"],
    trashed: false,
    web_view_link: null,
    created: null,
    modified: null,
    owners: [],
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

describe("handleCp", () => {
  it("resolves source and destination and passes the optional name", async () => {
    const resolvePath = vi.fn(async (a: string) => (a === "src" ? "S1" : "DEST"));
    const copyFile = vi.fn(async (_id: string, _p: string, _n?: string) => file());
    await handleCp({
      resolvePath,
      copyFile,
      file: "src",
      dest: "Folder",
      name: "renamed",
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(copyFile).toHaveBeenCalledWith("S1", "DEST", "renamed");
  });

  it("renders text and quiet", async () => {
    const out = collect();
    await handleCp({
      resolvePath: async (a) => (a === "src" ? "S1" : "DEST"),
      copyFile: async () => file({ id: "C1", name: "copy" }),
      file: "src",
      dest: "Folder",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toBe("Copied to copy (C1)");

    const q = collect();
    await handleCp({
      resolvePath: async () => "S1",
      copyFile: async () => file({ id: "C1" }),
      file: "src",
      dest: "Folder",
      format: "text",
      quiet: true,
      write: q.write,
    });
    expect(q.output).toBe("C1");
  });
});
