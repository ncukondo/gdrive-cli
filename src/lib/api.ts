import {
  AppError,
  type DriveFile,
  type DrivePermission,
  type FileType,
  type GranteeType,
  type ShareRole,
} from "../types/index.ts";

export const MAX_PAGES = 100;

/** Fields requested for every file metadata response. */
export const FILE_FIELDS =
  "id,name,mimeType,size,parents,trashed,webViewLink,createdTime,modifiedTime,owners(emailAddress)";
const LIST_FIELDS = `nextPageToken,files(${FILE_FIELDS})`;

// --- Raw googleapis shapes (only the fields we read) -----------------------

export interface DriveFileRaw {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: string | null;
  parents?: string[] | null;
  trashed?: boolean | null;
  webViewLink?: string | null;
  createdTime?: string | null;
  modifiedTime?: string | null;
  owners?: { emailAddress?: string | null }[] | null;
}

export interface ListParams {
  q?: string;
  pageSize?: number;
  pageToken?: string;
  orderBy?: string;
  fields?: string;
  spaces?: string;
}

export interface FileCreateBody {
  name?: string;
  mimeType?: string;
  parents?: string[];
}

export interface PermissionRaw {
  id?: string | null;
  type?: string | null;
  role?: string | null;
  emailAddress?: string | null;
  displayName?: string | null;
  domain?: string | null;
  allowFileDiscovery?: boolean | null;
  deleted?: boolean | null;
}

export interface PermissionBody {
  type?: GranteeType;
  role?: string;
  emailAddress?: string;
  domain?: string;
  allowFileDiscovery?: boolean;
}

/**
 * Minimal abstraction over `google.drive({version:"v3"}).files` for testability
 * (decision 0012). Unit tests pass a hand-written fake exposing only these.
 */
export interface DriveClient {
  files: {
    list: (params: ListParams) => Promise<{
      data: { files?: DriveFileRaw[]; nextPageToken?: string | null };
    }>;
    get: (
      params: { fileId: string; fields?: string; alt?: string },
      options?: { responseType?: string },
    ) => Promise<{ data: unknown }>;
    create: (params: {
      requestBody: FileCreateBody;
      media?: { mimeType?: string; body: unknown };
      fields?: string;
    }) => Promise<{ data: DriveFileRaw }>;
    copy: (params: {
      fileId: string;
      requestBody: FileCreateBody;
      fields?: string;
    }) => Promise<{ data: DriveFileRaw }>;
    update: (params: {
      fileId: string;
      addParents?: string;
      removeParents?: string;
      requestBody?: { trashed?: boolean; name?: string };
      fields?: string;
    }) => Promise<{ data: DriveFileRaw }>;
    delete: (params: { fileId: string }) => Promise<unknown>;
    export: (
      params: { fileId: string; mimeType: string },
      options?: { responseType?: string },
    ) => Promise<{ data: unknown }>;
  };
  permissions: {
    list: (params: {
      fileId: string;
      fields?: string;
      pageSize?: number;
      pageToken?: string;
    }) => Promise<{
      data: { permissions?: PermissionRaw[]; nextPageToken?: string | null };
    }>;
    create: (params: {
      fileId: string;
      requestBody: PermissionBody;
      sendNotificationEmail?: boolean;
      emailMessage?: string;
      fields?: string;
    }) => Promise<{ data: PermissionRaw }>;
    update: (params: {
      fileId: string;
      permissionId: string;
      requestBody: PermissionBody;
      fields?: string;
    }) => Promise<{ data: PermissionRaw }>;
    delete: (params: { fileId: string; permissionId: string }) => Promise<unknown>;
  };
}

// --- Error mapping ----------------------------------------------------------

function isGoogleApiError(error: unknown): error is Error & { code: number } {
  return error instanceof Error && "code" in error && typeof error.code === "number";
}

/** Translates a googleapis error into an {@link AppError}; re-throws anything else. */
export function mapDriveError(error: unknown): never {
  if (isGoogleApiError(error)) {
    if (error.code === 401) throw new AppError("AUTH_EXPIRED", error.message);
    if (error.code === 403) throw new AppError("AUTH_REQUIRED", error.message);
    if (error.code === 404) throw new AppError("NOT_FOUND", error.message);
    throw new AppError("API_ERROR", error.message);
  }
  if (error instanceof AppError) throw error;
  throw error;
}

// --- Normalization ----------------------------------------------------------

const FOLDER_MIME = "application/vnd.google-apps.folder";
const MIME_TYPE_MAP: Record<string, FileType> = {
  "application/vnd.google-apps.folder": "folder",
  "application/vnd.google-apps.document": "doc",
  "application/vnd.google-apps.spreadsheet": "sheet",
  "application/vnd.google-apps.presentation": "slides",
};

