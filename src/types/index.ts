export type OutputFormat = "text" | "json";

/**
 * Stable error codes (decision 0007). Thrown internally as `AppError.code`;
 * `index.ts` maps each to an exit code and renders per the active format.
 */
export type ErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "ACCOUNT_NOT_FOUND"
  | "NOT_FOUND"
  | "INVALID_ARGS"
  | "API_ERROR"
  | "CONFIG_ERROR"
  | "IO_ERROR";

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
