import { describe, expect, it, vi } from "vitest";
import { handleLs, parseLimit, parseOrder, parseType } from "./ls.ts";
import type { DriveFile } from "../types/index.ts";
import type { ListOptions } from "../lib/api.ts";

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
    expect(listChildren.mock.calls[0]?.[1] as ListOptions).toEqual({
      type: "folder",
      limit: 5,
      order: "modified",
      trashed: true,
    });
  });
});
