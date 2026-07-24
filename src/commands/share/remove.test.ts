import { describe, expect, it, vi } from "vitest";
import { handleShareRemove } from "./remove.ts";
import type { DrivePermission } from "../../types/index.ts";

function perm(overrides: Partial<DrivePermission> = {}): DrivePermission {
  return {
    id: "perm-abc",
    type: "user",
    role: "writer",
    email: "alice@example.com",
    display_name: null,
    domain: null,
    allow_file_discovery: false,
    deleted: false,
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

describe("handleShareRemove", () => {
  it("removes by --permission-id without listing", async () => {
    const listPermissions = vi.fn(async () => [perm()]);
    const deletePermission = vi.fn(async () => {});
    await handleShareRemove({
      resolvePath: async () => "FID",
      listPermissions,
      deletePermission,
      file: "F",
      permissionId: "perm-xyz",
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(listPermissions).not.toHaveBeenCalled();
    expect(deletePermission).toHaveBeenCalledWith("FID", "perm-xyz");
  });

  it("resolves --to to a permission id (case-insensitive)", async () => {
    const deletePermission = vi.fn(async () => {});
    const out = collect();
    await handleShareRemove({
      resolvePath: async () => "FID",
      listPermissions: async () => [perm({ id: "p1", email: "Alice@Example.com" })],
      deletePermission,
      file: "F",
      to: "alice@example.com",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(deletePermission).toHaveBeenCalledWith("FID", "p1");
    expect(out.output).toBe("Removed permission p1 from FID");
  });

  it("fails with NOT_FOUND when the email has no permission", async () => {
    await expect(
      handleShareRemove({
        resolvePath: async () => "FID",
        listPermissions: async () => [perm({ email: "bob@example.com" })],
        deletePermission: async () => {},
        file: "F",
        to: "alice@example.com",
        format: "text",
        quiet: false,
        write: () => {},
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires exactly one of --to / --permission-id", async () => {
    const base = {
      resolvePath: async () => "FID",
      listPermissions: async () => [perm()],
      deletePermission: async () => {},
      file: "F",
      format: "text" as const,
      quiet: false,
      write: () => {},
    };
    await expect(handleShareRemove({ ...base })).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(
      handleShareRemove({ ...base, to: "a@b.com", permissionId: "p1" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("prints nothing in quiet mode but keeps the JSON envelope", async () => {
    const q = collect();
    await handleShareRemove({
      resolvePath: async () => "FID",
      listPermissions: async () => [perm()],
      deletePermission: async () => {},
      file: "F",
      permissionId: "p1",
      format: "text",
      quiet: true,
      write: q.write,
    });
    expect(q.output).toBe("");

    const j = collect();
    await handleShareRemove({
      resolvePath: async () => "FID",
      listPermissions: async () => [perm()],
      deletePermission: async () => {},
      file: "F",
      permissionId: "p1",
      format: "json",
      quiet: false,
      write: j.write,
    });
    const parsed: { data: unknown } = JSON.parse(j.output);
    expect(parsed.data).toEqual({ id: "FID", permission_id: "p1", removed: true });
  });
});
