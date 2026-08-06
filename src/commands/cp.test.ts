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
   * Decision 0031 §1. Drive's own refusal mentions neither folders nor `-r`, so
   * `cp` replaces it — but only after the copy has already failed. A pre-flight
   * `files.get` would cost every ordinary copy a round trip to guard against a
   * case that ends in an error anyway.
   */
  describe("a folder without -r", () => {
    const refuses = async () => {
      throw new AppError("API_ERROR", "Copying a folder is not supported.");
    };

    it("names the folder and -r", async () => {
      const getFile = vi.fn(async () => folder({ id: "S1", name: "2026" }));
      await expect(
        handleCp(deps({ copyFile: refuses, getFile, file: "Reports/2026" })),
      ).rejects.toMatchObject({
        code: "INVALID_ARGS",
        message: expect.stringMatching(/Reports\/2026.*-r/s),
      });
    });

    it("costs an ordinary copy nothing", async () => {
      const getFile = vi.fn(async () => file());
      await handleCp(deps({ getFile }));
      expect(getFile).not.toHaveBeenCalled();
    });

    it("keeps Drive's own error when the source is not a folder after all", async () => {
      const getFile = vi.fn(async () => file({ type: "file" }));
      await expect(handleCp(deps({ copyFile: refuses, getFile }))).rejects.toMatchObject({
        code: "API_ERROR",
        message: "Copying a folder is not supported.",
      });
    });

    it("keeps Drive's own error when the hint's own lookup fails", async () => {
      // The hint is a nicety; losing the caller's real error to it would not be.
      const getFile = vi.fn(async () => {
        throw new AppError("AUTH_EXPIRED", "token expired");
      });
      await expect(handleCp(deps({ copyFile: refuses, getFile }))).rejects.toMatchObject({
        code: "API_ERROR",
        message: "Copying a folder is not supported.",
      });
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
        deps({ recursive: true, getFile: async () => folder(), quiet: true, write: q.write }),
      );
      expect(q.output).toBe("T1");

      const j = collect();
      await handleCp(
        deps({ recursive: true, getFile: async () => folder(), format: "json", write: j.write }),
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
          getFile: async () => file(),
          copyTree,
          copyFile,
          write: out.write,
        }),
      );
      expect(copyTree).not.toHaveBeenCalled();
      expect(copyFile).toHaveBeenCalledWith("S1", "DEST", undefined);
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
