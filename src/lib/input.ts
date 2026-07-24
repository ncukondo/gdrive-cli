import { readFileSync } from "node:fs";
import { AppError } from "../types/index.ts";
import type { FsAdapter } from "./fs.ts";

export type StdinReader = () => Promise<string> | string;

/** The production {@link StdinReader}: reads all of fd 0. */
export const readProcessStdin: StdinReader = () => readFileSync(0, "utf8");

export interface ReadInputDeps {
  /** Only `existsSync`/`readFileSync` are used. */
  fs: Pick<FsAdapter, "existsSync" | "readFileSync">;
  /** Reads all of stdin; injected so `-` is testable. */
  readStdin: StdinReader;
}

/**
 * Resolves a content argument per decision 0007:
 * - `-`      → read all of stdin
 * - `@path`  → read the file at `path`
 * - anything else → the literal string
 *
 * File/stdin failures surface as {@link AppError} with code `IO_ERROR`.
 */
export async function readInput(arg: string, deps: ReadInputDeps): Promise<string> {
  if (arg === "-") {
    try {
      return await deps.readStdin();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError("IO_ERROR", `Failed to read stdin: ${message}`);
    }
  }

  if (arg.startsWith("@")) {
    const path = arg.slice(1);
    if (!deps.fs.existsSync(path)) {
      throw new AppError("IO_ERROR", `File not found: ${path}`);
    }
    try {
      return deps.fs.readFileSync(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError("IO_ERROR", `Failed to read file ${path}: ${message}`);
    }
  }

  return arg;
}
