export type OutputFormat = "text" | "json";

/**
 * Stable error codes (decision 0007). Thrown internally as `AppError.code`;
 * `index.ts` maps each to an exit code and renders per the active format.
 */
const ERROR_CODES = [
  "AUTH_REQUIRED",
  "AUTH_EXPIRED",
  "ACCOUNT_NOT_FOUND",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "INVALID_ARGS",
  /**
   * `forms write` would delete an item and `--prune` was not given
   * (decision 0028 §3). Distinct from `INVALID_ARGS` because the next action
   * differs: confirm the intent and re-run with the flag, rather than fix the
   * document.
   */
  "PRUNE_REQUIRED",
  /**
   * A listing stopped at the page cap and a command that needed all of it
   * refused to pretend otherwise (decision 0060 §4). Distinct from `API_ERROR`
   * because nothing failed at Google, and the next action differs: copy the
   * large subfolders one at a time, or narrow what was asked for.
   */
  "LISTING_INCOMPLETE",
  "API_ERROR",
  "CONFIG_ERROR",
  "IO_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ExitCode = {
  SUCCESS: 0,
  GENERAL: 1,
  AUTH: 2,
  ARGUMENT: 3,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * What a failed command has to say beyond its message (decision 0031 §4).
 *
 * `payload` becomes the error envelope's `data`, so `success: false` stops
 * implying that nothing happened: a `cp -r` that stopped part-way names the
 * folders and files it did create, and a `forms write` that refused a deletion
 * can name the items instead of only describing them in prose.
 *
 * The other two mirror `Renderable` in `lib/output.ts`, because a failure
 * that has something to report has the same three audiences a success does. Both
 * are optional: a caller with nothing extra to say in a mode says nothing, and
 * the error message alone is printed.
 */
export interface ErrorData {
  /** The JSON envelope's `data` field. */
  payload: unknown;
  /** A summary printed under the error in text mode. */
  text?: string;
  /** What `--quiet` prints under the error instead: one value per line. */
  quiet?: string;
}

/** Everything an {@link AppError} carries besides its code and message. */
export interface AppErrorOptions {
  /** What the command changed, or planned, before it failed (decision 0031 §4). */
  data?: ErrorData;
  /**
   * True when Drive asked for a pause rather than refused the request — a rate
   * limit or a server error (decision 0031 §5). Only `mapDriveError` sets it,
   * because only it sees the HTTP status, and only `withRetry` reads it.
   */
  transient?: boolean;
}

/**
 * Application error carrying a stable {@link ErrorCode}. Command handlers throw
 * this instead of calling `process.exit`; the top-level handler maps the code
 * to an exit code and output envelope.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** Present only when the failure has something to report (decision 0031 §4). */
  readonly data?: ErrorData;
  readonly transient: boolean;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    if (options.data !== undefined) this.data = options.data;
    this.transient = options.transient === true;
  }
}

export interface CommandResult {
  exitCode: number;
}

/**
 * Friendly file-type labels derived from a Drive MIME type (decision 0008).
 * A member exists because a command can act on that type, not because Drive can
 * store it (decision 0034 §1): `shortcut` joined with decision 0025, and `form`
 * once `forms read` shipped. `file` is the residue — "nothing here acts on this
 * specifically" — and stays last.
 *
 * The list is a value, not just a union, because two other things are derived
 * from it: the `--type` choices and the width of the table's type column.
 * Growing it is a minor-release break for a consumer that switches exhaustively
 * on the label (decisions 0014, 0034 §3).
 */
export const FILE_TYPES = ["folder", "doc", "sheet", "slides", "form", "shortcut", "file"] as const;

export type FileType = (typeof FILE_TYPES)[number];

/** Normalized Drive file (decision 0008). Byte size is null for Google-native files. */
export interface DriveFile {
  id: string;
  name: string;
  mime_type: string;
  type: FileType;
  size: number | null;
  parents: string[];
  trashed: boolean;
  web_view_link: string | null;
  created: string | null;
  modified: string | null;
  owners: string[];
  /**
   * What a shortcut points at, `null` on every other file (decision 0025 §2).
   * Two flat fields rather than a nested object: the pair a caller acts on is
   * *what it points at* and *what kind of thing that is*, and
   * `gdrive info <target_id>` answers everything else.
   */
  target_id: string | null;
  target_type: FileType | null;
}

/** A shared drive, as `gdrive drives` reports it (decision 0016). */
export interface SharedDrive {
  id: string;
  name: string;
}

/** Grantee kinds a permission can target (decision 0011). */
export type GranteeType = "user" | "group" | "domain" | "anyone";

/**
 * Roles this CLI grants; `owner` (transfer) is out of scope (decision 0011).
 * The last two exist only on shared drives (decision 0018).
 */
export type ShareRole = "reader" | "commenter" | "writer" | "fileOrganizer" | "organizer";

/** Normalized Drive permission (decision 0011). */
export interface DrivePermission {
  id: string;
  type: GranteeType;
  /** The API role; may be `owner` on existing permissions we only read. */
  role: string;
  email: string | null;
  display_name: string | null;
  domain: string | null;
  allow_file_discovery: boolean;
  deleted: boolean;
}

export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
  };
  /**
   * Present only when the command changed something before it failed
   * (decision 0031 §4). A consumer that ignores it reads the same two keys it
   * always did.
   */
  data?: unknown;
}

export type Envelope<T> = SuccessResponse<T> | ErrorResponse;

const ERROR_CODE_EXIT_MAP: Record<ErrorCode, number> = {
  AUTH_REQUIRED: ExitCode.AUTH,
  AUTH_EXPIRED: ExitCode.AUTH,
  ACCOUNT_NOT_FOUND: ExitCode.AUTH,
  PERMISSION_DENIED: ExitCode.GENERAL,
  NOT_FOUND: ExitCode.GENERAL,
  INVALID_ARGS: ExitCode.ARGUMENT,
  PRUNE_REQUIRED: ExitCode.ARGUMENT,
  LISTING_INCOMPLETE: ExitCode.ARGUMENT,
  API_ERROR: ExitCode.GENERAL,
  CONFIG_ERROR: ExitCode.GENERAL,
  IO_ERROR: ExitCode.GENERAL,
};

/** Maps a stable {@link ErrorCode} to its process exit code (decision 0007). */
export function errorToExit(code: ErrorCode): number {
  return ERROR_CODE_EXIT_MAP[code];
}

/** Resolves an unknown thrown value to a stable {@link ErrorCode}. */
export function errorToCode(error: unknown): ErrorCode {
  if (error instanceof Error && "code" in error) {
    const { code } = error;
    const known = ERROR_CODES.find((candidate) => candidate === code);
    if (known !== undefined) return known;
  }
  return "API_ERROR";
}
