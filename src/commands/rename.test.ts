import { describe, expect, it, vi } from "vitest";
import { handleRename } from "./rename.ts";
import { FILE_TYPES, type DriveFile, type FileType } from "../types/index.ts";

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
        file: "Reports/Notes",
        name: "Notes 2026",
        quiet: false,
      };

      const text = collect();
      const result = await handleRename({ ...deps, format: "text", write: text.write });
      expect(result.exitCode).toBe(0);
      expect(text.output).toBe("Renamed to Notes 2026 (R1)");
      // Two calls whatever the type: the walk, then the rename. A type that
      // needed asking about would show up here as a third.
      expect(calls).toEqual(["resolvePath", "renameFile"]);

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
});
