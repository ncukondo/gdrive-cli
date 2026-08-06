import { describe, expect, it, vi } from "vitest";
import { handleMkdir, type MkdirDeps } from "./mkdir.ts";
import { childrenNamed, ROOT_ID } from "../lib/resolve-path.ts";
import type { DriveFile } from "../types/index.ts";
import { createWritableTreeDrive, type DriveNode } from "../../tests/helpers/fake-drive.ts";
import { UNPATHABLE_NAMES } from "../../tests/helpers/names.ts";

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

const none = async () => [];

describe("handleMkdir", () => {
  it("creates in root when no --parent (no path resolution)", async () => {
    const resolvePath = vi.fn();
    const createFolder = vi.fn(async (_n: string, _p?: string) => folder());
    await handleMkdir({
      resolvePath,
      createFolder,
      findSiblings: none,
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
      findSiblings: none,
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
      findSiblings: none,
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
      findSiblings: none,
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
      findSiblings: none,
      createFolder: async () => folder({ id: "F1" }),
      name: "New",
      format: "text",
      quiet: true,
      write: quiet.write,
    });
    expect(quiet.output).toBe("F1");
  });

  /**
   * The confirmation is one line and a caller reads it as one. Drive accepts a
   * newline in a folder name, so the name is sanitised on its way into the
   * message: a table is not the only place a name can forge a row.
   */
  it("keeps a name holding a newline on one line, and exact in JSON", async () => {
    const text = collect();
    await handleMkdir({
      resolvePath: vi.fn(),
      findSiblings: none,
      createFolder: async () => folder({ id: "F1", name: "Q1\nreport" }),
      name: "Q1\nreport",
      format: "text",
      quiet: false,
      write: text.write,
    });
    expect(text.output).toBe("Created folder Q1 report (F1)");

    const json = collect();
    await handleMkdir({
      resolvePath: vi.fn(),
      findSiblings: none,
      createFolder: async () => folder({ id: "F1", name: "Q1\nreport" }),
      name: "Q1\nreport",
      format: "json",
      quiet: false,
      write: json.write,
    });
    expect(JSON.parse(json.output).data.file.name).toBe("Q1\nreport");
  });

  /**
   * Decision 0055 §1. Two folders with one name in one folder make
   * `resolve-path.ts` answer *Ambiguous path segment* for both, so the second
   * `mkdir` is what loses the first one.
   *
   * The real `childrenNamed` runs against a tree, so what is asserted is the
   * folder looked in and the name looked for, not a stub's opinion.
   */
  describe("a name that would not address the new folder", () => {
    const against = (nodes: DriveNode[], overrides: Partial<MkdirDeps> = {}): MkdirDeps => {
      const { client } = createWritableTreeDrive(nodes);
      return {
        resolvePath: async () => "PID",
        createFolder: async () => folder(),
        findSiblings: (parentId, name) => childrenNamed(client, parentId, name),
        name: "New",
        format: "text",
        quiet: false,
        write: () => {},
        ...overrides,
      };
    };

    it("refuses a name --parent already holds, and creates nothing", async () => {
      const createFolder = vi.fn(async () => folder());
      await expect(
        handleMkdir(
          against([{ id: "E1", name: "New", parents: ["PID"] }], {
            createFolder,
            parent: "Docs",
          }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_ARGS", message: expect.stringContaining("E1") });
      expect(createFolder).not.toHaveBeenCalled();
    });

    /**
     * No `--parent` means the My Drive root, which is a folder like any other:
     * the check looks there under the alias a path walk starts from.
     */
    it("refuses a name the My Drive root already holds", async () => {
      const createFolder = vi.fn(async () => folder());
      await expect(
        handleMkdir(against([{ id: "E1", name: "New", parents: [ROOT_ID] }], { createFolder })),
      ).rejects.toMatchObject({ code: "INVALID_ARGS" });
      expect(createFolder).not.toHaveBeenCalled();
    });

    it("creates when nothing there holds the name", async () => {
      const createFolder = vi.fn(async () => folder());
      await handleMkdir(against([{ id: "E1", name: "Old", parents: [ROOT_ID] }], { createFolder }));
      expect(createFolder).toHaveBeenCalledWith("New", undefined);
    });

    it.each(UNPATHABLE_NAMES)("refuses %j without asking Drive anything", async (name) => {
      const createFolder = vi.fn(async () => folder());
      const findSiblings = vi.fn(none);
      await expect(
        handleMkdir(against([], { createFolder, findSiblings, name })),
      ).rejects.toMatchObject({ code: "INVALID_ARGS" });
      expect(findSiblings).not.toHaveBeenCalled();
      expect(createFolder).not.toHaveBeenCalled();
    });
  });
});