export function mimeToType(mimeType: string): FileType {
  return MIME_TYPE_MAP[mimeType] ?? "file";
}

/** Normalizes a raw Drive file into a {@link DriveFile} (decision 0008). */
export function normalizeFile(raw: DriveFileRaw): DriveFile {
  const mimeType = raw.mimeType ?? "application/octet-stream";
  const isGoogleNative = mimeType.startsWith("application/vnd.google-apps");
  const size =
    !isGoogleNative && typeof raw.size === "string" ? Number.parseInt(raw.size, 10) : null;
  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    mime_type: mimeType,
    type: mimeToType(mimeType),
    size: size !== null && Number.isFinite(size) ? size : null,
    parents: raw.parents ?? [],
    trashed: raw.trashed ?? false,
    web_view_link: raw.webViewLink ?? null,
    created: raw.createdTime ?? null,
    modified: raw.modifiedTime ?? null,
    owners: (raw.owners ?? []).map((o) => o.emailAddress ?? "").filter((e) => e !== ""),
  };
}

// --- Query helpers ----------------------------------------------------------

/** Escapes a value for embedding in a Drive `q` string literal. */
export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export type OrderKey = "name" | "modified" | "created";

const ORDER_MAP: Record<OrderKey, string> = {
  name: "name",
  modified: "modifiedTime desc",
  created: "createdTime desc",
};

function orderByClause(order?: OrderKey): string | undefined {
  return order ? ORDER_MAP[order] : undefined;
}

/** Builds the `mimeType` clause for a `--type` filter, or null for no filter. */
export function typeFilterClause(type?: FileType): string | null {
  if (!type) return null;
  if (type === "folder") return `mimeType = '${FOLDER_MIME}'`;
  if (type === "doc") return `mimeType = 'application/vnd.google-apps.document'`;
  if (type === "sheet") return `mimeType = 'application/vnd.google-apps.spreadsheet'`;
  if (type === "slides") return `mimeType = 'application/vnd.google-apps.presentation'`;
  // "file": anything that is not a folder
  return `mimeType != '${FOLDER_MIME}'`;
}

// --- Pagination -------------------------------------------------------------

async function collectPages(
  client: DriveClient,
  baseParams: ListParams,
  limit?: number,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  try {
    do {
      const params: ListParams = { ...baseParams, fields: LIST_FIELDS, spaces: "drive" };
      if (pageToken !== undefined) params.pageToken = pageToken;
      const res = await client.files.list(params);
      for (const raw of res.data.files ?? []) {
        files.push(normalizeFile(raw));
        if (limit !== undefined && files.length >= limit) return files;
      }
      pageToken = res.data.nextPageToken ?? undefined;
      pages += 1;
    } while (pageToken !== undefined && pages < MAX_PAGES);
  } catch (error) {
    mapDriveError(error);
  }
  return files;
}

// --- Wrapper operations -----------------------------------------------------

export interface ListOptions {
  type?: FileType;
  trashed?: boolean;
  limit?: number;
  order?: OrderKey;
}

/** Lists the direct children of a folder (decision 0008). */
export async function listChildren(
  client: DriveClient,
  folderId: string,
  options: ListOptions = {},
): Promise<DriveFile[]> {
  const clauses = [
    `'${escapeQueryValue(folderId)}' in parents`,
    `trashed = ${options.trashed ? "true" : "false"}`,
  ];
  const typeClause = typeFilterClause(options.type);
  if (typeClause) clauses.push(typeClause);
  const params: ListParams = { q: clauses.join(" and "), pageSize: 100 };
  const orderBy = orderByClause(options.order);
  if (orderBy) params.orderBy = orderBy;
  return collectPages(client, params, options.limit);
}

/** Searches by name or full text (decision 0008). */
export async function searchFiles(
  client: DriveClient,
  query: string,
  options: ListOptions = {},
): Promise<DriveFile[]> {
  const escaped = escapeQueryValue(query);
  const clauses = [
    `(name contains '${escaped}' or fullText contains '${escaped}')`,
    `trashed = ${options.trashed ? "true" : "false"}`,
  ];
  const typeClause = typeFilterClause(options.type);
  if (typeClause) clauses.push(typeClause);
  const params: ListParams = { q: clauses.join(" and "), pageSize: 100 };
  const orderBy = orderByClause(options.order);
  if (orderBy) params.orderBy = orderBy;
  return collectPages(client, params, options.limit);
}

/** Fetches and normalizes a single file's metadata. */
export async function getFile(client: DriveClient, fileId: string): Promise<DriveFile> {
  try {
    const res = await client.files.get({ fileId, fields: FILE_FIELDS });
    return normalizeFile(res.data as DriveFileRaw);
  } catch (error) {
    mapDriveError(error);
  }
}

