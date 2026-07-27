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
  listSharedDrives,
  normalizePermission,
  resolveDriveScope,
  updatePermissionRole,
  type DriveClient,
  type DriveFileRaw,
  type ListParams,
  type SharedDriveListParams,
} from "./api.ts";
import { AppError } from "../types/index.ts";
import { callArgs } from "../../tests/helpers/mock.ts";

function raw(overrides: Partial<DriveFileRaw> = {}): DriveFileRaw {
  return { id: "id1", name: "File", mimeType: "text/plain", ...overrides };
}

type GetParam = Parameters<DriveClient["files"]["get"]>[0];
type CreateParam = Parameters<DriveClient["files"]["create"]>[0];
type CopyParam = Parameters<DriveClient["files"]["copy"]>[0];
type UpdateParam = Parameters<DriveClient["files"]["update"]>[0];
type DeleteParam = Parameters<DriveClient["files"]["delete"]>[0];
type ExportParam = Parameters<DriveClient["files"]["export"]>[0];

/** A DriveClient whose methods are vi mocks; override per test. */
function mockDrive(
  overrides: Partial<DriveClient["files"]> = {},
  permissionOverrides: Partial<DriveClient["permissions"]> = {},
  driveOverrides: Partial<DriveClient["drives"]> = {},
): DriveClient {
  return {
    drives: {
      list: vi.fn(async () => ({ data: { drives: [] } })),
      ...driveOverrides,
    },
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
    const firstQ = callArgs(list)[0].q;
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
    const list = vi.fn(async (_params: ListParams) => ({ data: { files: [] } }));
    await listChildren(mockDrive({ list }), "F", { type: "folder", order: "modified" });
    const params = callArgs(list)[0];
    expect(params.q).toContain("mimeType = 'application/vnd.google-apps.folder'");
    expect(params.orderBy).toBe("modifiedTime desc");
  });
});

describe("searchFiles", () => {
  it("queries name and fullText", async () => {
    const list = vi.fn(async (_params: ListParams) => ({ data: { files: [raw({ id: "x" })] } }));
    const files = await searchFiles(mockDrive({ list }), "budget");
    expect(files.map((f) => f.id)).toEqual(["x"]);
    const q = callArgs(list)[0].q;
    expect(q).toContain("name contains 'budget'");
    expect(q).toContain("fullText contains 'budget'");
  });
});

