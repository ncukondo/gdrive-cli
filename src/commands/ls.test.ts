import { describe, expect, it, vi } from "vitest";
import { createLsCommand, handleLs, parseLimit, parseOrder, parseType } from "./ls.ts";
import { FILE_TYPES } from "../types/index.ts";
import type { DriveFile } from "../types/index.ts";
import type { ListOptions } from "../lib/api.ts";
import { callArgs } from "../../tests/helpers/mock.ts";

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "id1",
    name: "File",
    mime_type: "text/plain",
    type: "file",
    size: 10,
    parents: ["root"],
    trashed: false,
    web_view_link: null,
    created: "2026-07-20T14:03:00.000Z",
    modified: "2026-07-20T14:03:00.000Z",
    owners: ["me@x.com"],
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

const files = [
  file({
    id: "f1",
    name: "Reports",
    type: "folder",
    mime_type: "application/vnd.google-apps.folder",
  }),
  file({ id: "f2", name: "notes.txt" }),
];

describe("option parsers", () => {
  it("parseType accepts valid, rejects invalid", () => {
    expect(parseType("folder")).toBe("folder");
    expect(parseType(undefined)).toBeUndefined();
    expect(() => parseType("xml")).toThrow(/Invalid --type/);
  });
  it("parseType accepts shortcut, and offers it when the value is unknown", () => {
    expect(parseType("shortcut")).toBe("shortcut");
    expect(() => parseType("xml")).toThrow(/shortcut/);
  });
  it("parseType accepts form, and offers it when the value is unknown (decision 0034)", () => {
    expect(parseType("form")).toBe("form");
    expect(() => parseType("xml")).toThrow(/form/);
  });
  it.each([...FILE_TYPES])("parseType accepts every member of the vocabulary: %s", (type) => {
    expect(parseType(type)).toBe(type);
  });
  it("parseOrder validates", () => {
    expect(parseOrder("modified")).toBe("modified");
    expect(() => parseOrder("size")).toThrow(/Invalid --order/);
  });
  it("parseLimit requires a positive integer", () => {
    expect(parseLimit("5")).toBe(5);
    expect(() => parseLimit("0")).toThrow(/Invalid --limit/);
    expect(() => parseLimit("abc")).toThrow(/Invalid --limit/);
  });
});

/** A fake listing that ran to the end, which is what most of these are about. */
function whole(files: DriveFile[]) {
  return { files, complete: true };
}

