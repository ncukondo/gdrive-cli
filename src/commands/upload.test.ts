import { describe, expect, it, vi } from "vitest";
import { guessMimeType, handleUpload, resolveConvertMime, type LocalFile } from "./upload.ts";
import type { DriveFile } from "../types/index.ts";
import type { UploadInput } from "../lib/api.ts";
import { callArgs } from "../../tests/helpers/mock.ts";

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "U1",
    name: "notes.txt",
    mime_type: "text/plain",
    type: "file",
    size: 3,
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

const local = (overrides: Partial<LocalFile> = {}): LocalFile => ({
  body: "BODY",
  mimeType: "text/plain",
  name: "notes.txt",
  ...overrides,
});

describe("guessMimeType", () => {
  it("maps known extensions and defaults to octet-stream", () => {
    expect(guessMimeType("a.csv")).toBe("text/csv");
    expect(guessMimeType("a.PNG")).toBe("image/png");
    expect(guessMimeType("a.unknownext")).toBe("application/octet-stream");
    expect(guessMimeType("noext")).toBe("application/octet-stream");
  });
});

describe("resolveConvertMime", () => {
  it("resolves --as-doc / --as-sheet and rejects both", () => {
    expect(resolveConvertMime(true, false)).toBe("application/vnd.google-apps.document");
    expect(resolveConvertMime(false, true)).toBe("application/vnd.google-apps.spreadsheet");
    expect(resolveConvertMime(false, false)).toBeUndefined();
    expect(() => resolveConvertMime(true, true)).toThrow(/only one/);
  });
});

describe("handleUpload", () => {
  it("uploads with the local name and mime, no parent/convert by default", async () => {
    const uploadMedia = vi.fn(async (_i: UploadInput) => file());
    await handleUpload({
      resolvePath: vi.fn(),
      readLocalFile: () => local(),
      uploadMedia,
      local: "./notes.txt",
      format: "text",
      quiet: false,
      write: () => {},
    });
    const [input] = callArgs(uploadMedia);
    expect(input).toEqual({ name: "notes.txt", mimeType: "text/plain", body: "BODY" });
  });

  it("resolves --parent and applies --name and --as-sheet conversion", async () => {
    const resolvePath = vi.fn(async () => "PID");
    const uploadMedia = vi.fn(async (_i: UploadInput) => file());
    await handleUpload({
      resolvePath,
      readLocalFile: () => local({ name: "data.csv", mimeType: "text/csv" }),
      uploadMedia,
      local: "./data.csv",
      parent: "Reports",
      name: "Budget",
      asSheet: true,
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(resolvePath).toHaveBeenCalledWith("Reports");
    const [input] = callArgs(uploadMedia);
    expect(input).toEqual({
      name: "Budget",
      mimeType: "text/csv",
      body: "BODY",
      parentId: "PID",
      convertToMimeType: "application/vnd.google-apps.spreadsheet",
    });
  });

  it("renders text and quiet", async () => {
    const out = collect();
    await handleUpload({
      resolvePath: vi.fn(),
      readLocalFile: () => local(),
      uploadMedia: async () => file({ id: "U1", name: "notes.txt" }),
      local: "./notes.txt",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toBe("Uploaded notes.txt (U1)");

    // Drive accepts a newline in a name; the confirmation stays one line.
    const awkward = collect();
    await handleUpload({
      resolvePath: vi.fn(),
      readLocalFile: () => local(),
      uploadMedia: async () => file({ id: "U1", name: "Q1\nreport" }),
      local: "./notes.txt",
      format: "text",
      quiet: false,
      write: awkward.write,
    });
    expect(awkward.output).toBe("Uploaded Q1 report (U1)");

    const q = collect();
    await handleUpload({
      resolvePath: vi.fn(),
      readLocalFile: () => local(),
      uploadMedia: async () => file({ id: "U1" }),
      local: "./notes.txt",
      format: "text",
      quiet: true,
      write: q.write,
    });
    expect(q.output).toBe("U1");
  });

  it("propagates IO_ERROR from readLocalFile", async () => {
    await expect(
      handleUpload({
        resolvePath: vi.fn(),
        readLocalFile: () => {
          throw new (class extends Error {
            code = "IO_ERROR";
          })("nope");
        },
        uploadMedia: async () => file(),
        local: "./missing",
        format: "text",
        quiet: false,
        write: () => {},
      }),
    ).rejects.toMatchObject({ code: "IO_ERROR" });
  });
});
