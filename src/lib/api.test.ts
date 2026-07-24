import { describe, expect, it, vi } from "vitest";
import {
  copyFile,
  createFolder,
  deleteFile,
  downloadMedia,
  escapeQueryValue,
  exportFile,
  getFile,
  listChildren,
  mapDriveError,
  mimeToType,
  moveFile,
  normalizeFile,
  searchFiles,
  trashFile,
  typeFilterClause,
  uploadMedia,
  createPermission,
  deletePermission,
  inferGrantee,
  listPermissions,
  normalizePermission,
  updatePermissionRole,
  type DriveClient,
  type DriveFileRaw,
  type ListParams,
} from "./api.ts";
import { AppError } from "../types/index.ts";

function raw(overrides: Partial<DriveFileRaw> = {}): DriveFileRaw {
  return { id: "id1", name: "File", mimeType: "text/plain", ...overrides };
}

/** Typed accessor for a mock call's argument (works around vi.fn param inference). */
function argOf<T>(fn: unknown, callIdx = 0, argIdx = 0): T {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls[callIdx]?.[argIdx] as T;
}

type CreateParam = Parameters<DriveClient["files"]["create"]>[0];
type CopyParam = Parameters<DriveClient["files"]["copy"]>[0];
type UpdateParam = Parameters<DriveClient["files"]["update"]>[0];

/** A DriveClient whose methods are vi mocks; override per test. */
function mockDrive(
  overrides: Partial<DriveClient["files"]> = {},
  permissionOverrides: Partial<DriveClient["permissions"]> = {},
): DriveClient {
  return {
    files: {
      list: vi.fn(async () => ({ data: { files: [] } })),
      get: vi.fn(async () => ({ data: raw() })),
      create: vi.fn(async () => ({ data: raw() })),
      copy: vi.fn(async () => ({ data: raw() })),
      update: vi.fn(async () => ({ data: raw() })),
      delete: vi.fn(async () => ({})),
      export: vi.fn(async () => ({ data: "exported" })),
      ...overrides,
    },
    permissions: {
      list: vi.fn(async () => ({ data: { permissions: [] } })),
      create: vi.fn(async () => ({ data: { id: "p1", type: "user", role: "reader" } })),
      update: vi.fn(async () => ({ data: { id: "p1", type: "anyone", role: "writer" } })),
      delete: vi.fn(async () => ({})),
      ...permissionOverrides,
    },
  };
}

describe("mimeToType / normalizeFile", () => {
  it("maps known Google MIME types to friendly labels", () => {
    expect(mimeToType("application/vnd.google-apps.folder")).toBe("folder");
    expect(mimeToType("application/vnd.google-apps.document")).toBe("doc");
    expect(mimeToType("application/vnd.google-apps.spreadsheet")).toBe("sheet");
    expect(mimeToType("application/vnd.google-apps.presentation")).toBe("slides");
    expect(mimeToType("image/png")).toBe("file");
  });

  it("normalizes a binary file (numeric size, owners flattened)", () => {
    const file = normalizeFile(
      raw({
        id: "abc",
        name: "photo.png",
        mimeType: "image/png",
        size: "2048",
        parents: ["p1"],
        webViewLink: "https://x",
        createdTime: "2026-01-01T00:00:00Z",
        modifiedTime: "2026-02-01T00:00:00Z",
        owners: [{ emailAddress: "me@x.com" }],
      }),
    );
    expect(file).toEqual({
      id: "abc",
      name: "photo.png",
      mime_type: "image/png",
      type: "file",
      size: 2048,
      parents: ["p1"],
      trashed: false,
      web_view_link: "https://x",
      created: "2026-01-01T00:00:00Z",
      modified: "2026-02-01T00:00:00Z",
      owners: ["me@x.com"],
    });
  });

  it("reports null size for Google-native files", () => {
    const file = normalizeFile(raw({ mimeType: "application/vnd.google-apps.document" }));
    expect(file.size).toBeNull();
    expect(file.type).toBe("doc");
  });
});