describe("handleLs: a listing that stopped early (issue #32, decision 0060 §2)", () => {
  const cut = { files: [file({ id: "a", name: "a.txt" })], complete: false };

  it("says so in the envelope and still succeeds", async () => {
    const out = collect();
    const result = await handleLs({
      resolvePath: vi.fn(),
      listChildren: async () => cut,
      format: "json",
      quiet: false,
      write: out.write,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(out.output)).toMatchObject({
      success: true,
      data: { complete: false },
    });
  });

  it("prints the rows and a note under them in text mode", async () => {
    const out = collect();
    await handleLs({
      resolvePath: vi.fn(),
      listChildren: async () => cut,
      format: "text",
      quiet: false,
      write: out.write,
    });

    expect(out.output).toContain("a.txt");
    expect(out.output).toContain("more");
  });

  /** A note is not a value (decision 0038): `-q` is unchanged by it. */
  it("adds nothing to -q", async () => {
    const out = collect();
    await handleLs({
      resolvePath: vi.fn(),
      listChildren: async () => cut,
      format: "text",
      quiet: true,
      write: out.write,
    });

    expect(out.output).toBe("a");
  });

  it("prints no note when the listing ran to the end", async () => {
    const out = collect();
    await handleLs({
      resolvePath: vi.fn(),
      listChildren: async () => whole([file({ id: "a", name: "a.txt" })]),
      format: "text",
      quiet: false,
      write: out.write,
    });

    expect(out.output).not.toContain("more");
  });
});

describe("handleLs", () => {
  it("defaults to root when no folder is given (no path resolution)", async () => {
    const resolvePath = vi.fn();
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => whole(files));
    await handleLs({
      resolvePath,
      listChildren,
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(resolvePath).not.toHaveBeenCalled();
    expect(listChildren.mock.calls[0]?.[0]).toBe("root");
  });

  it("resolves a folder argument to an id", async () => {
    const resolvePath = vi.fn(async () => "FID");
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => whole(files));
    await handleLs({
      resolvePath,
      listChildren,
      format: "text",
      quiet: false,
      write: () => {},
      folder: "Reports",
    });
    expect(resolvePath).toHaveBeenCalledWith("Reports");
    expect(listChildren.mock.calls[0]?.[0]).toBe("FID");
  });

  it("renders a text table with a header and rows", async () => {
    const out = collect();
    await handleLs({
      resolvePath: vi.fn(),
      listChildren: async () => whole(files),
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toContain("Type");
    expect(out.output).toContain("Name");
    expect(out.output).toContain("Reports");
    expect(out.output).toContain("2026-07-20 14:03");
  });

  it("renders JSON with a files array", async () => {
    const out = collect();
    await handleLs({
      resolvePath: vi.fn(),
      listChildren: async () => whole(files),
      format: "json",
      quiet: false,
      write: out.write,
    });
    const parsed = JSON.parse(out.output);
    expect(parsed.data.files.map((f: DriveFile) => f.id)).toEqual(["f1", "f2"]);
  });

  /**
   * The two modes are allowed to disagree, and this is where they do. Drive
   * accepts a newline in a name; a line-oriented format cannot carry one, so
   * text mode mangles it and `-f json` is the exact channel (decision 0036 §2).
   */
  it("mangles a newline in a name in text and carries it verbatim in JSON", async () => {
    const awkward = [file({ id: "f3", name: "Q1\nreport" })];
    const text = collect();
    const json = collect();
    await handleLs({
      resolvePath: vi.fn(),
      listChildren: async () => whole(awkward),
      format: "text",
      quiet: false,
      write: text.write,
    });
    await handleLs({
      resolvePath: vi.fn(),
      listChildren: async () => whole(awkward),
      format: "json",
      quiet: false,
      write: json.write,
    });
    expect(text.output.split("\n")).toHaveLength(2);
    expect(text.output).toContain("Q1 report");
    expect(text.output).not.toContain("Q1\nreport");
    expect(JSON.parse(json.output).data.files[0].name).toBe("Q1\nreport");
  });

  it("renders quiet as one id per line", async () => {
    const out = collect();
    await handleLs({
      resolvePath: vi.fn(),
      listChildren: async () => whole(files),
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("f1\nf2");
  });

  it("passes type/limit/order into listChildren", async () => {
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => whole(files));
    await handleLs({
      resolvePath: vi.fn(),
      listChildren,
      format: "text",
      quiet: false,
      write: () => {},
      type: "folder",
      limit: 5,
      order: "modified",
      trashed: true,
    });
    expect(callArgs(listChildren)[1]).toEqual({
      type: "folder",
      limit: 5,
      order: "modified",
      trashed: true,
    });
  });

  it("passes a shared-drive scope into listChildren (decision 0016)", async () => {
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => whole(files));
    await handleLs({
      resolvePath: vi.fn(),
      listChildren,
      format: "text",
      quiet: false,
      write: () => {},
      scope: { kind: "drive", driveId: "D1" },
    });
    expect(callArgs(listChildren)[1]).toEqual({ scope: { kind: "drive", driveId: "D1" } });
  });

  it("defaults to the shared drive's root when --drive is given without a folder", async () => {
    const resolvePath = vi.fn();
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => whole(files));
    await handleLs({
      resolvePath,
      listChildren,
      format: "text",
      quiet: false,
      write: () => {},
      scope: { kind: "drive", driveId: "D1" },
    });
    expect(resolvePath).not.toHaveBeenCalled();
    expect(callArgs(listChildren)[0]).toBe("D1");
  });

  it("rejects a folder argument together with a scope flag", async () => {
    // Previously the folder resolved against My Drive and the driveId was
    // ignored, so `ls --drive X <folder>` returned some other drive's contents.
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => whole(files));
    await expect(
      handleLs({
        resolvePath: vi.fn(async () => "FID"),
        listChildren,
        format: "text",
        quiet: false,
        write: () => {},
        folder: "Reports",
        scope: { kind: "drive", driveId: "D1" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(listChildren).not.toHaveBeenCalled();
  });

  it("points at the ID-only route when it rejects that combination", async () => {
    await expect(
      handleLs({
        resolvePath: vi.fn(async () => "FID"),
        listChildren: vi.fn(async () => whole(files)),
        format: "text",
        quiet: false,
        write: () => {},
        folder: "Reports",
        scope: { kind: "drive", driveId: "D1" },
      }),
    ).rejects.toThrow(/ID/);
  });

  it("sends no scope when neither flag is given", async () => {
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => whole(files));
    await handleLs({
      resolvePath: vi.fn(),
      listChildren,
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(callArgs(listChildren)[1]).toEqual({});
  });
});

describe("createLsCommand", () => {
  it("offers every type in --help, so the help text cannot drift from the vocabulary", () => {
    const description =
      createLsCommand().options.find((o) => o.long === "--type")?.description ?? "";
    for (const type of FILE_TYPES) expect(description).toContain(type);
  });

  it("offers --drive but not --all-drives", () => {
    // `ls` always filters by a single parent, so there is no corpus for
    // --all-drives to widen — it was a documented no-op (decision 0016 §2).
    const flags = createLsCommand().options.map((o) => o.long);
    expect(flags).toContain("--drive");
    expect(flags).not.toContain("--all-drives");
  });
});
