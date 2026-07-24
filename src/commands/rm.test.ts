import { describe, expect, it, vi } from "vitest";
import { handleRm } from "./rm.ts";
import type { DriveFile } from "../types/index.ts";

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "R1",
    name: "junk",
    mime_type: "text/plain",
    type: "file",
    size: 1,
    parents: ["root"],
    trashed: true,
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
    get calls() {
      return lines.length;
    },
  };
}

describe("handleRm", () => {
  it("trashes by default (not permanent delete)", async () => {
    const trashFile = vi.fn(async () => file());
    const deleteFile = vi.fn(async () => {});
    const out = collect();
    await handleRm({
      resolvePath: async () => "R1",
      trashFile,
      deleteFile,
      file: "junk",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(trashFile).toHaveBeenCalledWith("R1");
    expect(deleteFile).not.toHaveBeenCalled();
    expect(out.output).toBe("Trashed junk (R1)");
  });

  it("permanently deletes with --permanent", async () => {
    const trashFile = vi.fn(async () => file());
    const deleteFile = vi.fn(async () => {});
    const out = collect();
    await handleRm({
      resolvePath: async () => "R1",
      trashFile,
      deleteFile,
      file: "junk",
      permanent: true,
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(deleteFile).toHaveBeenCalledWith("R1");
    expect(trashFile).not.toHaveBeenCalled();
    expect(out.output).toBe("Permanently deleted R1");
  });

  it("emits nothing in quiet mode", async () => {
    const out = collect();
    await handleRm({
      resolvePath: async () => "R1",
      trashFile: async () => file(),
      deleteFile: async () => {},
      file: "junk",
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.calls).toBe(0);
  });

  it("still prints the JSON envelope (quiet does not suppress json)", async () => {
    const out = collect();
    await handleRm({
      resolvePath: async () => "R1",
      trashFile: async () => file(),
      deleteFile: async () => {},
      file: "junk",
      format: "json",
      quiet: true,
      write: out.write,
    });
    expect(JSON.parse(out.output)).toMatchObject({ success: true, data: { trashed: true } });
  });
});
