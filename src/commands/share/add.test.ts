import { describe, expect, it, vi } from "vitest";
import { handleShareAdd, parseRole } from "./add.ts";
import type { DrivePermission } from "../../types/index.ts";
import type { PermissionCreateInput } from "../../lib/api.ts";

function perm(overrides: Partial<DrivePermission> = {}): DrivePermission {
  return {
    id: "perm-abc",
    type: "user",
    role: "reader",
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

describe("parseRole", () => {
  it("defaults to reader and accepts commenter/writer", () => {
    expect(parseRole(undefined)).toBe("reader");
    expect(parseRole("commenter")).toBe("commenter");
    expect(parseRole("writer")).toBe("writer");
  });

  it("rejects owner (out of scope) and unknown roles", () => {
    expect(() => parseRole("owner")).toThrow(/owner/i);
    expect(() => parseRole("editor")).toThrow(/Invalid --role/);
  });
});

describe("handleShareAdd", () => {
  it("grants a user reader role by default and sends no notification", async () => {
    const createPermission = vi.fn(async (_id: string, _i: PermissionCreateInput) => perm());
    const out = collect();
    await handleShareAdd({
      resolvePath: async () => "FID",
      createPermission,
      file: "F",
      to: "alice@example.com",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(createPermission.mock.calls[0]?.[0]).toBe("FID");
    expect(createPermission.mock.calls[0]?.[1]).toEqual({
      type: "user",
      role: "reader",
      emailAddress: "alice@example.com",
    });
    expect(out.output).toBe("Granted reader to alice@example.com (perm-abc)");
  });

  it("passes --notify and --message through", async () => {
    const createPermission = vi.fn(async (_id: string, _i: PermissionCreateInput) => perm());
    await handleShareAdd({
      resolvePath: async () => "FID",
      createPermission,
      file: "F",
      to: "alice@example.com",
      role: "writer",
      notify: true,
      message: "please review",
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(createPermission.mock.calls[0]?.[1]).toEqual({
      type: "user",
      role: "writer",
      emailAddress: "alice@example.com",
      sendNotificationEmail: true,
      emailMessage: "please review",
    });
  });

  it("infers a domain grant and honors --allow-discovery", async () => {
    const createPermission = vi.fn(async (_id: string, _i: PermissionCreateInput) =>
      perm({ type: "domain", email: null, domain: "example.com" }),
    );
    const out = collect();
    await handleShareAdd({
      resolvePath: async () => "FID",
      createPermission,
      file: "F",
      domain: "example.com",
      allowDiscovery: true,
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(createPermission.mock.calls[0]?.[1]).toEqual({
      type: "domain",
      role: "reader",
      domain: "example.com",
      allowFileDiscovery: true,
    });
    expect(out.output).toBe("Granted reader to example.com (perm-abc)");
  });

  it("infers an anyone grant", async () => {
    const createPermission = vi.fn(async (_id: string, _i: PermissionCreateInput) =>
      perm({ type: "anyone", email: null }),
    );
    const out = collect();
    await handleShareAdd({
      resolvePath: async () => "FID",
      createPermission,
      file: "F",
      anyone: true,
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(createPermission.mock.calls[0]?.[1]).toEqual({ type: "anyone", role: "reader" });
    expect(out.output).toBe("Granted reader to anyone with the link (perm-abc)");
  });

  it("rejects missing or conflicting grantees with INVALID_ARGS", async () => {
    const base = {
      resolvePath: async () => "FID",
      createPermission: async () => perm(),
      file: "F",
      format: "text" as const,
      quiet: false,
      write: () => {},
    };
    await expect(handleShareAdd({ ...base })).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(
      handleShareAdd({ ...base, to: "a@b.com", domain: "example.com" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("prints the permission id in quiet mode and the envelope in JSON", async () => {
    const q = collect();
    await handleShareAdd({
      resolvePath: async () => "FID",
      createPermission: async () => perm(),
      file: "F",
      to: "alice@example.com",
      format: "text",
      quiet: true,
      write: q.write,
    });
    expect(q.output).toBe("perm-abc");

    const j = collect();
    await handleShareAdd({
      resolvePath: async () => "FID",
      createPermission: async () => perm(),
      file: "F",
      to: "alice@example.com",
      format: "json",
      quiet: false,
      write: j.write,
    });
    const parsed: {
      data: { id: string; permission: DrivePermission };
    } = JSON.parse(j.output);
    expect(parsed.data).toEqual({ id: "FID", permission: perm() });
  });
});
