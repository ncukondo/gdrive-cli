import { describe, expect, it, vi } from "vitest";
import { handleMkdir } from "./mkdir.ts";
import type { DriveFile } from "../types/index.ts";

function folder(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "F1",
    name: "New",
    mime_type: "application/vnd.google-apps.folder",
    type: "folder",
    size: null,
    parents: ["root"],
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

describe("handleMkdir", () => {
  it("creates in root when no --parent (no path resolution)", async () => {
    const resolvePath = vi.fn();
    const createFolder = vi.fn(async (_n: string, _p?: string) => folder());
    await handleMkdir({
      resolvePath,
      createFolder,
      name: "New",
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(resolvePath).not.toHaveBeenCalled();
    expect(createFolder).toHaveBeenCalledWith("New", undefined);
  });

  it("resolves --parent to an id", async () => {
    const resolvePath = vi.fn(async () => "PID");
    const createFolder = vi.fn(async (_n: string, _p?: string) => folder({ parents: ["PID"] }));
    await handleMkdir({
      resolvePath,
      createFolder,
      name: "New",
      parent: "Docs",
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(resolvePath).toHaveBeenCalledWith("Docs");
    expect(createFolder).toHaveBeenCalledWith("New", "PID");
  });

  it("renders text, json, and quiet", async () => {
    const text = collect();
    await handleMkdir({
      resolvePath: vi.fn(),
      createFolder: async () => folder({ id: "F1", name: "New" }),
      name: "New",
      format: "text",
      quiet: false,
      write: text.write,
    });
    expect(text.output).toBe("Created folder New (F1)");

    const json = collect();
    await handleMkdir({
      resolvePath: vi.fn(),
      createFolder: async () => folder({ id: "F1" }),
      name: "New",
      format: "json",
      quiet: false,
      write: json.write,
    });
    expect(JSON.parse(json.output).data.file.id).toBe("F1");

    const quiet = collect();
    await handleMkdir({
      resolvePath: vi.fn(),
      createFolder: async () => folder({ id: "F1" }),
      name: "New",
      format: "text",
      quiet: true,
      write: quiet.write,
    });
    expect(quiet.output).toBe("F1");
  });
});