/** Creates a folder, optionally under `parentId`. */
export async function createFolder(
  client: DriveClient,
  name: string,
  parentId?: string,
): Promise<DriveFile> {
  const requestBody: FileCreateBody = { name, mimeType: FOLDER_MIME };
  if (parentId) requestBody.parents = [parentId];
  try {
    const res = await client.files.create({ requestBody, fields: FILE_FIELDS });
    return normalizeFile(res.data);
  } catch (error) {
    mapDriveError(error);
  }
}

/** Copies a file into `parentId`, optionally renaming it. */
export async function copyFile(
  client: DriveClient,
  fileId: string,
  parentId: string,
  name?: string,
): Promise<DriveFile> {
  const requestBody: FileCreateBody = { parents: [parentId] };
  if (name) requestBody.name = name;
  try {
    const res = await client.files.copy({ fileId, requestBody, fields: FILE_FIELDS });
    return normalizeFile(res.data);
  } catch (error) {
    mapDriveError(error);
  }
}

/** Moves a file to `newParentId`, detaching it from its current parents. */
export async function moveFile(
  client: DriveClient,
  fileId: string,
  newParentId: string,
): Promise<DriveFile> {
  const current = await getFile(client, fileId);
  try {
    const params: {
      fileId: string;
      addParents: string;
      removeParents?: string;
      fields: string;
    } = { fileId, addParents: newParentId, fields: FILE_FIELDS };
    if (current.parents.length > 0) params.removeParents = current.parents.join(",");
    const res = await client.files.update(params);
    return normalizeFile(res.data);
  } catch (error) {
    mapDriveError(error);
  }
}

/** Moves a file to the trash. */
export async function trashFile(client: DriveClient, fileId: string): Promise<DriveFile> {
  try {
    const res = await client.files.update({
      fileId,
      requestBody: { trashed: true },
      fields: FILE_FIELDS,
    });
    return normalizeFile(res.data);
  } catch (error) {
    mapDriveError(error);
  }
}

/** Permanently deletes a file. */
export async function deleteFile(client: DriveClient, fileId: string): Promise<void> {
  try {
    await client.files.delete({ fileId });
  } catch (error) {
    mapDriveError(error);
  }
}

export interface UploadInput {
  name: string;
  mimeType: string;
  body: unknown;
  parentId?: string;
  /** Target Google MIME type to convert to on upload (e.g. Docs/Sheets). */
  convertToMimeType?: string;
}

/** Uploads local media, optionally converting it to a Google-native type. */
export async function uploadMedia(client: DriveClient, input: UploadInput): Promise<DriveFile> {
  const requestBody: FileCreateBody = { name: input.name };
  if (input.parentId) requestBody.parents = [input.parentId];
  if (input.convertToMimeType) requestBody.mimeType = input.convertToMimeType;
  try {
    const res = await client.files.create({
      requestBody,
      media: { mimeType: input.mimeType, body: input.body },
      fields: FILE_FIELDS,
    });
    return normalizeFile(res.data);
  } catch (error) {
    mapDriveError(error);
  }
}

/** Downloads raw binary content (alt=media). Returns the client's data payload. */
export async function downloadMedia(client: DriveClient, fileId: string): Promise<unknown> {
  try {
    const res = await client.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    return res.data;
  } catch (error) {
    mapDriveError(error);
  }
}

/** Exports a Google-native file to `mimeType` (e.g. a Doc to PDF). */
export async function exportFile(
  client: DriveClient,
  fileId: string,
  mimeType: string,
): Promise<unknown> {
  try {
    const res = await client.files.export({ fileId, mimeType }, { responseType: "arraybuffer" });
    return res.data;
  } catch (error) {
    mapDriveError(error);
  }
}

// --- Permissions (decision 0011) --------------------------------------------

export const PERMISSION_FIELDS =
  "id,type,role,emailAddress,displayName,domain,allowFileDiscovery,deleted";
const PERMISSION_LIST_FIELDS = `nextPageToken,permissions(${PERMISSION_FIELDS})`;

const GRANTEE_TYPES: GranteeType[] = ["user", "group", "domain", "anyone"];

/** Normalizes a raw Drive permission into a {@link DrivePermission}. */
export function normalizePermission(raw: PermissionRaw): DrivePermission {
  const type = GRANTEE_TYPES.find((candidate) => candidate === raw.type) ?? "user";
  return {
    id: raw.id ?? "",
    type,
    role: raw.role ?? "",
    email: raw.emailAddress ?? null,
    display_name: raw.displayName ?? null,
    domain: raw.domain ?? null,
    allow_file_discovery: raw.allowFileDiscovery ?? false,
    deleted: raw.deleted ?? false,
  };
}

