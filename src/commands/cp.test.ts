import { describe, expect, it, vi } from "vitest";
import { handleCp, type CpDeps } from "./cp.ts";
import type { CopyTreeReport } from "../lib/copy-tree.ts";
import { AppError, type DriveFile } from "../types/index.ts";

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

const FOLDER_MIME = "application/vnd.google-apps.folder";
const folder = (overrides: Partial<DriveFile> = {}) =>
  file({ type: "folder", mime_type: FOLDER_MIME, ...overrides });

/** Deps every test overrides a corner of; the defaults never fail. */
function deps(overrides: Partial<CpDeps> = {}): CpDeps {
  return {
    resolvePath: async () => "S1",
    resolveFolder: async () => "DEST",
    copyFile: async () => file(),
    getFile: async (id: string) => file({ id, parents: [] }),
    copyTree: async () => report(),
    file: "src",
    dest: "Folder",
    format: "text",
    quiet: false,
    write: () => {},
    ...overrides,
  };
}

function report(overrides: Partial<CopyTreeReport> = {}): CopyTreeReport {
  return {
    root: file({ id: "T1", name: "2026", type: "folder", mime_type: FOLDER_MIME }),
    folders: [{ src: "S1", dst: "T1", name: "2026" }],
    copied: [{ src: "1A", dst: "1X", name: "a.pdf" }],
    ...overrides,
  };
}

