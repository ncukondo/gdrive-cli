import { describe, expect, it, vi } from "vitest";
import { formatPermissionTable, handleShareList } from "./list.ts";
import type { DrivePermission } from "../../types/index.ts";

function perm(overrides: Partial<DrivePermission> = {}): DrivePermission {
  return {
    id: "perm-abc",
    type: "user",
    role: "writer",
    email: "alice@example.com",
    display_name: "Alice",
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

describe("handleShareList", () => {
  const permissions = [
    perm({ id: "perm-owner", role: "owner", email: "me@gmail.com", display_name: "Me" }),
    perm(),
    perm({ id: "perm-anyone", type: "anyone", role: "reader", email: null, display_name: null }),
  ];

  it("resolves the file and lists its permissions as a table", async () => {
    const resolvePath = vi.fn(async () => "FID");
    const out = collect();
    await handleShareList({
      resolvePath,
      listPermissions: async () => permissions,
      file: "Reports/plan",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(resolvePath).toHaveBeenCalledWith("Reports/plan");
    const lines = out.output.split("\n");
    expect(lines[0]?.split("\t")).toEqual(["Role", "Type", "Grantee", "Permission ID"]);
    expect(lines[1]?.split("\t")).toEqual(["owner", "user", "me@gmail.com", "perm-owner"]);
    expect(lines[3]?.split("\t")).toEqual([
      "reader",
      "anyone",
      "(anyone with link)",
      "perm-anyone",
    ]);
  });

  it("shows the domain as the grantee for domain grants", async () => {
    const out = collect();
    await handleShareList({
      resolvePath: async () => "FID",
      listPermissions: async () => [
        perm({ id: "p-d", type: "domain", role: "reader", email: null, domain: "example.com" }),
      ],
      file: "F",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toContain("example.com");
  });

  it("prints one permission id per line in quiet mode", async () => {
    const out = collect();
    await handleShareList({
      resolvePath: async () => "FID",
      listPermissions: async () => permissions,
      file: "F",
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("perm-owner\nperm-abc\nperm-anyone");
  });

  it("emits the JSON envelope with a permissions array", async () => {
    const out = collect();
    await handleShareList({
      resolvePath: async () => "FID",
      listPermissions: async () => permissions,
      file: "F",
      format: "json",
      quiet: false,
      write: out.write,
    });
    const parsed: {
      success: boolean;
      data: { id: string; permissions: DrivePermission[] };
    } = JSON.parse(out.output);
    expect(parsed.success).toBe(true);
    expect(parsed.data.id).toBe("FID");
    expect(parsed.data.permissions).toHaveLength(3);
    expect(parsed.data.permissions[1]).toEqual(perm());
  });

  // `fileOrganizer` (13) overran the role column sized for `commenter` (9), and
  // a long address overran the grantee column. Both were seen on a real drive,
  // and neither can recur once nothing is sized (decision 0036 §2).
  const wide = [
    perm({ id: "p1", role: "fileOrganizer", email: "takeshi.kondo.gp@example.com" }),
    perm({ id: "p2", role: "reader", email: "a@b.com" }),
  ];

  it("round-trips every field of every row, however wide a value is", () => {
    const rows = formatPermissionTable(wide).split("\n").slice(1);
    expect(rows.map((row) => row.split("\t"))).toEqual([
      ["fileOrganizer", "user", "takeshi.kondo.gp@example.com", "p1"],
      ["reader", "user", "a@b.com", "p2"],
    ]);
  });

  // A supplement to the round trip above: constant-width padding leaves rows
  // independent, so the round trip is what guards decision 0036 §2 (0039 §2).
  it("leaves every other row byte-identical when one grantee grows", () => {
    const before = formatPermissionTable(wide).split("\n");
    const after = formatPermissionTable([
      { ...perm({ id: "p1", role: "fileOrganizer" }), email: "a-very-much-longer@example.com" },
      ...wide.slice(1),
    ]).split("\n");
    expect(after.filter((_, i) => i !== 1)).toEqual(before.filter((_, i) => i !== 1));
  });

  it("reports an empty file as having no permissions", async () => {
    const out = collect();
    await handleShareList({
      resolvePath: async () => "FID",
      listPermissions: async () => [],
      file: "F",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toBe("No permissions.");
  });
});
