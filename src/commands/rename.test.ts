import { describe, expect, it, vi } from "vitest";
import { handleRename, type RenameDeps } from "./rename.ts";
import { childrenNamed } from "../lib/resolve-path.ts";
import { FILE_TYPES, type DriveFile, type FileType } from "../types/index.ts";
import { createWritableTreeDrive, type DriveNode } from "../../tests/helpers/fake-drive.ts";
import { UNPATHABLE_NAMES } from "../../tests/helpers/names.ts";

const MIME_BY_TYPE: Record<FileType, string> = {
  folder: "application/vnd.google-apps.folder",
  doc: "application/vnd.google-apps.document",
  sheet: "application/vnd.google-apps.spreadsheet",
  slides: "application/vnd.google-apps.presentation",
  form: "application/vnd.google-apps.form",
  shortcut: "application/vnd.google-apps.shortcut",
  file: "text/plain",
};

/**
 * A file whose `type` and `mime_type` agree, because Drive never sends a pair
 * that does not. Varying the label alone would leave a branch keyed on the MIME
 * type — the other half of the same fact — passing a test that never presented
 * it with a form.
 */
function file(overrides: Partial<DriveFile> = {}): DriveFile {
  const type = overrides.type ?? "doc";
  return {
    id: "R1",
    name: "Notes 2026",
    mime_type: MIME_BY_TYPE[type],
    type,
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

const none = async () => [];

describe("handleRename", () => {
  it("renames the file the argument resolves to, by id or by path", async () => {
    for (const arg of ["R1", "Reports/Notes"]) {
      const resolvePath = vi.fn(async () => "R1");
      const renameFile = vi.fn(async (_id: string, _name: string) => file());
      await handleRename({
        resolvePath,
        renameFile,
        getFile: async () => file(),
        findSiblings: none,
        file: arg,
        name: "Notes 2026",
        format: "text",
        quiet: false,
        write: () => {},
      });
      expect(resolvePath).toHaveBeenCalledWith(arg);
      expect(renameFile).toHaveBeenCalledWith("R1", "Notes 2026");
    }
  });

  it("renders text, quiet and JSON", async () => {
    const deps = {
      resolvePath: async () => "R1",
      renameFile: async () => file(),
      getFile: async () => file(),
      findSiblings: none,
      file: "Reports/Notes",
      name: "Notes 2026",
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
          getFile: async () => file(),
          findSiblings: none,
          file: "Reports/Notes",
          name,
          format: "text",
          quiet: false,
          write: () => {},
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGS" });
      // Resolving a path is itself a Drive call, so nothing may run first.
      expect(resolvePath).not.toHaveBeenCalled();
      expect(renameFile).not.toHaveBeenCalled();
    }
  });

  it("does the same thing to every type of file, at the same cost", async () => {
    // Drive carries the new name into the in-document title of a Doc, a Sheet,
    // a deck and a form alike (decision 0053), so there is nothing for a type to
    // change: not the calls made, not the output, not a note beside it. An
    // earlier version asked what type it had renamed and said something extra
    // for one of them; a per-type branch coming back fails here.
    for (const type of FILE_TYPES) {
      const calls: string[] = [];
      const deps = {
        resolvePath: async () => {
          calls.push("resolvePath");
          return "R1";
        },
        renameFile: async () => {
          calls.push("renameFile");
          return file({ type });
        },
        getFile: async () => {
          calls.push("getFile");
          return file({ type });
        },
        findSiblings: async () => {
          calls.push("findSiblings");
          return [];
        },
        file: "Reports/Notes",
        name: "Notes 2026",
        quiet: false,
      };

      const text = collect();
      const result = await handleRename({ ...deps, format: "text", write: text.write });
      expect(result.exitCode).toBe(0);
      expect(text.output).toBe("Renamed to Notes 2026 (R1)");
      // The same four calls whatever the type: the walk, the file's own parent,
      // the check against that folder (decision 0055 §2, which says `rename`
      // pays two round trips for it), then the rename. A type that needed asking
      // about would show up here as a fifth.
      expect(calls).toEqual(["resolvePath", "getFile", "findSiblings", "renameFile"]);

      const json = collect();
      await handleRename({ ...deps, format: "json", write: json.write });
      // `toEqual` rather than `toMatchObject`: the envelope carries the renamed
      // file and nothing beside it, which is the half a matcher would miss.
      expect(JSON.parse(json.output)).toEqual({
        success: true,
        data: { file: file({ type }) },
      });
    }
  });

  /**
   * Decision 0055 §1, and the case that produced it: `rename` reaching a name a
   * sibling already holds leaves **neither** file reachable by path, because
   * `resolve-path.ts` answers *Ambiguous path segment* for both. Drive accepts
   * it without a word.
   *
   * `rename` is the one command whose destination folder it does not already
   * know, so §2 has it pay a second round trip to learn it.
   */
  describe("a new name that would not address the file", () => {
    const against = (nodes: DriveNode[], overrides: Partial<RenameDeps> = {}): RenameDeps => {
      const { client } = createWritableTreeDrive(nodes);
      return {
        resolvePath: async () => "R1",
        renameFile: async () => file(),
        getFile: async () => file({ id: "R1", parents: ["rep1"] }),
        findSiblings: (parentId, name) => childrenNamed(client, parentId, name),
        file: "Reports/Notes",
        name: "Budget",
        format: "text",
        quiet: false,
        write: () => {},
        ...overrides,
      };
    };

    it("refuses a name a sibling holds, and renames nothing", async () => {
      const renameFile = vi.fn(async () => file());
      await expect(
        handleRename(against([{ id: "B1", name: "Budget", parents: ["rep1"] }], { renameFile })),
      ).rejects.toMatchObject({ code: "INVALID_ARGS", message: expect.stringContaining("B1") });
      expect(renameFile).not.toHaveBeenCalled();
    });

    it("looks in the file's own folder, which it had to ask Drive for", async () => {
      const findSiblings = vi.fn(async () => []);
      await handleRename(against([], { findSiblings }));
      expect(findSiblings).toHaveBeenCalledWith("rep1", "Budget");
    });

    /** Renaming a file to the name it already has is a no-op, not a collision. */
    it("does not see the file itself as the collision", async () => {
      const renameFile = vi.fn(async () => file());
      await handleRename(
        against([{ id: "R1", name: "Budget", parents: ["rep1"] }], { renameFile }),
      );
      expect(renameFile).toHaveBeenCalledWith("R1", "Budget");
    });

    it("renames when nothing in the folder holds the name", async () => {
      const renameFile = vi.fn(async () => file());
      await handleRename(against([{ id: "N1", name: "Notes", parents: ["rep1"] }], { renameFile }));
      expect(renameFile).toHaveBeenCalledWith("R1", "Budget");
    });

    /**
     * The walk is itself a Drive call, so a name that cannot survive a path is
     * decided before it: nothing about the file changes the answer.
     */
    it.each(UNPATHABLE_NAMES)("refuses %j before resolving anything", async (name) => {
      const resolvePath = vi.fn(async () => "R1");
      const renameFile = vi.fn(async () => file());
      await expect(
        handleRename(against([], { name, resolvePath, renameFile })),
      ).rejects.toMatchObject({ code: "INVALID_ARGS" });
      expect(resolvePath).not.toHaveBeenCalled();
      expect(renameFile).not.toHaveBeenCalled();
    });
  });
});
