import { describe, expect, it, vi } from "vitest";
import { handleDownload, parseExportAs } from "./download.ts";
import type { DriveFile } from "../types/index.ts";

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "id1",
    name: "photo.png",
    mime_type: "image/png",
    type: "file",
    size: 2048,
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

const doc = () =>
  file({
    id: "d1",
    name: "Doc",
    mime_type: "application/vnd.google-apps.document",
    type: "doc",
    size: null,
  });

interface Sink {
  written: { path: string; content: unknown }[];
  stdout: unknown[];
  messages: string[];
}

function makeBaseDeps(meta: DriveFile) {
  const sink: Sink = { written: [], stdout: [], messages: [] };
  const deps = {
    resolvePath: vi.fn(async (a: string) => a),
    getFile: vi.fn(async () => meta),
    downloadMedia: vi.fn(async () => "BINARY"),
    exportFile: vi.fn(async (_id: string, _mime: string) => "EXPORTED"),
    writeFile: (path: string, content: unknown) => sink.written.push({ path, content }),
    writeStdout: (content: unknown) => sink.stdout.push(content),
    write: (m: string) => sink.messages.push(m),
  };
  return { sink, deps };
}

describe("parseExportAs", () => {
  it("accepts known formats and rejects others", () => {
    expect(parseExportAs("pdf")).toBe("pdf");
    expect(parseExportAs(undefined)).toBeUndefined();
    expect(() => parseExportAs("rtf")).toThrow(/Invalid --export-as/);
  });
});

describe("handleDownload", () => {
  it("downloads binary content to a file and reports the path", async () => {
    const { sink, deps } = makeBaseDeps(file());
    await handleDownload({ ...deps, file: "id1", output: "out.png", format: "text", quiet: false });
    expect(deps.downloadMedia).toHaveBeenCalledWith("id1");
    expect(sink.written).toEqual([{ path: "out.png", content: "BINARY" }]);
    expect(sink.messages.join("\n")).toContain("Downloaded photo.png to out.png");
  });

  it("writes raw content to stdout when no -o (no envelope)", async () => {
    const { sink, deps } = makeBaseDeps(file());
    await handleDownload({ ...deps, file: "id1", format: "json", quiet: false });
    expect(sink.stdout).toEqual(["BINARY"]);
    expect(sink.written).toEqual([]);
    expect(sink.messages).toEqual([]);
  });

  it("exports a Google Doc with the requested format", async () => {
    const { deps } = makeBaseDeps(doc());
    await handleDownload({
      ...deps,
      file: "d1",
      output: "doc.pdf",
      exportAs: "pdf",
      format: "text",
      quiet: false,
    });
    expect(deps.exportFile).toHaveBeenCalledWith("d1", "application/pdf");
    expect(deps.downloadMedia).not.toHaveBeenCalled();
  });

  it("uses a default export format for a Google-native file (doc -> pdf)", async () => {
    const { deps } = makeBaseDeps(doc());
    await handleDownload({ ...deps, file: "d1", output: "doc.pdf", format: "text", quiet: false });
    expect(deps.exportFile).toHaveBeenCalledWith("d1", "application/pdf");
  });

  it("rejects --export-as on a binary file with INVALID_ARGS", async () => {
    const { deps } = makeBaseDeps(file());
    await expect(
      handleDownload({ ...deps, file: "id1", exportAs: "pdf", format: "text", quiet: false }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("reports name, path, and byte count in JSON when writing to a file", async () => {
    const { sink, deps } = makeBaseDeps(file());
    await handleDownload({ ...deps, file: "id1", output: "out.png", format: "json", quiet: false });
    const parsed = JSON.parse(sink.messages.join("\n"));
    expect(parsed.data).toMatchObject({ file: "photo.png", path: "out.png", bytes: 6 });
  });

  it("quiet prints the output path when writing to a file", async () => {
    const { sink, deps } = makeBaseDeps(file());
    await handleDownload({ ...deps, file: "id1", output: "out.png", format: "text", quiet: true });
    expect(sink.messages).toEqual(["out.png"]);
  });
});
