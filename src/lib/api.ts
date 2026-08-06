import { z } from "zod";
import {
  AppError,
  type DriveFile,
  type DrivePermission,
  type FileType,
  type GranteeType,
  type SharedDrive,
  type ShareRole,
} from "../types/index.ts";

export const MAX_PAGES = 100;

/**
 * Fields requested for every file metadata response. `shortcutDetails` rides
 * along on every read (decision 0025 §2): without it a shortcut is
 * indistinguishable from a plain file, and the target id never arrives.
 */
export const FILE_FIELDS =
  "id,name,mimeType,size,parents,trashed,webViewLink,createdTime,modifiedTime,owners(emailAddress),shortcutDetails(targetId,targetMimeType)";
const LIST_FIELDS = `nextPageToken,files(${FILE_FIELDS})`;

// --- Raw googleapis shapes (only the fields we read) -----------------------

/**
 * The subset of Drive's file resource we read. Doubles as the schema for
 * `files.get`, whose payload arrives as `unknown` (decision 0015); list
 * responses are already typed by the port.
 */
export const DriveFileRawSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  mimeType: z.string().nullish(),
  size: z.string().nullish(),
  parents: z.array(z.string()).nullish(),
  trashed: z.boolean().nullish(),
  webViewLink: z.string().nullish(),
  createdTime: z.string().nullish(),
  modifiedTime: z.string().nullish(),
  owners: z.array(z.object({ emailAddress: z.string().nullish() })).nullish(),
  shortcutDetails: z
    .object({
      targetId: z.string().nullish(),
      targetMimeType: z.string().nullish(),
    })
    .nullish(),
});

export type DriveFileRaw = z.infer<typeof DriveFileRawSchema>;

export interface ListParams {
  q?: string;
  pageSize?: number;
  pageToken?: string;
  orderBy?: string;
  fields?: string;
  spaces?: string;
  corpora?: string;
  driveId?: string;
  includeItemsFromAllDrives?: boolean;
  supportsAllDrives?: boolean;
}

export interface SharedDriveListParams {
  pageSize?: number;
  pageToken?: string;
  fields?: string;
}

/** The subset of Drive's shared-drive resource we read. */
export interface SharedDriveRaw {
  id?: string | null;
  name?: string | null;
}

export interface FileCreateBody {
  name?: string;
  mimeType?: string;
  parents?: string[];
  /** What a shortcut points at; only the shortcut MIME accepts it (decision 0026 §6). */
  shortcutDetails?: { targetId: string };
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
 * Minimal abstraction over `google.drive({version:"v3"})` for testability
 * (decision 0012). Unit tests pass a hand-written fake exposing only these.
 *
 * `supportsAllDrives` appears on every method Drive accepts it on — it declares
 * that this client understands shared-drive semantics, without which any
 * shared-drive file ID answers `NOT_FOUND` (decision 0016). `files.export` is
 * the one exception: the API defines no such parameter for it. Every caller
 * sends it, including the `files.list` in `resolve-path.ts`.
 */
export interface DriveClient {
  files: {
    list: (params: ListParams) => Promise<{
      data: { files?: DriveFileRaw[]; nextPageToken?: string | null };
    }>;
    get: (
      params: { fileId: string; fields?: string; alt?: string; supportsAllDrives?: boolean },
      options?: { responseType?: "arraybuffer" },
    ) => Promise<{ data: unknown }>;
    create: (params: {
      requestBody: FileCreateBody;
      media?: { mimeType?: string; body: unknown };
      fields?: string;
      supportsAllDrives?: boolean;
    }) => Promise<{ data: DriveFileRaw }>;
    copy: (params: {
      fileId: string;
      requestBody: FileCreateBody;
      fields?: string;
      supportsAllDrives?: boolean;
    }) => Promise<{ data: DriveFileRaw }>;
    update: (params: {
      fileId: string;
      addParents?: string;
      removeParents?: string;
      requestBody?: { trashed?: boolean; name?: string };
      fields?: string;
      supportsAllDrives?: boolean;
    }) => Promise<{ data: DriveFileRaw }>;
    delete: (params: { fileId: string; supportsAllDrives?: boolean }) => Promise<unknown>;
    export: (
      params: { fileId: string; mimeType: string },
      options?: { responseType?: "arraybuffer" },
    ) => Promise<{ data: unknown }>;
  };
  drives: {
    list: (params: SharedDriveListParams) => Promise<{
      data: { drives?: SharedDriveRaw[]; nextPageToken?: string | null };
    }>;
    get: (params: { driveId: string; fields?: string }) => Promise<{ data: SharedDriveRaw }>;
  };
  permissions: {
    list: (params: {
      fileId: string;
      fields?: string;
      pageSize?: number;
      pageToken?: string;
      supportsAllDrives?: boolean;
    }) => Promise<{
      data: { permissions?: PermissionRaw[]; nextPageToken?: string | null };
    }>;
    create: (params: {
      fileId: string;
      requestBody: PermissionBody;
      sendNotificationEmail?: boolean;
      emailMessage?: string;
      fields?: string;
      supportsAllDrives?: boolean;
    }) => Promise<{ data: PermissionRaw }>;
    update: (params: {
      fileId: string;
      permissionId: string;
      requestBody: PermissionBody;
      fields?: string;
      supportsAllDrives?: boolean;
    }) => Promise<{ data: PermissionRaw }>;
    delete: (params: {
      fileId: string;
      permissionId: string;
      supportsAllDrives?: boolean;
    }) => Promise<unknown>;
  };
}

// --- Error mapping ----------------------------------------------------------

function isGoogleApiError(error: unknown): error is Error & { code: number } {
  return error instanceof Error && "code" in error && typeof error.code === "number";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : undefined;
}

function reasonsIn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const reason = record(entry)?.reason;
    return typeof reason === "string" ? [reason] : [];
  });
}