describe("handleCp", () => {
  it("resolves source and destination separately and passes the optional name", async () => {
    // The source is an entry, the destination a container (decision 0025 §1).
    const resolvePath = vi.fn(async () => "S1");
    const resolveFolder = vi.fn(async () => "DEST");
    const copyFile = vi.fn(async (_id: string, _p: string, _n?: string) => file());
    await handleCp(deps({ resolvePath, resolveFolder, copyFile, name: "renamed" }));
    expect(resolvePath).toHaveBeenCalledWith("src");
    expect(resolvePath).not.toHaveBeenCalledWith("Folder");
    expect(resolveFolder).toHaveBeenCalledWith("Folder");
    expect(copyFile).toHaveBeenCalledWith("S1", "DEST", "renamed");
  });

  it("renders text and quiet", async () => {
    const out = collect();
    await handleCp(
      deps({ copyFile: async () => file({ id: "C1", name: "copy" }), write: out.write }),
    );
    expect(out.output).toBe("Copied to copy (C1)");

    const q = collect();
    await handleCp(deps({ copyFile: async () => file({ id: "C1" }), quiet: true, write: q.write }));
    expect(q.output).toBe("C1");
  });

  /**
   * Decision 0054 §1: one rule, no branch on file type and none on how the file
   * was reached. What is asserted is the name `cp` *sends*, because the name
   * that comes back is whatever the fake decided to return — and a copy named by
   * Drive rather than by the request is exactly the defect this rule exists for.
   */
  describe("the name a copy is given", () => {
    it("is the source's, when the caller named none", async () => {
      const copyFile = vi.fn(async (_id: string, _p: string, _n?: string) => file());
      await handleCp(
        deps({ copyFile, getFile: async (id) => file({ id, name: "Budget", parents: [] }) }),
      );
      expect(copyFile).toHaveBeenCalledWith("S1", "DEST", "Budget");
    });

    it("is the source's for -r on an ordinary file too", async () => {
      const copyFile = vi.fn(async (_id: string, _p: string, _n?: string) => file());
      await handleCp(
        deps({
          recursive: true,
          copyFile,
          getFile: async (id) => file({ id, name: "Budget", parents: [] }),
        }),
      );
      expect(copyFile).toHaveBeenCalledWith("S1", "DEST", "Budget");
    });

    it("is --name when it was given, at the top level of a tree as well", async () => {
      const copyTree = vi.fn(async () => report());
      await handleCp(
        deps({
          recursive: true,
          name: "Budget (2026)",
          copyTree,
          getFile: async (id) => folder({ id, name: "Budget", parents: [] }),
        }),
      );
      expect(copyTree).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Budget" }),
        "DEST",
        "Budget (2026)",
      );
    });
  });

  /**
   * Decision 0031 §1's message, now decided before anything is attempted:
   * decision 0054 spends a `files.get` on every copy anyway, so there is nothing
   * left to save by finding out on the failure path.
   */
  describe("a folder without -r", () => {
    it("names the folder and -r, and copies nothing", async () => {
      const copyFile = vi.fn(async () => file());
      const getFile = vi.fn(async () => folder({ id: "S1", name: "2026" }));
      await expect(
        handleCp(deps({ copyFile, getFile, file: "Reports/2026" })),
      ).rejects.toMatchObject({
        code: "INVALID_ARGS",
        message: expect.stringMatching(/Reports\/2026.*-r/s),
      });
      expect(copyFile).not.toHaveBeenCalled();
    });
  });

  /**
   * Decision 0054 §3. Drive would not refuse this — it would produce two files
   * with one name that no listing tells apart and no path can address. The
   * remedy is a name, so the message names the flag that gives one.
   */
  describe("a copy that would sit beside its own source", () => {
    const inPlace = (overrides: Partial<CpDeps> = {}) =>
      deps({
        resolveFolder: async () => "HOME",
        getFile: async (id) => file({ id, name: "Budget", parents: ["HOME"] }),
        ...overrides,
      });

    it("is refused, naming --name, before anything is copied", async () => {
      const copyFile = vi.fn(async () => file());
      await expect(handleCp(inPlace({ copyFile }))).rejects.toMatchObject({
        code: "INVALID_ARGS",
        message: expect.stringContaining("--name"),
      });
      expect(copyFile).not.toHaveBeenCalled();
    });

    it("succeeds once the copy is named", async () => {
      const copyFile = vi.fn(async () => file({ id: "C1", name: "Budget (backup)" }));
      await handleCp(inPlace({ copyFile, name: "Budget (backup)" }));
      expect(copyFile).toHaveBeenCalledWith("S1", "HOME", "Budget (backup)");
    });

    it("is refused for a folder with -r as well", async () => {
      const copyTree = vi.fn(async () => report());
      await expect(
        handleCp(
          inPlace({
            recursive: true,
            copyTree,
            getFile: async (id) => folder({ id, name: "2026", parents: ["HOME"] }),
          }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_ARGS", message: expect.stringContaining("--name") });
      expect(copyTree).not.toHaveBeenCalled();
    });

    /**
     * `root` is an alias Drive accepts, not an id: a file in My Drive's root
     * lists the root's *real* id in `parents`, so comparing the two as strings
     * would let the one case §3 exists for — a snapshot taken in place — through.
     */
    it("is refused when the destination was spelled as the My Drive root", async () => {
      const copyFile = vi.fn(async () => file());
      await expect(
        handleCp(
          deps({
            dest: "/",
            resolveFolder: async () => "root",
            copyFile,
            getFile: async (id) =>
              id === "root"
                ? folder({ id: "0AReAlRoOt", name: "My Drive", parents: [] })
                : file({ id, name: "Budget", parents: ["0AReAlRoOt"] }),
          }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_ARGS", message: expect.stringContaining("--name") });
      expect(copyFile).not.toHaveBeenCalled();
    });

    it("says something different from the folder-into-itself refusal", async () => {
      // Different inputs, different reasons: one is a name collision, the other
      // a copy that would recurse forever (decision 0054 §3 vs 0031 §6).
      const sibling = await handleCp(inPlace()).catch((e: unknown) => e);
      const cycle = await handleCp(
        deps({
          recursive: true,
          getFile: async (id) =>
            folder({ id, name: id, parents: { DEST: ["S1"], S1: [] }[id] ?? [] }),
        }),
      ).catch((e: unknown) => e);

      expect(sibling).toBeInstanceOf(AppError);
      expect(cycle).toBeInstanceOf(AppError);
      expect(String(sibling)).not.toBe(String(cycle));
      expect(String(cycle)).not.toContain("--name");
    });
  });

  describe("-r", () => {
    it("copies the tree and reports what it created", async () => {
      const copyTree = vi.fn(async () => report());
      const copyFile = vi.fn(async () => file());
      const out = collect();
      await handleCp(
        deps({
          recursive: true,
          getFile: async () => folder({ id: "S1", name: "2026" }),
          copyTree,
          copyFile,
          name: "2026 (archived)",
          write: out.write,
        }),
      );

      expect(copyFile).not.toHaveBeenCalled();
      expect(copyTree).toHaveBeenCalledWith(
        expect.objectContaining({ id: "S1", name: "2026" }),
        "DEST",
        "2026 (archived)",
      );
      expect(out.output).toBe("Copied to 2026 (T1): 1 folder, 1 file");
    });

    it("prints the new top folder id when quiet, and the whole report in JSON", async () => {
      const q = collect();
      await handleCp(
        deps({
          recursive: true,
          getFile: async () => folder({ parents: [] }),
          quiet: true,
          write: q.write,
        }),
      );
      expect(q.output).toBe("T1");

      const j = collect();
      await handleCp(
        deps({
          recursive: true,
          getFile: async () => folder({ parents: [] }),
          format: "json",
          write: j.write,
        }),
      );
      const parsed = JSON.parse(j.output);
      expect(parsed.data.file.id).toBe("T1");
      expect(parsed.data.folders).toEqual([{ src: "S1", dst: "T1", name: "2026" }]);
      expect(parsed.data.copied).toEqual([{ src: "1A", dst: "1X", name: "a.pdf" }]);
    });

    it("copies an ordinary file the ordinary way, as POSIX cp -r does", async () => {
      const copyTree = vi.fn(async () => report());
      const copyFile = vi.fn(async () => file({ id: "C1", name: "copy" }));
      const out = collect();
      await handleCp(
        deps({
          recursive: true,
          getFile: async () => file({ name: "notes.txt", parents: [] }),
          copyTree,
          copyFile,
          write: out.write,
        }),
      );
      expect(copyTree).not.toHaveBeenCalled();
      expect(copyFile).toHaveBeenCalledWith("S1", "DEST", "notes.txt");
      expect(out.output).toBe("Copied to copy (C1)");
    });
  });

  /**
   * Decision 0031 §6. `cp -r A A/B` would recurse forever, and noticing during
   * the walk would mean noticing after part of a tree was copied into itself.
   */
  describe("copying a folder into its own subtree", () => {
    const tree: Record<string, string[]> = { DEST: ["MID"], MID: ["S1"], S1: ["root"] };

    const nested = (overrides: Partial<CpDeps> = {}) =>
      deps({
        recursive: true,
        getFile: async (id: string) => folder({ id, name: id, parents: tree[id] ?? [] }),
        ...overrides,
      });

    it("is refused before anything is copied", async () => {
      const copyTree = vi.fn(async () => report());
      const copyFile = vi.fn(async () => file());
      await expect(handleCp(nested({ copyTree, copyFile }))).rejects.toMatchObject({
        code: "INVALID_ARGS",
      });
      expect(copyTree).not.toHaveBeenCalled();
      expect(copyFile).not.toHaveBeenCalled();
    });

    it("is refused when the destination is the source itself", async () => {
      const copyTree = vi.fn(async () => report());
      await expect(
        handleCp(nested({ resolveFolder: async () => "S1", copyTree })),
      ).rejects.toMatchObject({ code: "INVALID_ARGS" });
      expect(copyTree).not.toHaveBeenCalled();
    });

    it("does not trip on a destination that merely shares a name with the source", async () => {
      const copyTree = vi.fn(async () => report());
      await handleCp(
        deps({
          recursive: true,
          // Same name, different file: the guard compares ids, as it must.
          getFile: async (id: string) =>
            folder({ id, name: "2026", parents: id === "DEST" ? ["OTHER"] : [] }),
          copyTree,
        }),
      );
      expect(copyTree).toHaveBeenCalled();
    });
  });
});
