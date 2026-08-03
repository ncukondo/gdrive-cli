import { describe, expect, it, vi } from "vitest";
import { createSearchCommand, handleSearch } from "./search.ts";
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

describe("handleSearch", () => {
  it("renders a table of matches and passes options", async () => {
    const out = collect();
    const searchFiles = vi.fn(async (_q: string, _o: ListOptions) => [
      file({ id: "x", name: "budget" }),
    ]);
    await handleSearch({
      searchFiles,
      query: "budget",
      format: "text",
      quiet: false,
      write: out.write,
      type: "sheet",
      limit: 3,
    });
    expect(out.output).toContain("budget");
    expect(searchFiles.mock.calls[0]?.[0]).toBe("budget");
    expect(callArgs(searchFiles)[1]).toEqual({ type: "sheet", limit: 3 });
  });

  it("shows a friendly message when there are no matches (text)", async () => {
    const out = collect();
    await handleSearch({
      searchFiles: async () => [],
      query: "zzz",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toBe('No files found matching "zzz".');
  });

  it("returns an empty files array in JSON when there are no matches", async () => {
    const out = collect();
    await handleSearch({
      searchFiles: async () => [],
      query: "zzz",
      format: "json",
      quiet: false,
      write: out.write,
    });
    expect(JSON.parse(out.output)).toEqual({ success: true, data: { files: [] } });
  });

  it("renders quiet ids", async () => {
    const out = collect();
    await handleSearch({
      searchFiles: async () => [file({ id: "a" }), file({ id: "b" })],
      query: "q",
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("a\nb");
  });

  it("passes a shared-drive scope into searchFiles (decision 0016)", async () => {
    const searchFiles = vi.fn(async (_q: string, _o: ListOptions) => []);
    await handleSearch({
      searchFiles,
      query: "q",
      format: "text",
      quiet: false,
      write: () => {},
      scope: { kind: "all" },
    });
    expect(callArgs(searchFiles)[1]).toEqual({ scope: { kind: "all" } });
  });
});

describe("createSearchCommand", () => {
  it("declares the shared-drive scope flags", () => {
    const flags = createSearchCommand().options.map((o) => o.long);
    expect(flags).toContain("--all-drives");
    expect(flags).toContain("--drive");
  });
});