export interface GranteeArgs {
  to?: string;
  domain?: string;
  anyone?: boolean;
}

export interface Grantee {
  type: GranteeType;
  emailAddress?: string;
  domain?: string;
}

/** Google Groups addresses are the one grantee we can classify without a lookup. */
const GROUP_DOMAIN = "googlegroups.com";

/**
 * Resolves exactly one of `--to` / `--domain` / `--anyone` into a grantee
 * (decision 0011). `--to` maps to `user`, or `group` for a `googlegroups.com`
 * address — Drive cannot be asked to classify an arbitrary address up front.
 */
export function inferGrantee(args: GranteeArgs): Grantee {
  const given = [args.to !== undefined, args.domain !== undefined, args.anyone === true].filter(
    Boolean,
  ).length;
  if (given === 0) {
    throw new AppError(
      "INVALID_ARGS",
      "Specify a grantee: --to <email>, --domain <d>, or --anyone.",
    );
  }
  if (given > 1) {
    throw new AppError("INVALID_ARGS", "Use only one of --to, --domain, or --anyone.");
  }

  if (args.to !== undefined) {
    const at = args.to.indexOf("@");
    if (at <= 0 || at === args.to.length - 1) {
      throw new AppError("INVALID_ARGS", `--to must be an email address, got "${args.to}".`);
    }
    const domain = args.to.slice(at + 1).toLowerCase();
    return { type: domain === GROUP_DOMAIN ? "group" : "user", emailAddress: args.to };
  }
  if (args.domain !== undefined) return { type: "domain", domain: args.domain };
  return { type: "anyone" };
}

/** Lists every permission on a file, following pages (decision 0011). */
export async function listPermissions(
  client: DriveClient,
  fileId: string,
): Promise<DrivePermission[]> {
  const permissions: DrivePermission[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  try {
    do {
      const params: { fileId: string; fields: string; pageSize: number; pageToken?: string } = {
        fileId,
        fields: PERMISSION_LIST_FIELDS,
        pageSize: 100,
      };
      if (pageToken !== undefined) params.pageToken = pageToken;
      const res = await client.permissions.list(params);
      for (const raw of res.data.permissions ?? []) permissions.push(normalizePermission(raw));
      pageToken = res.data.nextPageToken ?? undefined;
      pages += 1;
    } while (pageToken !== undefined && pages < MAX_PAGES);
  } catch (error) {
    mapDriveError(error);
  }
  return permissions;
}

export interface PermissionCreateInput {
  type: GranteeType;
  role: ShareRole;
  emailAddress?: string;
  domain?: string;
  allowFileDiscovery?: boolean;
  /** Defaults to false so agent runs stay quiet (decision 0011). */
  sendNotificationEmail?: boolean;
  emailMessage?: string;
}

/** Grants access to a file. */
export async function createPermission(
  client: DriveClient,
  fileId: string,
  input: PermissionCreateInput,
): Promise<DrivePermission> {
  const requestBody: PermissionBody = { type: input.type, role: input.role };
  if (input.emailAddress !== undefined) requestBody.emailAddress = input.emailAddress;
  if (input.domain !== undefined) requestBody.domain = input.domain;
  if (input.allowFileDiscovery !== undefined)
    requestBody.allowFileDiscovery = input.allowFileDiscovery;

  const params: Parameters<DriveClient["permissions"]["create"]>[0] = {
    fileId,
    requestBody,
    sendNotificationEmail: input.sendNotificationEmail ?? false,
    fields: PERMISSION_FIELDS,
  };
  if (input.emailMessage !== undefined) params.emailMessage = input.emailMessage;

  try {
    const res = await client.permissions.create(params);
    return normalizePermission(res.data);
  } catch (error) {
    mapDriveError(error);
  }
}

/** Changes an existing permission's role (used by `share link` upgrades). */
export async function updatePermissionRole(
  client: DriveClient,
  fileId: string,
  permissionId: string,
  role: ShareRole,
): Promise<DrivePermission> {
  try {
    const res = await client.permissions.update({
      fileId,
      permissionId,
      requestBody: { role },
      fields: PERMISSION_FIELDS,
    });
    return normalizePermission(res.data);
  } catch (error) {
    mapDriveError(error);
  }
}

/** Revokes a permission. */
export async function deletePermission(
  client: DriveClient,
  fileId: string,
  permissionId: string,
): Promise<void> {
  try {
    await client.permissions.delete({ fileId, permissionId });
  } catch (error) {
    mapDriveError(error);
  }
}
