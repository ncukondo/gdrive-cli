import { describe, expect, it, vi } from "vitest";
import { handleShareLink } from "./link.ts";
import type { DriveFile, DrivePermission } from "../../types/index.ts";

function perm(overrides: Partial<DrivePermission> = {}): DrivePermission {
  return {
    id: "perm-anyone",
    type: "anyone",
    role: "reader",
    email: null,
    display_name: null,
    domain: null,
    allow_file_discovery: false,
    deleted: false,
    ...overrides,
  };
}

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "FID",
    name: "Plan",
    mime_type: "application/vnd.google-apps.document",
    type: "doc",
    size: null,
    parents: [],
    trashed: false,
    web_view_link: "https://docs.google.com/document/d/FID/edit",
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

const deps = () => ({
  resolvePath: async () => "FID",
  getFile: async () => file(),
  listPermissions: async (): Promise<DrivePermission[]> => [],
  createPermission: vi.fn(async () => perm()),
  updatePermissionRole: vi.fn(async () => perm({ role: "writer" })),
  file: "F",
  format: "text" as const,
  quiet: false,
  write: () => {},
});

describe("handleShareLink", () => {
  it("creates an anyone-with-link reader permission when none exists", async () => {
    const d = deps();
    const out = collect();
    await handleShareLink({ ...d, write: out.write });
    expect(d.createPermission).toHaveBeenCalledWith("FID", { type: "anyone", role: "reader" });
    expect(d.updatePermissionRole).not.toHaveBeenCalled();
    expect(out.output).toBe(
      "Anyone with the link (reader)\nhttps://docs.google.com/document/d/FID/edit",
    );
  });

  it("reuses an existing anyone permission with the same role", async () => {
    const d = deps();
    await handleShareLink({ ...d, listPermissions: async () => [perm()] });
    expect(d.createPermission).not.toHaveBeenCalled();
    expect(d.updatePermissionRole).not.toHaveBeenCalled();
  });

  it("upgrades an existing anyone permission when the role differs", async () => {
    const d = deps();
    await handleShareLink({ ...d, listPermissions: async () => [perm()], role: "writer" });
    expect(d.createPermission).not.toHaveBeenCalled();
    expect(d.updatePermissionRole).toHaveBeenCalledWith("FID", "perm-anyone", "writer");
  });

  it("falls back to a generic Drive URL when the file has no webViewLink", async () => {
    const d = deps();
    const out = collect();
    await handleShareLink({
      ...d,
      getFile: async () => file({ web_view_link: null }),
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("https://drive.google.com/open?id=FID");
  });

  it("prints only the URL in quiet mode and both fields in JSON", async () => {
    const d = deps();
    const q = collect();
    await handleShareLink({ ...d, quiet: true, write: q.write });
    expect(q.output).toBe("https://docs.google.com/document/d/FID/edit");

    const j = collect();
    await handleShareLink({ ...d, format: "json", write: j.write });
    const parsed: {
      data: { id: string; web_view_link: string; permission: DrivePermission };
    } = JSON.parse(j.output);
    expect(parsed.data.id).toBe("FID");
    expect(parsed.data.web_view_link).toBe("https://docs.google.com/document/d/FID/edit");
    expect(parsed.data.permission).toEqual(perm());
  });

  it("rejects an invalid role", async () => {
    const d = deps();
    await expect(handleShareLink({ ...d, role: "owner" })).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
  });

  it.each([["organizer"], ["fileOrganizer"]])(
    "rejects %s: an anyone-with-link permission cannot hold it (decision 0018)",
    async (role) => {
      const d = deps();
      await expect(handleShareLink({ ...d, role })).rejects.toMatchObject({
        code: "INVALID_ARGS",
        message: expect.stringContaining("commenter"),
      });
    },
  );
});