/**
 * The `reason` strings from a googleapis error body. Google writes them in two
 * places and the same 403 can carry both: the classic `error.errors[]`, and
 * `error.details[]` as a `google.rpc.ErrorInfo` — which is where a scope
 * failure's `ACCESS_TOKEN_SCOPE_INSUFFICIENT` actually lives. The body is
 * untyped JSON, so every hop is narrowed and a reshaped payload simply yields
 * nothing (decision 0015).
 */
function errorReasons(error: unknown): string[] {
  const body = record(record(record(record(error)?.response)?.data)?.error);
  return [...reasonsIn(body?.errors), ...reasonsIn(body?.details)];
}

/**
 * Reasons Google gives for a 403 that a fresh consent really would fix. Exact
 * matches: Drive spells a *file* permission failure `insufficientFilePermissions`,
 * and reading that as a scope failure is the bug this guards (decision 0017).
 */
const SCOPE_REASONS = ["ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficientPermissions"];

function isScopeFailure(error: Error): boolean {
  if (errorReasons(error).some((reason) => SCOPE_REASONS.includes(reason))) return true;
  return error.message.toLowerCase().includes("insufficient authentication scopes");
}

/** Translates a googleapis error into an {@link AppError}; re-throws anything else. */
export function mapDriveError(error: unknown): never {
  if (isGoogleApiError(error)) {
    if (error.code === 401) throw new AppError("AUTH_EXPIRED", error.message);
    if (error.code === 403) {
      // Signed in but not allowed is not an auth problem: exit 1, not 2 —
      // unless the token itself lacks the scope (decision 0017).
      const code = isScopeFailure(error) ? "AUTH_REQUIRED" : "PERMISSION_DENIED";
      throw new AppError(code, error.message);
    }
    if (error.code === 404) throw new AppError("NOT_FOUND", error.message);
    throw new AppError("API_ERROR", error.message);
  }
  if (error instanceof AppError) throw error;
  throw error;
}

// --- Normalization ----------------------------------------------------------

/**
 * A shared drive's root id: `0A` + 17 characters, 19 in all. Lives here because
 * both `getFile` (decision 0020) and `looksLikeId` in `resolve-path.ts`
 * (decision 0016 §3) recognize this exact shape.
 */
export const SHARED_DRIVE_ROOT_ID = /^0A[A-Za-z0-9_-]{17}$/;

const FOLDER_MIME = "application/vnd.google-apps.folder";
const DOC_MIME = "application/vnd.google-apps.document";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const SLIDES_MIME = "application/vnd.google-apps.presentation";

/** A pointer to another file, not a file of its own (decision 0025). */
export const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

/** What `forms read` and `forms responses` take, hence a label (decision 0034 §1). */
export const FORM_MIME = "application/vnd.google-apps.form";

