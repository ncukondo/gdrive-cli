import { describe, expect, it, vi } from "vitest";
import { handleInfo } from "./info.ts";
import type { DriveFile } from "../types/index.ts";

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "id1",
    name: "Reports",
    mime_type: "application/vnd.google-apps.folder",
    type: "folder",
    size: null,
    parents: ["root"],
    trashed: false,
    web_view_link: "https://drive/x",
    created: "2026-07-20T14:03:00.000Z",
    modified: "2026-07-21T09:00:00.000Z",
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

describe("handleInfo", () => {
  it("resolves the argument then fetches metadata", async () => {
    const resolvePath = vi.fn(async () => "RID");
    const getFile = vi.fn(async () => file({ id: "RID" }));
    await handleInfo({
      resolvePath,
      getFile,
      file: "Reports",
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(resolvePath).toHaveBeenCalledWith("Reports");
    expect(getFile).toHaveBeenCalledWith("RID");
  });

  it("renders a text detail block", async () => {
    const out = collect();
    await handleInfo({
      resolvePath: async () => "id1",
      getFile: async () => file(),
      file: "id1",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toContain("Name:");
    expect(out.output).toContain("Reports");
    expect(out.output).toContain("Type:");
    expect(out.output).toContain("Link:");
  });

  it("renders JSON with a single file object", async () => {
    const out = collect();
    await handleInfo({
      resolvePath: async () => "id1",
      getFile: async () => file({ id: "id1" }),
      file: "id1",
      format: "json",
      quiet: false,
      write: out.write,
    });
    expect(JSON.parse(out.output).data.file.id).toBe("id1");
  });

  it("renders quiet as the id", async () => {
    const out = collect();
    await handleInfo({
      resolvePath: async () => "id1",
      getFile: async () => file({ id: "id1" }),
      file: "id1",
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("id1");
  });
});
