export type OutputFormat = "text" | "json";

/**
 * Stable error codes (decision 0007). Thrown internally as `AppError.code`;
 * `index.ts` maps each to an exit code and renders per the active format.
 */
const ERROR_CODES = [
  "AUTH_REQUIRED",
  "AUTH_EXPIRED",
  "ACCOUNT_NOT_FOUND",
  "NOT_FOUND",
  "INVALID_ARGS",
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
 * Application error carrying a stable {@link ErrorCode}. Command handlers throw
 * this instead of calling `process.exit`; the top-level handler maps the code
 * to an exit code and output envelope.
 */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export interface CommandResult {
  exitCode: number;
}

/** Friendly file-type label derived from a Drive MIME type (decision 0008). */
export type FileType = "folder" | "doc" | "sheet" | "slides" | "file";

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
}

/** A shared drive, as `gdrive drives` reports it (decision 0016). */
export interface SharedDrive {
  id: string;
  name: string;
}

/** Grantee kinds a permission can target (decision 0011). */
export type GranteeType = "user" | "group" | "domain" | "anyone";

/** Roles this CLI grants; `owner` (transfer) is out of scope (decision 0011). */
export type ShareRole = "reader" | "commenter" | "writer";

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
}

export type Envelope<T> = SuccessResponse<T> | ErrorResponse;

const ERROR_CODE_EXIT_MAP: Record<ErrorCode, number> = {
  AUTH_REQUIRED: ExitCode.AUTH,
  AUTH_EXPIRED: ExitCode.AUTH,
  ACCOUNT_NOT_FOUND: ExitCode.AUTH,
  NOT_FOUND: ExitCode.GENERAL,
  INVALID_ARGS: ExitCode.ARGUMENT,
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