const MIME_TYPE_MAP: Record<string, FileType> = {
  [FOLDER_MIME]: "folder",
  [DOC_MIME]: "doc",
  [SHEET_MIME]: "sheet",
  [SLIDES_MIME]: "slides",
  [FORM_MIME]: "form",
  [SHORTCUT_MIME]: "shortcut",
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
  // The target runs through the same map as `type`, so the two labels can never
  // disagree about what a MIME type is called (decision 0025 §2).
  const target = mimeType === SHORTCUT_MIME ? raw.shortcutDetails : undefined;
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
    target_id: target?.targetId ?? null,
    target_type: target ? mimeToType(target.targetMimeType ?? "") : null,
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

/**
 * What each `--type` value filters on, `file` excepted. Exhaustive over the
 * vocabulary by its type, so a new label cannot be added without saying what it
 * matches — the chain of `if`s this replaced let one fall through to the `file`
 * residue and filter as "not a folder" instead.
 */
const TYPE_FILTER_MIME: Record<Exclude<FileType, "file">, string> = {
  folder: FOLDER_MIME,
  doc: DOC_MIME,
  sheet: SHEET_MIME,
  slides: SLIDES_MIME,
  form: FORM_MIME,
  shortcut: SHORTCUT_MIME,
};

/** Builds the `mimeType` clause for a `--type` filter, or null for no filter. */
export function typeFilterClause(type?: FileType): string | null {
  if (!type) return null;
  // "file": anything that is not a folder — shortcuts included (decision 0025 §7)
  if (type === "file") return `mimeType != '${FOLDER_MIME}'`;
  return `mimeType = '${TYPE_FILTER_MIME[type]}'`;
}

// --- Shared drives (decision 0016) ------------------------------------------

/**
 * How wide a listing reaches. Absent means Drive's default corpus — the user's
 * own files — which is deliberately *not* widened without an explicit flag
 * (decision 0016).
 */
export type DriveScope = { kind: "all" } | { kind: "drive"; driveId: string };

/** The `--all-drives` / `--drive <name>` pair, before resolution. */
export interface DriveScopeArgs {
  allDrives?: boolean;
  drive?: string;
}

/** Applies an explicit {@link DriveScope} to `files.list` parameters. */
function applyScope(params: ListParams, scope?: DriveScope): void {
  if (scope === undefined) return;
  params.includeItemsFromAllDrives = true;
  if (scope.kind === "all") {
    params.corpora = "allDrives";
    return;
  }
  params.corpora = "drive";
  params.driveId = scope.driveId;
}

/** Lists every shared drive the account can see, following pages. */
export async function listSharedDrives(client: DriveClient): Promise<SharedDrive[]> {
  const drives: SharedDrive[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  try {
    do {
      const params: SharedDriveListParams = {
        pageSize: 100,
        fields: "nextPageToken,drives(id,name)",
      };
      if (pageToken !== undefined) params.pageToken = pageToken;
      const res = await client.drives.list(params);
      for (const raw of res.data.drives ?? []) {
        // An id-less entry cannot be addressed, and passing "" as a driveId
        // would quietly widen the very scope the caller asked to narrow.
        if (raw.id) drives.push({ id: raw.id, name: raw.name ?? "" });
      }
      pageToken = res.data.nextPageToken ?? undefined;
      pages += 1;
    } while (pageToken !== undefined && pages < MAX_PAGES);
  } catch (error) {
    mapDriveError(error);
  }
  return drives;
}

/** `No such shared drive` plus whatever the account can actually name. */
function unknownDriveError(name: string, available: SharedDrive[]): AppError {
  if (available.length === 0) {
    return new AppError(
      "NOT_FOUND",
      `No such shared drive: "${name}". This account has no shared drives.`,
    );
  }
  const names = available.map((d) => d.name).join(", ");
  return new AppError(
    "NOT_FOUND",
    `No such shared drive: "${name}". Available: ${names}. See \`gdrive drives\`.`,
  );
}

/**
 * Resolves a shared drive *name* to the drive itself. Exact and case-sensitive;
 * the error rules mirror path resolution (decision 0008): no match is
 * `NOT_FOUND`, several matches are `INVALID_ARGS` listing the candidate ids.
 *
 * Shared by `--drive` and the `drive:` path prefix (decision 0019 §2) so the
 * two spellings cannot drift apart.
 */
export async function resolveDriveByName(
  client: DriveClient,
  wanted: string,
): Promise<SharedDrive> {
  const available = await listSharedDrives(client);
  const [match, ...rest] = available.filter((d) => d.name === wanted);
  if (match === undefined) throw unknownDriveError(wanted, available);
  if (rest.length > 0) {
    const ids = [match, ...rest].map((d) => d.id).join(", ");
    throw new AppError("INVALID_ARGS", `Ambiguous shared drive name "${wanted}"; matches: ${ids}.`);
  }
  return match;
}

/** Turns the scope flags into a {@link DriveScope}, resolving a name to its id. */
export async function resolveDriveScope(
  client: DriveClient,
  args: DriveScopeArgs,
): Promise<DriveScope | undefined> {
  if (args.allDrives === true && args.drive !== undefined) {
    throw new AppError("INVALID_ARGS", "Use only one of --all-drives or --drive.");
  }
  if (args.allDrives === true) return { kind: "all" };
  if (args.drive === undefined) return undefined;

  const drive = await resolveDriveByName(client, args.drive);
  return { kind: "drive", driveId: drive.id };
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
      const params: ListParams = {
        ...baseParams,
        fields: LIST_FIELDS,
        spaces: "drive",
        supportsAllDrives: true,
      };
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
  scope?: DriveScope;
}

/**
 * Lists the direct children of a folder (decision 0008).
 *
 * `includeItemsFromAllDrives` is unconditional here, unlike in
 * {@link searchFiles}: the query always pins a single parent, so the corpus is
 * already closed and nothing extra can appear. Without it a shared-drive folder
 * id lists as empty with exit 0 — a wrong answer rather than an error
 * (decision 0016 §2).
 */
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
  const params: ListParams = {
    q: clauses.join(" and "),
    pageSize: 100,
    includeItemsFromAllDrives: true,
  };
  const orderBy = orderByClause(options.order);
  if (orderBy) params.orderBy = orderBy;
  applyScope(params, options.scope);
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
  applyScope(params, options.scope);
  return collectPages(client, params, options.limit);
}

/** The literal `files.get` gives every shared drive root instead of its name. */
const GENERIC_DRIVE_NAME = "Drive";

/**
 * `files.get` on a shared drive's root returns a generic folder resource named
 * `Drive`, identically for every drive (decision 0020). Both the name and the
 * root-id shape have to match: the name alone would fire on a file someone
 * called "Drive", the shape alone on a response Google may one day get right.
 *
 * A failed lookup keeps the generic name — the label is a nicety, and losing a
 * good `info` over it would be the worse trade.
 */
async function driveRootName(client: DriveClient, file: DriveFile): Promise<string> {
  if (file.name !== GENERIC_DRIVE_NAME || !SHARED_DRIVE_ROOT_ID.test(file.id)) return file.name;
  try {
    const res = await client.drives.get({ driveId: file.id, fields: "id,name" });
    return res.data.name ?? file.name;
  } catch {
    return file.name;
  }
}

/** Fetches and normalizes a single file's metadata. */
export async function getFile(client: DriveClient, fileId: string): Promise<DriveFile> {
  let file: DriveFile;
  try {
    const res = await client.files.get({ fileId, fields: FILE_FIELDS, supportsAllDrives: true });
    const parsed = DriveFileRawSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new AppError("API_ERROR", `Unexpected response from Drive for ${fileId}.`);
    }
    file = normalizeFile(parsed.data);
  } catch (error) {
    mapDriveError(error);
  }
  return { ...file, name: await driveRootName(client, file) };
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
    const res = await client.files.create({
      requestBody,
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
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
    const res = await client.files.copy({
      fileId,
      requestBody,
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
    return normalizeFile(res.data);
  } catch (error) {
    mapDriveError(error);
  }
}

/**
 * Creates a shortcut in `parentId` pointing at `targetId` (decision 0026).
 *
 * The name is required rather than optional: Drive's own default for an unnamed
 * file is `Untitled`, so the caller decides what the link is called — the
 * target's name unless `--name` said otherwise (§3). Which placements are legal
 * is Drive's to say, and the refusal travels through {@link mapDriveError} like
 * any other (§4).
 */
export async function createShortcut(
  client: DriveClient,
  targetId: string,
  parentId: string,
  name: string,
): Promise<DriveFile> {
  const requestBody: FileCreateBody = {
    name,
    mimeType: SHORTCUT_MIME,
    parents: [parentId],
    shortcutDetails: { targetId },
  };
  try {
    const res = await client.files.create({
      requestBody,
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
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
      supportsAllDrives: boolean;
    } = { fileId, addParents: newParentId, fields: FILE_FIELDS, supportsAllDrives: true };
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
      supportsAllDrives: true,
    });
    return normalizeFile(res.data);
  } catch (error) {
    mapDriveError(error);
  }
}

/** Permanently deletes a file. */
export async function deleteFile(client: DriveClient, fileId: string): Promise<void> {
  try {
    await client.files.delete({ fileId, supportsAllDrives: true });
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
      supportsAllDrives: true,
    });
    return normalizeFile(res.data);
  } catch (error) {
    mapDriveError(error);
  }
}

/** Downloads raw binary content (alt=media). Returns the client's data payload. */
export async function downloadMedia(client: DriveClient, fileId: string): Promise<unknown> {
  try {
    const res = await client.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
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
      const params: {
        fileId: string;
        fields: string;
        pageSize: number;
        pageToken?: string;
        supportsAllDrives: boolean;
      } = {
        fileId,
        fields: PERMISSION_LIST_FIELDS,
        pageSize: 100,
        supportsAllDrives: true,
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
    supportsAllDrives: true,
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
      supportsAllDrives: true,
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
    await client.permissions.delete({ fileId, permissionId, supportsAllDrives: true });
  } catch (error) {
    mapDriveError(error);
  }
}