describe("metadata & mutations", () => {
  it("getFile normalizes the response", async () => {
    const get = vi.fn(async () => ({ data: raw({ id: "g", name: "doc" }) }));
    expect((await getFile(mockDrive({ get }), "g")).name).toBe("doc");
  });

  it("getFile rejects a response that is not a file object", async () => {
    const get = vi.fn(async () => ({ data: "<html>login</html>" }));
    await expect(getFile(mockDrive({ get }), "g")).rejects.toThrow(
      /Unexpected response from Drive/,
    );
  });

  it("getFile tolerates unknown extra fields in the response", async () => {
    const get = vi.fn(async () => ({ data: { ...raw({ id: "g", name: "doc" }), newField: 1 } }));
    expect((await getFile(mockDrive({ get }), "g")).name).toBe("doc");
  });

  it("createFolder sets the folder MIME and parent", async () => {
    const create = vi.fn(async (_params: CreateParam) => ({
      data: raw({ id: "new", mimeType: "application/vnd.google-apps.folder" }),
    }));
    const drive = mockDrive({ create });
    const folder = await createFolder(drive, "New", "PARENT");
    expect(folder.type).toBe("folder");
    const body = callArgs(create)[0].requestBody;
    expect(body).toMatchObject({
      name: "New",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["PARENT"],
    });
  });

  it("copyFile passes parent and optional name", async () => {
    const copy = vi.fn(async (_params: CopyParam) => ({ data: raw({ id: "copy" }) }));
    await copyFile(mockDrive({ copy }), "src", "DEST", "renamed");
    expect(callArgs(copy)[0]).toMatchObject({
      fileId: "src",
      requestBody: { parents: ["DEST"], name: "renamed" },
    });
  });

  it("moveFile removes current parents and adds the new one", async () => {
    const get = vi.fn(async () => ({ data: raw({ id: "m", parents: ["old1", "old2"] }) }));
    const update = vi.fn(async (_params: UpdateParam) => ({
      data: raw({ id: "m", parents: ["DEST"] }),
    }));
    await moveFile(mockDrive({ get, update }), "m", "DEST");
    expect(callArgs(update)[0]).toMatchObject({
      fileId: "m",
      addParents: "DEST",
      removeParents: "old1,old2",
    });
  });

  it("trashFile sets trashed=true", async () => {
    const update = vi.fn(async (_params: UpdateParam) => ({ data: raw({ trashed: true }) }));
    await trashFile(mockDrive({ update }), "t");
    expect(callArgs(update)[0].requestBody).toEqual({ trashed: true });
  });

  it("deleteFile calls delete", async () => {
    const del = vi.fn(async (_params: DeleteParam) => ({}));
    await deleteFile(mockDrive({ delete: del }), "d");
    expect(callArgs(del)[0]).toMatchObject({ fileId: "d" });
  });

  it("uploadMedia sends media and optional conversion type", async () => {
    const create = vi.fn(async (_params: CreateParam) => ({ data: raw({ id: "up" }) }));
    await uploadMedia(mockDrive({ create }), {
      name: "n.csv",
      mimeType: "text/csv",
      body: "a,b",
      parentId: "P",
      convertToMimeType: "application/vnd.google-apps.spreadsheet",
    });
    const call = callArgs(create)[0];
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

// --- Shared drives (decision 0016) ------------------------------------------

/** Asserts a mock was called and that every call declared shared-drive support. */
function expectSupportsAllDrives(fn: { mock: { calls: [unknown, ...unknown[]][] } }): void {
  expect(fn.mock.calls.length).toBeGreaterThan(0);
  for (const [params] of fn.mock.calls) {
    expect(params).toMatchObject({ supportsAllDrives: true });
  }
}

describe("supportsAllDrives", () => {
  it("is sent by every file operation", async () => {
    const list = vi.fn(async (_p: ListParams) => ({ data: { files: [] } }));
    const get = vi.fn(async (_p: GetParam) => ({ data: raw() }));
    const create = vi.fn(async (_p: CreateParam) => ({ data: raw() }));
    const copy = vi.fn(async (_p: CopyParam) => ({ data: raw() }));
    const update = vi.fn(async (_p: UpdateParam) => ({ data: raw() }));
    const del = vi.fn(async (_p: DeleteParam) => ({}));
    const drive = mockDrive({ list, get, create, copy, update, delete: del });

    await listChildren(drive, "F");
    await searchFiles(drive, "q");
    await getFile(drive, "f");
    await createFolder(drive, "n", "P");
    await copyFile(drive, "f", "P");
    await moveFile(drive, "f", "P");
    await trashFile(drive, "f");
    await deleteFile(drive, "f");
    await uploadMedia(drive, { name: "n.txt", mimeType: "text/plain", body: "x" });
    await downloadMedia(drive, "f");

    for (const fn of [list, get, create, copy, update, del]) expectSupportsAllDrives(fn);
  });

  it("is sent by every permission operation", async () => {
    const list = vi.fn(async (_p: PermListParam) => ({ data: { permissions: [] } }));
    const create = vi.fn(async (_p: PermCreateParam) => ({
      data: { id: "p1", type: "user", role: "reader" },
    }));
    const update = vi.fn(async (_p: PermUpdateParam) => ({
      data: { id: "p1", type: "user", role: "writer" },
    }));
    const del = vi.fn(async (_p: PermDeleteParam) => ({}));
    const drive = mockDrive({}, { list, create, update, delete: del });

    await listPermissions(drive, "F");
    await createPermission(drive, "F", { type: "anyone", role: "reader" });
    await updatePermissionRole(drive, "F", "p1", "writer");
    await deletePermission(drive, "F", "p1");

    for (const fn of [list, create, update, del]) expectSupportsAllDrives(fn);
  });

  it("is not sent by files.export, which has no such parameter", async () => {
    const exp = vi.fn(async (_p: ExportParam) => ({ data: "pdf" }));
    await exportFile(mockDrive({ export: exp }), "f", "application/pdf");
    expect(callArgs(exp)[0]).not.toHaveProperty("supportsAllDrives");
  });
});

describe("list scope (decision 0016)", () => {
  it("stays on My Drive when no scope is given", async () => {
    const list = vi.fn(async (_p: ListParams) => ({ data: { files: [] } }));
    await listChildren(mockDrive({ list }), "F");
    const params = callArgs(list)[0];
    expect(params.corpora).toBeUndefined();
    expect(params.driveId).toBeUndefined();
    expect(params.includeItemsFromAllDrives).toBeUndefined();
  });

  it("widens listChildren to every shared drive", async () => {
    const list = vi.fn(async (_p: ListParams) => ({ data: { files: [] } }));
    await listChildren(mockDrive({ list }), "F", { scope: { kind: "all" } });
    expect(callArgs(list)[0]).toMatchObject({
      corpora: "allDrives",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
  });

  it("restricts searchFiles to one shared drive", async () => {
    const list = vi.fn(async (_p: ListParams) => ({ data: { files: [] } }));
    await searchFiles(mockDrive({ list }), "budget", { scope: { kind: "drive", driveId: "D1" } });
    expect(callArgs(list)[0]).toMatchObject({
      corpora: "drive",
      driveId: "D1",
      includeItemsFromAllDrives: true,
    });
  });
});

describe("listSharedDrives / resolveDriveScope", () => {
  function driveList(pages: Record<string, { drives?: { id?: string; name?: string }[] }>) {
    return vi.fn(async (params: SharedDriveListParams) => ({
      data: pages[params.pageToken ?? ""] ?? { drives: [] },
    }));
  }

  it("lists shared drives across pages", async () => {
    const paged = vi.fn(async (params: SharedDriveListParams) =>
      params.pageToken === undefined
        ? { data: { drives: [{ id: "D1", name: "Team" }], nextPageToken: "p2" } }
        : { data: { drives: [{ id: "D2", name: "Ops" }] } },
    );
    const drives = await listSharedDrives(mockDrive({}, {}, { list: paged }));
    expect(drives).toEqual([
      { id: "D1", name: "Team" },
      { id: "D2", name: "Ops" },
    ]);
  });

  it("returns undefined when neither flag is given", async () => {
    expect(await resolveDriveScope(mockDrive(), {})).toBeUndefined();
  });

  it("maps --all-drives to the allDrives corpus without an API call", async () => {
    const list = driveList({});
    expect(await resolveDriveScope(mockDrive({}, {}, { list }), { allDrives: true })).toEqual({
      kind: "all",
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("resolves a drive name to its id", async () => {
    const list = driveList({
      "": {
        drives: [
          { id: "D1", name: "Team" },
          { id: "D2", name: "Ops" },
        ],
      },
    });
    expect(await resolveDriveScope(mockDrive({}, {}, { list }), { drive: "Ops" })).toEqual({
      kind: "drive",
      driveId: "D2",
    });
  });

  it("rejects both flags at once", async () => {
    await expect(
      resolveDriveScope(mockDrive(), { allDrives: true, drive: "Team" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("reports an unknown drive name as NOT_FOUND", async () => {
    const list = driveList({ "": { drives: [{ id: "D1", name: "Team" }] } });
    await expect(
      resolveDriveScope(mockDrive({}, {}, { list }), { drive: "Nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports an ambiguous drive name as INVALID_ARGS listing the ids", async () => {
    const list = driveList({
      "": {
        drives: [
          { id: "D1", name: "Team" },
          { id: "D2", name: "Team" },
        ],
      },
    });
    await expect(
      resolveDriveScope(mockDrive({}, {}, { list }), { drive: "Team" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS", message: expect.stringContaining("D1, D2") });
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
      if (e instanceof AppError) code = e.code;
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

type PermListParam = Parameters<DriveClient["permissions"]["list"]>[0];
type PermCreateParam = Parameters<DriveClient["permissions"]["create"]>[0];
type PermUpdateParam = Parameters<DriveClient["permissions"]["update"]>[0];
type PermDeleteParam = Parameters<DriveClient["permissions"]["delete"]>[0];

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
    const create = vi.fn(async (_params: PermCreateParam) => ({
      data: { id: "p9", type: "user", role: "writer", emailAddress: "a@b.com" },
    }));
    const perm = await createPermission(mockDrive({}, { create }), "F", {
      type: "user",
      role: "writer",
      emailAddress: "a@b.com",
      sendNotificationEmail: true,
      emailMessage: "hi",
    });
    const call = callArgs(create)[0];
    expect(call.fileId).toBe("F");
    expect(call.requestBody).toEqual({ type: "user", role: "writer", emailAddress: "a@b.com" });
    expect(call.sendNotificationEmail).toBe(true);
    expect(call.emailMessage).toBe("hi");
    expect(perm.id).toBe("p9");
  });

  it("createPermission defaults to no notification email", async () => {
    const create = vi.fn(async (_params: PermCreateParam) => ({
      data: { id: "p9", type: "anyone", role: "reader" },
    }));
    await createPermission(mockDrive({}, { create }), "F", { type: "anyone", role: "reader" });
    const call = callArgs(create)[0];
    expect(call.sendNotificationEmail).toBe(false);
    expect(call.requestBody).toEqual({ type: "anyone", role: "reader" });
  });

  it("updatePermissionRole patches the role", async () => {
    const update = vi.fn(async (_params: PermUpdateParam) => ({
      data: { id: "p1", type: "anyone", role: "writer" },
    }));
    const perm = await updatePermissionRole(mockDrive({}, { update }), "F", "p1", "writer");
    const call = callArgs(update)[0];
    expect(call).toMatchObject({
      fileId: "F",
      permissionId: "p1",
      requestBody: { role: "writer" },
    });
    expect(perm.role).toBe("writer");
  });

  it("deletePermission calls through and maps errors", async () => {
    const del = vi.fn(async (_params: PermDeleteParam) => ({}));
    await deletePermission(mockDrive({}, { delete: del }), "F", "p1");
    expect(callArgs(del)[0]).toMatchObject({ fileId: "F", permissionId: "p1" });

    const boom = vi.fn(async () => {
      throw Object.assign(new Error("nope"), { code: 404 });
    });
    await expect(
      deletePermission(mockDrive({}, { delete: boom }), "F", "p1"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
