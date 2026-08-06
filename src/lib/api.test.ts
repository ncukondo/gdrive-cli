import { describe, expect, it, vi } from "vitest";
import {
  copyFile,
  createFolder,
  createShortcut,
  deleteFile,
  downloadMedia,
  escapeQueryValue,
  exportFile,
  FILE_FIELDS,
  FORM_MIME,
  getFile,
  listChildren,
  mapDriveError,
  mimeToType,
  moveFile,
  normalizeFile,
  renameFile,
  searchFiles,
  SHORTCUT_MIME,
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
  withRetry,
  type DriveClient,
  type DriveFileRaw,
  type ListParams,
  type SharedDriveListParams,
} from "./api.ts";
import { AppError, FILE_TYPES } from "../types/index.ts";
import { callArgs } from "../../tests/helpers/mock.ts";

function raw(overrides: Partial<DriveFileRaw> = {}): DriveFileRaw {
  return { id: "id1", name: "File", mimeType: "text/plain", ...overrides };
}

type GetParam = Parameters<DriveClient["files"]["get"]>[0];
type CreateParam = Parameters<DriveClient["files"]["create"]>[0];
type CopyParam = Parameters<DriveClient["files"]["copy"]>[0];
type UpdateParam = Parameters<DriveClient["files"]["update"]>[0];
type DeleteParam = Parameters<DriveClient["files"]["delete"]>[0];
type DriveGetParam = Parameters<DriveClient["drives"]["get"]>[0];
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
      get: vi.fn(async () => ({ data: { id: "D1", name: "Team" } })),
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
      target_id: null,
      target_type: null,
    });
  });

  it("reports null size for Google-native files", () => {
    const file = normalizeFile(raw({ mimeType: "application/vnd.google-apps.document" }));
    expect(file.size).toBeNull();
    expect(file.type).toBe("doc");
  });
});

