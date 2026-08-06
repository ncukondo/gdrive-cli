import { describe, expect, it, vi } from "vitest";
import { createLnCommand, handleLn } from "./ln.ts";
import { childrenNamed } from "../lib/resolve-path.ts";
import { AppError, type DriveFile } from "../types/index.ts";
import { createWritableTreeDrive, type DriveNode } from "../../tests/helpers/fake-drive.ts";
import { UNPATHABLE_NAMES } from "../../tests/helpers/names.ts";

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "T1",
    name: "2026 Budget",
    mime_type: "application/vnd.google-apps.spreadsheet",
    type: "sheet",
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

/** What `createShortcut` hands back: the new link, pointing at `T1`. */
function shortcut(overrides: Partial<DriveFile> = {}): DriveFile {
  return file({
    id: "L1",
    mime_type: "application/vnd.google-apps.shortcut",
    type: "shortcut",
    parents: ["DEST"],
    target_id: "T1",
    target_type: "sheet",
    ...overrides,
  });
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

interface Overrides {
  resolveTarget?: (arg: string) => Promise<{ id: string; file: DriveFile | null }>;
  resolveFolder?: (arg: string) => Promise<string>;
  getFile?: (id: string) => Promise<DriveFile>;
  createShortcut?: (targetId: string, parentId: string, name: string) => Promise<DriveFile>;
  findSiblings?: (parentId: string, name: string) => Promise<{ id: string; name: string }[]>;
  target?: string;
  dest?: string;
  name?: string;
  format?: "text" | "json";
  quiet?: boolean;
  write?: (msg: string) => void;
}

/** The default wiring: a path target that is a plain sheet, resolved by the walk. */
function deps(overrides: Overrides = {}) {
  return {
    resolveTarget: vi.fn(async (_arg: string) => ({ id: "T1", file: null })),
    resolveFolder: vi.fn(async (_arg: string) => "DEST"),
    getFile: vi.fn(async (_id: string) => file()),
    createShortcut: vi.fn(async (_t: string, _p: string, _n: string) => shortcut()),
    findSiblings: vi.fn(async (_p: string, _n: string) => []),
    target: "Reports/2026 Budget",
    dest: "Shared/Links",
    format: "text" as const,
    quiet: false,
    write: () => {},
    ...overrides,
  };
}

describe("handleLn", () => {
  it("names the shortcut after the target, fetching it once when the walk did not", async () => {
    const d = deps();
    await handleLn(d);
    expect(d.getFile).toHaveBeenCalledTimes(1);
    expect(d.getFile).toHaveBeenCalledWith("T1");
    expect(d.createShortcut).toHaveBeenCalledWith("T1", "DEST", "2026 Budget");
  });

  it("uses the metadata resolving already paid for, without a second lookup", async () => {
    // An id argument is fetched by `resolveTarget` itself (decisions 0025 §4,
    // 0026 §3), so naming the shortcut after it costs nothing more.
    const d = deps({
      resolveTarget: vi.fn(async (_arg: string) => ({ id: "T1", file: file({ name: "Notes" }) })),
      target: "1AbCdEfGhIjKlMnOpQrSt",
    });
    await handleLn(d);
    expect(d.getFile).not.toHaveBeenCalled();
    expect(d.createShortcut).toHaveBeenCalledWith("T1", "DEST", "Notes");
  });

  it("takes --name as given and never asks what the target is called", async () => {
    const d = deps({ name: "Budget link" });
    await handleLn(d);
    expect(d.getFile).not.toHaveBeenCalled();
    expect(d.createShortcut).toHaveBeenCalledWith("T1", "DEST", "Budget link");
  });

  it("links what a shortcut target points at, not the shortcut (decision 0026 §2)", async () => {
    // `resolveTarget` follows the one hop; what matters here is that the id it
    // returns is the one the new shortcut is created against.
    const d = deps({
      resolveTarget: vi.fn(async (_arg: string) => ({ id: "doc1", file: file({ id: "doc1" }) })),
      target: "Inbox/link-to-doc",
    });
    await handleLn(d);
    expect(d.resolveTarget).toHaveBeenCalledWith("Inbox/link-to-doc");
    expect(d.createShortcut).toHaveBeenCalledWith("doc1", "DEST", "2026 Budget");
  });

  it("resolves the two arguments through their own roles", async () => {
    const d = deps();
    await handleLn(d);
    expect(d.resolveTarget).toHaveBeenCalledWith("Reports/2026 Budget");
    expect(d.resolveTarget).not.toHaveBeenCalledWith("Shared/Links");
    expect(d.resolveFolder).toHaveBeenCalledWith("Shared/Links");
  });

  it("names both ends in text output", async () => {
    const out = collect();
    await handleLn(deps({ write: out.write }));
    expect(out.output).toBe("Created shortcut 2026 Budget (L1) -> 2026 Budget (T1)");
  });

  it("still names the target's id when --name kept its name unknown", async () => {
    const out = collect();
    await handleLn(
      deps({
        name: "Budget link",
        createShortcut: vi.fn(async () => shortcut({ name: "Budget link" })),
        write: out.write,
      }),
    );
    expect(out.output).toBe("Created shortcut Budget link (L1) -> T1");
  });

  it("carries the target through the JSON file object", async () => {
    const out = collect();
    await handleLn(deps({ format: "json", write: out.write }));
    const parsed: unknown = JSON.parse(out.output);
    expect(parsed).toMatchObject({
      success: true,
      data: { file: { id: "L1", type: "shortcut", target_id: "T1", target_type: "sheet" } },
    });
  });

  it("prints the new shortcut's id when quiet", async () => {
    const out = collect();
    await handleLn(deps({ quiet: true, write: out.write }));
    expect(out.output).toBe("L1");
  });

  it("lets Drive's own refusal reach the caller (decision 0026 §4)", async () => {
    const message = "A shortcut in this shared drive cannot point outside it.";
    const d = deps({
      createShortcut: vi.fn(async () => {
        throw new AppError("PERMISSION_DENIED", message);
      }),
    });
    await expect(handleLn(d)).rejects.toMatchObject({ code: "PERMISSION_DENIED", message });
  });

  /**
   * Decision 0055 §1. A shortcut is an entry in a folder like any other, and
   * `ln` names it after its target by default — so linking the same file into
   * one folder twice is the collision, without a flag being involved at all.
   */
  describe("a shortcut name the destination cannot address", () => {
    const against = (nodes: DriveNode[], overrides: Overrides = {}) => {
      const { client } = createWritableTreeDrive(nodes);
      return deps({
        findSiblings: (parentId, name) => childrenNamed(client, parentId, name),
        ...overrides,
      });
    };

    it("refuses the target's own name when the folder already holds it", async () => {
      const d = against([{ id: "L0", name: "2026 Budget", parents: ["DEST"], target: "T1" }]);
      await expect(handleLn(d)).rejects.toMatchObject({
        code: "INVALID_ARGS",
        message: expect.stringContaining("L0"),
      });
      expect(d.createShortcut).not.toHaveBeenCalled();
    });

    it("refuses --name for the same reason", async () => {
      const d = against([{ id: "E1", name: "Budget link", parents: ["DEST"] }], {
        name: "Budget link",
      });
      await expect(handleLn(d)).rejects.toMatchObject({
        code: "INVALID_ARGS",
        message: expect.stringContaining("--name"),
      });
      expect(d.createShortcut).not.toHaveBeenCalled();
    });

    it("links when the folder holds nothing by that name", async () => {
      const d = against([{ id: "E1", name: "Something else", parents: ["DEST"] }]);
      await handleLn(d);
      expect(d.createShortcut).toHaveBeenCalledWith("T1", "DEST", "2026 Budget");
    });

    it.each(UNPATHABLE_NAMES)("refuses --name %j without asking Drive anything", async (name) => {
      const d = deps({ name });
      await expect(handleLn(d)).rejects.toMatchObject({ code: "INVALID_ARGS" });
      expect(d.findSiblings).not.toHaveBeenCalled();
      expect(d.createShortcut).not.toHaveBeenCalled();
    });
  });
});

describe("createLnCommand", () => {
  it("offers --name", () => {
    expect(createLnCommand().options.map((o) => o.long)).toContain("--name");
  });
});
