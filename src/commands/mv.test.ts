import { describe, expect, it, vi } from "vitest";
import { handleMv, type MvDeps } from "./mv.ts";
import { childrenNamed } from "../lib/resolve-path.ts";
import { refuseUnpathableName } from "../lib/names.ts";
import type { DriveFile } from "../types/index.ts";
import { createWritableTreeDrive, type DriveNode } from "../../tests/helpers/fake-drive.ts";

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

const none = async () => [];

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
      getFile: async () => file(),
      findSiblings: none,
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
      getFile: async () => file(),
      findSiblings: none,
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
      getFile: async () => file(),
      findSiblings: none,
      moveFile: async () => file({ id: "M1" }),
      file: "doc",
      dest: "Folder",
      format: "text",
      quiet: true,
      write: q.write,
    });
    expect(q.output).toBe("M1");
  });

  /**
   * Decision 0055 §1 reaches `mv` too. Task 0044 had excluded it on the grounds
   * that a move duplicates nothing — true of the file, and beside the point:
   * §1 is about two files with one name *in one folder*, and a move into a
   * folder that already holds that name produces exactly that pair. Drive
   * accepts it, and afterwards `resolve-path.ts` answers *Ambiguous path
   * segment* for both — including for the file that was already there and was
   * never touched.
   *
   * `mv` carries a name rather than giving one, so only half of §1 applies: a
   * file whose name a path could never hold is not made worse by being moved,
   * and refusing to move it would strand it where it is.
   */
  describe("a move into a folder that already holds the name", () => {
    const against = (nodes: DriveNode[], overrides: Partial<MvDeps> = {}): MvDeps => {
      const { client } = createWritableTreeDrive(nodes);
      return {
        resolvePath: async () => "M1",
        resolveFolder: async () => "DEST",
        moveFile: async () => file(),
        getFile: async () => file({ id: "M1", name: "doc", parents: ["HOME"] }),
        findSiblings: (parentId, name) => childrenNamed(client, parentId, name),
        file: "Home/doc",
        dest: "Folder",
        format: "text",
        quiet: false,
        write: () => {},
        ...overrides,
      };
    };

    it("is refused, and nothing is moved", async () => {
      const moveFile = vi.fn(async () => file());
      await expect(
        handleMv(against([{ id: "D1", name: "doc", parents: ["DEST"] }], { moveFile })),
      ).rejects.toMatchObject({ code: "INVALID_ARGS", message: expect.stringContaining("D1") });
      expect(moveFile).not.toHaveBeenCalled();
    });

    it("names a remedy a command with no name argument can follow", async () => {
      const error = await handleMv(against([{ id: "D1", name: "doc", parents: ["DEST"] }])).catch(
        (e: unknown) => e,
      );
      // "Pass --name" would be advice `mv` cannot take: it has no such flag.
      expect(String(error)).not.toContain("--name");
      expect(String(error)).toContain("rename");
    });

    /**
     * `mv` is the one caller that reaches the sibling check without the
     * unpathable one having run (decision 0056 §1), so the name it carries may
     * itself be one `rename` would refuse. The suggestion has to be a name the
     * `gdrive rename` it proposes would actually accept — `"a/b (2)"` is not.
     */
    it("suggests a name rename would accept, even for one a path cannot hold", async () => {
      const error = await handleMv(
        against([{ id: "D1", name: "a/b", parents: ["DEST"] }], {
          getFile: async () => file({ id: "M1", name: "a/b", parents: ["HOME"] }),
        }),
      ).catch((e: unknown) => e);

      const suggested = /gdrive rename "[^"]*" "([^"]*)"/.exec(String(error))?.[1] ?? "";
      expect(suggested).not.toBe("");
      // Run it through the check `rename` itself would apply, in the folder the
      // move was heading for.
      expect(() => refuseUnpathableName(suggested, "DEST")).not.toThrow();
    });

    it("asks about the file's own name in the destination folder", async () => {
      const findSiblings = vi.fn(async () => []);
      await handleMv(against([], { findSiblings }));
      expect(findSiblings).toHaveBeenCalledWith("DEST", "doc");
    });

    /** Moving a file into the folder it is already in is a no-op, not a clash. */
    it("does not see the file itself as the collision", async () => {
      const moveFile = vi.fn(async () => file());
      await handleMv(
        against([{ id: "M1", name: "doc", parents: ["DEST"] }], {
          moveFile,
          getFile: async () => file({ id: "M1", name: "doc", parents: ["DEST"] }),
        }),
      );
      expect(moveFile).toHaveBeenCalledWith("M1", "DEST");
    });

    it("moves when the destination holds nothing by that name", async () => {
      const moveFile = vi.fn(async () => file());
      await handleMv(against([{ id: "D1", name: "other", parents: ["DEST"] }], { moveFile }));
      expect(moveFile).toHaveBeenCalledWith("M1", "DEST");
    });

    /**
     * A name a path could never hold is the file's own problem, already made;
     * `mv` is not the command that made it and refusing here would leave the
     * file with no way out of the folder it is in.
     */
    it("still moves a file whose existing name a path cannot hold", async () => {
      const moveFile = vi.fn(async () => file());
      await handleMv(
        against([], {
          moveFile,
          getFile: async () => file({ id: "M1", name: "doc ", parents: [] }),
        }),
      );
      expect(moveFile).toHaveBeenCalledWith("M1", "DEST");
    });
  });
});