describe("normalizeFile on a shortcut (decision 0025 §2)", () => {
  it("reports type shortcut with the target's id and type", () => {
    const file = normalizeFile(
      raw({
        id: "1Lnk",
        name: "2026 Budget",
        mimeType: SHORTCUT_MIME,
        shortcutDetails: {
          targetId: "1AbC",
          targetMimeType: "application/vnd.google-apps.spreadsheet",
        },
      }),
    );
    expect(file.type).toBe("shortcut");
    expect(file.target_id).toBe("1AbC");
    expect(file.target_type).toBe("sheet");
  });

  it("runs the target MIME through the same map, so an unknown one is `file`", () => {
    const file = normalizeFile(
      raw({
        mimeType: SHORTCUT_MIME,
        shortcutDetails: { targetId: "1AbC", targetMimeType: "application/zip" },
      }),
    );
    expect(file.target_type).toBe("file");
  });

  it("leaves both target fields null on anything that is not a shortcut", () => {
    const file = normalizeFile(raw({ mimeType: "image/png" }));
    expect(file.target_id).toBeNull();
    expect(file.target_type).toBeNull();
  });

  it("maps the shortcut MIME on its own", () => {
    expect(mimeToType(SHORTCUT_MIME)).toBe("shortcut");
  });

  it("asks Drive for the target on every file read", () => {
    // Without this field the target id never arrives, whatever normalizeFile does.
    expect(FILE_FIELDS).toContain("shortcutDetails(targetId,targetMimeType)");
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

  it("filters shortcuts by their own MIME, leaving `file` inclusive (decision 0025 §7)", () => {
    expect(typeFilterClause("shortcut")).toBe(`mimeType = '${SHORTCUT_MIME}'`);
    // `file` still means "anything that is not a folder", shortcuts included.
    expect(typeFilterClause("file")).not.toContain("shortcut");
  });

  /**
   * `file` is the residue, so a member with no clause of its own would silently
   * filter as "not a folder" instead of failing. Asserted over the vocabulary so
   * the next member cannot land there unnoticed.
   */
  it.each([...FILE_TYPES].filter((type) => type !== "file"))(
    "filters %s on a MIME the map labels with that very type",
    (type) => {
      const mime = /^mimeType = '(.+)'$/.exec(typeFilterClause(type) ?? "")?.[1];
      expect(mime).toBeDefined();
      expect(mimeToType(mime ?? "")).toBe(type);
    },
  );
});

/**
 * A form earns a label because `forms read` and `forms responses` act on one
 * (decision 0034 §1). A live run found `info` reporting a form as `type: file`,
 * `target_type: file` on a shortcut to one, and no `--type` value that finds it.
 */
describe("a form is a type of its own (decision 0034)", () => {
  it("labels the form MIME on the file itself", () => {
    expect(mimeToType(FORM_MIME)).toBe("form");
    expect(normalizeFile(raw({ mimeType: FORM_MIME })).type).toBe("form");
  });

  it("labels a shortcut's target through the same map (decision 0025 §2)", () => {
    const file = normalizeFile(
      raw({
        mimeType: SHORTCUT_MIME,
        shortcutDetails: { targetId: "1FoRm", targetMimeType: FORM_MIME },
      }),
    );
    expect(file.target_type).toBe("form");
  });

  it("filters on the form MIME", () => {
    expect(typeFilterClause("form")).toBe(`mimeType = '${FORM_MIME}'`);
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

  it('getFile names a shared drive root after the drive, not "Drive" (decision 0020)', async () => {
    const ROOT = "0ANPgzMZtaAa6Uk9PVA";
    const get = vi.fn(async () => ({
      data: raw({ id: ROOT, name: "Drive", mimeType: "application/vnd.google-apps.folder" }),
    }));
    const drivesGet = vi.fn(async (_p: DriveGetParam) => ({
      data: { id: ROOT, name: "専門医部会" },
    }));
    const file = await getFile(mockDrive({ get }, {}, { get: drivesGet }), ROOT);
    expect(file.name).toBe("専門医部会");
    expect(file.type).toBe("folder");
    expect(callArgs(drivesGet)[0]).toMatchObject({ driveId: ROOT });
  });

  it("getFile leaves a drive root alone once Google names it correctly", async () => {
    const ROOT = "0ANPgzMZtaAa6Uk9PVA";
    const get = vi.fn(async () => ({
      data: raw({ id: ROOT, name: "専門医部会", mimeType: "application/vnd.google-apps.folder" }),
    }));
    const drivesGet = vi.fn(async (_p: DriveGetParam) => ({ data: { id: ROOT, name: "other" } }));
    expect((await getFile(mockDrive({ get }, {}, { get: drivesGet }), ROOT)).name).toBe(
      "専門医部会",
    );
    expect(drivesGet).not.toHaveBeenCalled();
  });

  it("getFile does not second-guess an ordinary file that is named Drive", async () => {
    const get = vi.fn(async () => ({ data: raw({ id: "1AbCdEfGhIjKlMnOpQrSt", name: "Drive" }) }));
    const drivesGet = vi.fn(async (_p: DriveGetParam) => ({ data: { id: "x", name: "nope" } }));
    const file = await getFile(mockDrive({ get }, {}, { get: drivesGet }), "1AbCdEfGhIjKlMnOpQrSt");
    expect(file.name).toBe("Drive");
    expect(drivesGet).not.toHaveBeenCalled();
  });

  it("getFile keeps the generic name when the drive lookup fails", async () => {
    const ROOT = "0ANPgzMZtaAa6Uk9PVA";
    const get = vi.fn(async () => ({
      data: raw({ id: ROOT, name: "Drive", mimeType: "application/vnd.google-apps.folder" }),
    }));
    const drivesGet = vi.fn(async (_p: DriveGetParam) => {
      throw Object.assign(new Error("denied"), { code: 403 });
    });
    expect((await getFile(mockDrive({ get }, {}, { get: drivesGet }), ROOT)).name).toBe("Drive");
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

  it("createShortcut sends the shortcut MIME, the parent, the target and the name", async () => {
    const create = vi.fn(async (_params: CreateParam) => ({
      data: raw({
        id: "lnk",
        name: "Budget",
        mimeType: SHORTCUT_MIME,
        shortcutDetails: {
          targetId: "T1",
          targetMimeType: "application/vnd.google-apps.document",
        },
      }),
    }));
    const shortcut = await createShortcut(mockDrive({ create }), "T1", "DEST", "Budget");
    expect(callArgs(create)[0].requestBody).toMatchObject({
      name: "Budget",
      mimeType: SHORTCUT_MIME,
      parents: ["DEST"],
      shortcutDetails: { targetId: "T1" },
    });
    expect(shortcut).toMatchObject({
      id: "lnk",
      type: "shortcut",
      target_id: "T1",
      target_type: "doc",
    });
  });

  it("createShortcut lets a placement Drive refuses travel as PERMISSION_DENIED", async () => {
    // The rule is Google's, so the message is too (decision 0026 §4).
    const create = vi.fn(async (_params: CreateParam) => {
      throw Object.assign(
        new Error("Shortcuts to files outside this shared drive are not allowed"),
        {
          code: 403,
        },
      );
    });
    await expect(
      createShortcut(mockDrive({ create }), "T1", "DEST", "Budget"),
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Shortcuts to files outside this shared drive are not allowed",
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

  it("renameFile sends the new name and nothing else, and returns the renamed file", async () => {
    const update = vi.fn(async (_params: UpdateParam) => ({
      data: raw({ id: "r", name: "Notes 2026" }),
    }));
    const renamed = await renameFile(mockDrive({ update }), "r", "Notes 2026");
    const call = callArgs(update)[0];
    // Only `name`: a rename that also carried `trashed` or `parents` would be a
    // different operation wearing this one's name.
    expect(call.requestBody).toEqual({ name: "Notes 2026" });
    expect(call).toMatchObject({
      fileId: "r",
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
    expect(renamed).toMatchObject({ id: "r", name: "Notes 2026" });
  });

  it("renameFile lets a Drive refusal travel as PERMISSION_DENIED, in Drive's words", async () => {
    const update = vi.fn(async (_params: UpdateParam) => {
      throw Object.assign(
        new Error("The user does not have sufficient permissions for this file"),
        {
          code: 403,
        },
      );
    });
    await expect(renameFile(mockDrive({ update }), "r", "Notes 2026")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "The user does not have sufficient permissions for this file",
    });
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
    await createShortcut(drive, "t", "P", "n");
    await moveFile(drive, "f", "P");
    await trashFile(drive, "f");
    await renameFile(drive, "f", "n");
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
  it("lets listChildren see a shared-drive folder's children with no flag", async () => {
    // The parent filter already pins the corpus, so including shared-drive
    // items costs nothing and is the difference between `ls <shared folder id>`
    // working and silently printing nothing.
    const list = vi.fn(async (_p: ListParams) => ({ data: { files: [] } }));
    await listChildren(mockDrive({ list }), "F");
    const params = callArgs(list)[0];
    expect(params.includeItemsFromAllDrives).toBe(true);
    expect(params.corpora).toBeUndefined();
    expect(params.driveId).toBeUndefined();
  });

  it("keeps searchFiles on My Drive when no scope is given", async () => {
    const list = vi.fn(async (_p: ListParams) => ({ data: { files: [] } }));
    await searchFiles(mockDrive({ list }), "budget");
    const params = callArgs(list)[0];
    expect(params.includeItemsFromAllDrives).toBeUndefined();
    expect(params.corpora).toBeUndefined();
    expect(params.driveId).toBeUndefined();
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

  it("skips shared drives the API returns without an id", async () => {
    const list = driveList({ "": { drives: [{ name: "Broken" }, { id: "D1", name: "Team" }] } });
    expect(await listSharedDrives(mockDrive({}, {}, { list }))).toEqual([
      { id: "D1", name: "Team" },
    ]);
  });

  it("maps a listSharedDrives failure like every other Drive call", async () => {
    const list = vi.fn(async (_p: SharedDriveListParams) => {
      throw Object.assign(new Error("denied"), { code: 403 });
    });
    await expect(listSharedDrives(mockDrive({}, {}, { list }))).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("reports an unknown drive name as NOT_FOUND, listing what is available", async () => {
    const list = driveList({
      "": {
        drives: [
          { id: "D1", name: "Team" },
          { id: "D2", name: "Ops" },
        ],
      },
    });
    await expect(
      resolveDriveScope(mockDrive({}, {}, { list }), { drive: "Nope" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("Team, Ops"),
    });
  });

  it("says so plainly when the account has no shared drives at all", async () => {
    const list = driveList({});
    await expect(
      resolveDriveScope(mockDrive({}, {}, { list }), { drive: "Nope" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("no shared drives"),
    });
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
  const codeOf = (error: unknown): string | undefined => {
    try {
      mapDriveError(error);
    } catch (e) {
      if (e instanceof AppError) return e.code;
    }
    return undefined;
  };

  /** A googleapis 403 carrying Drive's untyped error body. */
  const forbidden = (message: string, reason?: unknown) =>
    Object.assign(new Error(message), {
      code: 403,
      response: { data: { error: { errors: reason === undefined ? [] : [{ reason }] } } },
    });

  it.each([
    [401, "AUTH_EXPIRED"],
    [403, "PERMISSION_DENIED"],
    [404, "NOT_FOUND"],
    [500, "API_ERROR"],
  ])("maps HTTP %i to %s", (httpCode, expected) => {
    const err = Object.assign(new Error("boom"), { code: httpCode });
    expect(codeOf(err)).toBe(expected);
  });

  it("keeps a scope failure on AUTH_REQUIRED, where re-authenticating helps", () => {
    expect(codeOf(forbidden("Insufficient Permission", "insufficientPermissions"))).toBe(
      "AUTH_REQUIRED",
    );
  });

  it("finds the scope reason in details[], where google.rpc.ErrorInfo puts it", () => {
    // The shape Google actually returns: the legacy reason in errors[], the
    // ErrorInfo one in details[]. Either alone has to be enough.
    const detailsOnly = Object.assign(new Error("nope"), {
      code: 403,
      response: {
        data: {
          error: {
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
              },
            ],
          },
        },
      },
    });
    expect(codeOf(detailsOnly)).toBe("AUTH_REQUIRED");
  });

  it("reads a scope failure out of the message when the body carries no reason", () => {
    const err = Object.assign(new Error("Request had insufficient authentication scopes."), {
      code: 403,
    });
    expect(codeOf(err)).toBe("AUTH_REQUIRED");
  });

  it("does not mistake insufficientFilePermissions for a scope failure", () => {
    expect(codeOf(forbidden("The user does not have sufficient permissions for this file."))).toBe(
      "PERMISSION_DENIED",
    );
    expect(
      codeOf(
        forbidden(
          "The user does not have sufficient permissions for this file.",
          "insufficientFilePermissions",
        ),
      ),
    ).toBe("PERMISSION_DENIED");
  });

  it("treats a rate-limit 403 as PERMISSION_DENIED rather than an auth problem", () => {
    expect(codeOf(forbidden("Rate Limit Exceeded", "userRateLimitExceeded"))).toBe(
      "PERMISSION_DENIED",
    );
  });

  it.each([
    ["a string body", { response: { data: "<html>nope</html>" } }],
    ["no response at all", {}],
    ["errors that is not an array", { response: { data: { error: { errors: { reason: "x" } } } } }],
    ["a numeric reason", { response: { data: { error: { errors: [{ reason: 7 }] } } } }],
    ["a null error member", { response: { data: { error: null } } }],
  ])("falls back to PERMISSION_DENIED for %s", (_label, extra) => {
    expect(codeOf(Object.assign(new Error("denied"), { code: 403 }, extra))).toBe(
      "PERMISSION_DENIED",
    );
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

// --- Retry (decision 0031 §5) -----------------------------------------------

/**
 * Which failures are Drive asking for a pause, and which are Drive refusing.
 * `cp -r` stops at the first of the second kind (0031 §3), so a misclassified
 * rate limit ends a run that had only to wait — and a misclassified refusal is
 * four pointless round trips before the same error.
 *
 * The status alone does not answer it. Drive's documented rate limits are a
 * **403** with `rateLimitExceeded` or `userRateLimitExceeded` as well as a 429,
 * and a 403 is otherwise the one status that certainly will not fix itself.
 */
describe("which Drive failures are worth waiting out", () => {
  const withReason = (status: number, message: string, reason?: string) =>
    Object.assign(new Error(message), {
      code: status,
      response: { data: { error: { errors: reason === undefined ? [] : [{ reason }] } } },
    });

  const transientOf = (error: unknown): boolean | undefined => {
    try {
      mapDriveError(error);
    } catch (e) {
      if (e instanceof AppError) return e.transient;
    }
    return undefined;
  };

  it.each([429, 500, 502, 503, 504])("waits out HTTP %i", (status) => {
    expect(transientOf(Object.assign(new Error("busy"), { code: status }))).toBe(true);
  });

  it.each(["rateLimitExceeded", "userRateLimitExceeded", "sharingRateLimitExceeded"])(
    "waits out a 403 whose reason is %s",
    (reason) => {
      expect(transientOf(withReason(403, "Rate Limit Exceeded", reason))).toBe(true);
    },
  );

  it.each([
    ["a file permission 403", withReason(403, "No permission", "insufficientFilePermissions")],
    ["a scope 403", withReason(403, "Insufficient Permission", "insufficientPermissions")],
    ["a 403 with no reason at all", Object.assign(new Error("denied"), { code: 403 })],
    // A pause of seconds does not clear a quota measured in days.
    ["a daily quota 403", withReason(403, "Daily Limit Exceeded", "dailyLimitExceeded")],
    ["a 404", Object.assign(new Error("gone"), { code: 404 })],
    ["a 400", Object.assign(new Error("bad"), { code: 400 })],
    ["a 401", Object.assign(new Error("expired"), { code: 401 })],
  ])("refuses to wait out %s", (_label, error) => {
    expect(transientOf(error)).toBe(false);
  });

  /**
   * The failure a long walk is likeliest to meet, and the one the numeric-status
   * branch never saw: gaxios reports a dropped socket as an `Error` whose `code`
   * is a **string**. Nothing was refused and nothing was answered, which is the
   * situation a 429 describes, so it is waited out the same way.
   */
  it.each(["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN"])(
    "waits out %s, where the connection failed and Drive never answered",
    (code) => {
      expect(transientOf(Object.assign(new Error("socket hang up"), { code }))).toBe(true);
    },
  );

  it("reports a dropped connection as API_ERROR, with its message intact", () => {
    const dropped = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(() => mapDriveError(dropped)).toThrow(
      expect.objectContaining({ code: "API_ERROR", message: "socket hang up" }),
    );
  });

  it.each([
    // A host that does not resolve is a wrong address or no network at all, and
    // four more attempts reach the same answer later.
    ["ENOTFOUND", Object.assign(new Error("getaddrinfo failed"), { code: "ENOTFOUND" })],
    ["a refused connection", Object.assign(new Error("refused"), { code: "ECONNREFUSED" })],
  ])("passes %s through untouched, so nothing waits for it", (_label, error) => {
    let caught: unknown;
    try {
      mapDriveError(error);
    } catch (e) {
      caught = e;
    }
    // The same object, not an AppError wearing its message: only the codes this
    // module claims to understand are translated.
    expect(caught).toBe(error);
    expect(transientOf(error)).not.toBe(true);
  });

  it("does not dress a bug in this program up as a Drive failure", () => {
    // No `code` at all: it never reached Drive, and calling it an API error
    // would send whoever reads it looking in the wrong place.
    expect(() => mapDriveError(new TypeError("x is not a function"))).toThrow(TypeError);
  });

  it("leaves every error an AppError already, transient or not", () => {
    // Nothing else in the CLI passes `transient`, so the flag every existing
    // throw site produces has to be the one that stops a retry loop.
    expect(new AppError("NOT_FOUND", "x").transient).toBe(false);
  });
});

describe("withRetry", () => {
  /** Records what it was asked to wait, and waits for none of it. */
  function fakeSleep() {
    const waited: number[] = [];
    return { waited, sleep: async (ms: number) => void waited.push(ms) };
  }

  const rateLimited = () => Object.assign(new Error("Rate Limit Exceeded"), { code: 429 });

  it("returns the eventual success and reports no failure", async () => {
    let attempts = 0;
    const { waited, sleep } = fakeSleep();
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) mapDriveError(rateLimited());
        return "done";
      },
      { baseDelayMs: 10, sleep },
    );
    expect(result).toBe("done");
    expect(attempts).toBe(3);
    // Exponential, so a busy account is not asked the same question at the same
    // rate it just refused.
    expect(waited).toEqual([10, 20]);
  });

  it("gives up after a bounded number of attempts, with the last failure", async () => {
    let attempts = 0;
    const { sleep } = fakeSleep();
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          mapDriveError(rateLimited());
        },
        { attempts: 4, baseDelayMs: 1, sleep },
      ),
    ).rejects.toMatchObject({ code: "API_ERROR" });
    expect(attempts).toBe(4);
  });

  it("does not retry a refusal", async () => {
    let attempts = 0;
    const { waited, sleep } = fakeSleep();
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          mapDriveError(Object.assign(new Error("denied"), { code: 403 }));
        },
        { baseDelayMs: 1, sleep },
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(attempts).toBe(1);
    expect(waited).toEqual([]);
  });

  it("does not retry something that never reached Drive", async () => {
    let attempts = 0;
    const { sleep } = fakeSleep();
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new TypeError("bug in the caller");
        },
        { baseDelayMs: 1, sleep },
      ),
    ).rejects.toThrow(TypeError);
    expect(attempts).toBe(1);
  });
});
