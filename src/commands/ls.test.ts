import { describe, expect, it, vi } from "vitest";
import { createLsCommand, handleLs, parseLimit, parseOrder, parseType } from "./ls.ts";
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

describe("handleLs", () => {
  it("defaults to root when no folder is given (no path resolution)", async () => {
    const resolvePath = vi.fn();
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => files);
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
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => files);
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
      listChildren: async () => files,
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
      listChildren: async () => files,
      format: "json",
      quiet: false,
      write: out.write,
    });
    const parsed = JSON.parse(out.output);
    expect(parsed.data.files.map((f: DriveFile) => f.id)).toEqual(["f1", "f2"]);
  });

  it("renders quiet as one id per line", async () => {
    const out = collect();
    await handleLs({
      resolvePath: vi.fn(),
      listChildren: async () => files,
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("f1\nf2");
  });

  it("passes type/limit/order into listChildren", async () => {
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => files);
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
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => files);
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
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => files);
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

  it("still resolves an explicit folder under --drive", async () => {
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => files);
    await handleLs({
      resolvePath: vi.fn(async () => "FID"),
      listChildren,
      format: "text",
      quiet: false,
      write: () => {},
      folder: "Reports",
      scope: { kind: "drive", driveId: "D1" },
    });
    expect(callArgs(listChildren)[0]).toBe("FID");
  });

  it("keeps My Drive root as the default under --all-drives", async () => {
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => files);
    await handleLs({
      resolvePath: vi.fn(),
      listChildren,
      format: "text",
      quiet: false,
      write: () => {},
      scope: { kind: "all" },
    });
    expect(callArgs(listChildren)[0]).toBe("root");
  });

  it("sends no scope when neither flag is given", async () => {
    const listChildren = vi.fn(async (_id: string, _o: ListOptions) => files);
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
  it("declares the shared-drive scope flags", () => {
    const flags = createLsCommand().options.map((o) => o.long);
    expect(flags).toContain("--all-drives");
    expect(flags).toContain("--drive");
  });
});