describe("query helpers", () => {
  it("escapes backslashes and single quotes", () => {
    expect(escapeQueryValue("O'Brien")).toBe("O\\'Brien");
    expect(escapeQueryValue("a\\b")).toBe("a\\\\b");
  });

  it("builds type filter clauses", () => {
    expect(typeFilterClause("folder")).toBe("mimeType = 'application/vnd.google-apps.folder'");
    expect(typeFilterClause("file")).toBe("mimeType != 'application/vnd.google-apps.folder'");
    expect(typeFilterClause(undefined)).toBeNull();
  });
});

describe("listChildren", () => {
  it("aggregates across pages up to the limit and builds the parent query", async () => {
    const pages: Record<string, { files: DriveFileRaw[]; nextPageToken?: string }> = {
      "": { files: [raw({ id: "a" }), raw({ id: "b" })], nextPageToken: "p2" },
      p2: { files: [raw({ id: "c" })] },
    };
    const list = vi.fn(async (params: ListParams) => ({
      data: pages[params.pageToken ?? ""] ?? { files: [] },
    }));
    const drive = mockDrive({ list });

    const files = await listChildren(drive, "FOLDER", { trashed: false });
    expect(files.map((f) => f.id)).toEqual(["a", "b", "c"]);
    const firstQ = argOf<ListParams>(list).q;
    expect(firstQ).toContain("'FOLDER' in parents");
    expect(firstQ).toContain("trashed = false");
  });

  it("stops at the requested limit", async () => {
    const list = vi.fn(async () => ({
      data: { files: [raw({ id: "a" }), raw({ id: "b" }), raw({ id: "c" })] },
    }));
    const files = await listChildren(mockDrive({ list }), "F", { limit: 2 });
    expect(files.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("adds a type filter and orderBy", async () => {
    const list = vi.fn(async () => ({ data: { files: [] } }));
    await listChildren(mockDrive({ list }), "F", { type: "folder", order: "modified" });
    const params = argOf<ListParams>(list);
    expect(params.q).toContain("mimeType = 'application/vnd.google-apps.folder'");
    expect(params.orderBy).toBe("modifiedTime desc");
  });
});

describe("searchFiles", () => {
  it("queries name and fullText", async () => {
    const list = vi.fn(async () => ({ data: { files: [raw({ id: "x" })] } }));
    const files = await searchFiles(mockDrive({ list }), "budget");
    expect(files.map((f) => f.id)).toEqual(["x"]);
    const q = argOf<ListParams>(list).q;
    expect(q).toContain("name contains 'budget'");
    expect(q).toContain("fullText contains 'budget'");
  });
});

describe("metadata & mutations", () => {
  it("getFile normalizes the response", async () => {
    const get = vi.fn(async () => ({ data: raw({ id: "g", name: "doc" }) }));
    expect((await getFile(mockDrive({ get }), "g")).name).toBe("doc");
  });

  it("createFolder sets the folder MIME and parent", async () => {
    const create = vi.fn(async () => ({
      data: raw({ id: "new", mimeType: "application/vnd.google-apps.folder" }),
    }));
    const drive = mockDrive({ create });
    const folder = await createFolder(drive, "New", "PARENT");
    expect(folder.type).toBe("folder");
    const body = argOf<CreateParam>(create).requestBody;
    expect(body).toMatchObject({
      name: "New",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["PARENT"],
    });
  });

  it("copyFile passes parent and optional name", async () => {
    const copy = vi.fn(async () => ({ data: raw({ id: "copy" }) }));
    await copyFile(mockDrive({ copy }), "src", "DEST", "renamed");
    expect(argOf<CopyParam>(copy)).toMatchObject({
      fileId: "src",
      requestBody: { parents: ["DEST"], name: "renamed" },
    });
  });

  it("moveFile removes current parents and adds the new one", async () => {
    const get = vi.fn(async () => ({ data: raw({ id: "m", parents: ["old1", "old2"] }) }));
    const update = vi.fn(async () => ({ data: raw({ id: "m", parents: ["DEST"] }) }));
    await moveFile(mockDrive({ get, update }), "m", "DEST");
    expect(argOf<UpdateParam>(update)).toMatchObject({
      fileId: "m",
      addParents: "DEST",
      removeParents: "old1,old2",
    });
  });

  it("trashFile sets trashed=true", async () => {
    const update = vi.fn(async () => ({ data: raw({ trashed: true }) }));
    await trashFile(mockDrive({ update }), "t");
    expect(argOf<UpdateParam>(update).requestBody).toEqual({ trashed: true });
  });

  it("deleteFile calls delete", async () => {
    const del = vi.fn(async () => ({}));
    await deleteFile(mockDrive({ delete: del }), "d");
    expect(del).toHaveBeenCalledWith({ fileId: "d" });
  });

  it("uploadMedia sends media and optional conversion type", async () => {
    const create = vi.fn(async () => ({ data: raw({ id: "up" }) }));
    await uploadMedia(mockDrive({ create }), {
      name: "n.csv",
      mimeType: "text/csv",
      body: "a,b",
      parentId: "P",
      convertToMimeType: "application/vnd.google-apps.spreadsheet",
    });
    const call = argOf<CreateParam>(create);
    expect(call.media).toMatchObject({ mimeType: "text/csv", body: "a,b" });
    expect(call.requestBody).toMatchObject({
      name: "n.csv",
      parents: ["P"],
      mimeType: "application/vnd.google-apps.spreadsheet",
    });
  });

  it("downloadMedia and exportFile return the payload", async () => {
    const get = vi.fn(async () => ({ data: "binary" }));
    expect(await downloadMedia(mockDrive({ get }), "f")).toBe("binary");
    const exp = vi.fn(async () => ({ data: "pdf-bytes" }));
    expect(await exportFile(mockDrive({ export: exp }), "f", "application/pdf")).toBe("pdf-bytes");
  });
});

describe("mapDriveError", () => {
  it.each([
    [401, "AUTH_EXPIRED"],
    [403, "AUTH_REQUIRED"],
    [404, "NOT_FOUND"],
    [500, "API_ERROR"],
  ])("maps HTTP %i to %s", (httpCode, expected) => {
    const err = Object.assign(new Error("boom"), { code: httpCode });
    let code: string | undefined;
    try {
      mapDriveError(err);
    } catch (e) {
      code = (e as AppError).code;
    }
    expect(code).toBe(expected);
  });

  it("surfaces mapped errors through wrapper functions", async () => {
    const get = vi.fn(async () => {
      throw Object.assign(new Error("nope"), { code: 404 });
    });
    await expect(getFile(mockDrive({ get }), "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// --- Permissions (decision 0011) --------------------------------------------

type PermCreateParam = Parameters<DriveClient["permissions"]["create"]>[0];
type PermUpdateParam = Parameters<DriveClient["permissions"]["update"]>[0];

describe("normalizePermission", () => {
  it("normalizes a user grant", () => {
    expect(
      normalizePermission({
        id: "perm-abc",
        type: "user",
        role: "writer",
        emailAddress: "alice@example.com",
        displayName: "Alice",
      }),
    ).toEqual({
      id: "perm-abc",
      type: "user",
      role: "writer",
      email: "alice@example.com",
      display_name: "Alice",
      domain: null,
      allow_file_discovery: false,
      deleted: false,
    });
  });

  it("normalizes an anyone grant with discovery enabled", () => {
    expect(
      normalizePermission({
        id: "perm-any",
        type: "anyone",
        role: "reader",
        allowFileDiscovery: true,
      }),
    ).toMatchObject({ type: "anyone", email: null, allow_file_discovery: true });
  });
});

describe("inferGrantee", () => {
  it("infers user from an email address", () => {
    expect(inferGrantee({ to: "alice@example.com" })).toEqual({
      type: "user",
      emailAddress: "alice@example.com",
    });
  });

  it("infers group for a googlegroups.com address", () => {
    expect(inferGrantee({ to: "team@googlegroups.com" })).toEqual({
      type: "group",
      emailAddress: "team@googlegroups.com",
    });
  });

  it("infers domain and anyone", () => {
    expect(inferGrantee({ domain: "example.com" })).toEqual({
      type: "domain",
      domain: "example.com",
    });
    expect(inferGrantee({ anyone: true })).toEqual({ type: "anyone" });
  });

  it("rejects zero or multiple grantees", () => {
    expect(() => inferGrantee({})).toThrow(AppError);
    expect(() => inferGrantee({ to: "a@b.com", anyone: true })).toThrow(/only one/i);
  });

  it("rejects a --to value that is not an email address", () => {
    expect(() => inferGrantee({ to: "alice" })).toThrow(/email/i);
  });
});

describe("permission operations", () => {
  it("listPermissions normalizes and follows pages", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          permissions: [{ id: "p1", type: "user", role: "owner", emailAddress: "me@x.com" }],
          nextPageToken: "T",
        },
      })
      .mockResolvedValueOnce({
        data: { permissions: [{ id: "p2", type: "anyone", role: "reader" }] },
      });
    const perms = await listPermissions(mockDrive({}, { list }), "F");
    expect(perms.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(perms[0]?.email).toBe("me@x.com");
  });

  it("createPermission sends the grantee body and notification flags", async () => {
    const create = vi.fn(async () => ({
      data: { id: "p9", type: "user", role: "writer", emailAddress: "a@b.com" },
    }));
    const perm = await createPermission(mockDrive({}, { create }), "F", {
      type: "user",
      role: "writer",
      emailAddress: "a@b.com",
      sendNotificationEmail: true,
      emailMessage: "hi",
    });
    const call = argOf<PermCreateParam>(create);
    expect(call.fileId).toBe("F");
    expect(call.requestBody).toEqual({ type: "user", role: "writer", emailAddress: "a@b.com" });
    expect(call.sendNotificationEmail).toBe(true);
    expect(call.emailMessage).toBe("hi");
    expect(perm.id).toBe("p9");
  });

  it("createPermission defaults to no notification email", async () => {
    const create = vi.fn(async () => ({ data: { id: "p9", type: "anyone", role: "reader" } }));
    await createPermission(mockDrive({}, { create }), "F", { type: "anyone", role: "reader" });
    const call = argOf<PermCreateParam>(create);
    expect(call.sendNotificationEmail).toBe(false);
    expect(call.requestBody).toEqual({ type: "anyone", role: "reader" });
  });

  it("updatePermissionRole patches the role", async () => {
    const update = vi.fn(async () => ({ data: { id: "p1", type: "anyone", role: "writer" } }));
    const perm = await updatePermissionRole(mockDrive({}, { update }), "F", "p1", "writer");
    const call = argOf<PermUpdateParam>(update);
    expect(call).toMatchObject({
      fileId: "F",
      permissionId: "p1",
      requestBody: { role: "writer" },
    });
    expect(perm.role).toBe("writer");
  });

  it("deletePermission calls through and maps errors", async () => {
    const del = vi.fn(async () => ({}));
    await deletePermission(mockDrive({}, { delete: del }), "F", "p1");
    expect(del).toHaveBeenCalledWith({ fileId: "F", permissionId: "p1" });

    const boom = vi.fn(async () => {
      throw Object.assign(new Error("nope"), { code: 404 });
    });
    await expect(
      deletePermission(mockDrive({}, { delete: boom }), "F", "p1"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
