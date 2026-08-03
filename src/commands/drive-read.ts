import { writeFileSync } from "node:fs";
import type { Command } from "commander";
import { buildDriveClient } from "../lib/google-clients.ts";
import { AppError } from "../types/index.ts";
import { nodeFs } from "../lib/fs.ts";
import { loadConfig } from "../lib/config.ts";
import { getAccountClient } from "../lib/account.ts";
import {
  downloadMedia,
  exportFile,
  getFile,
  listChildren,
  listSharedDrives,
  resolveDriveScope,
  searchFiles,
  type DriveClient,
  type DriveScopeArgs,
} from "../lib/api.ts";
import { resolvePath, resolveTarget, resolveTargetId } from "../lib/resolve-path.ts";
import { resolveGlobalOptions, handleError, type GlobalOptions } from "../index.ts";
import { createLsCommand, handleLs, parseLimit, parseOrder, parseType } from "./ls.ts";
import { createSearchCommand, handleSearch } from "./search.ts";
import { createInfoCommand, handleInfo } from "./info.ts";
import { createDownloadCommand, handleDownload, parseExportAs } from "./download.ts";
import { createDrivesCommand, handleDrives } from "./drives.ts";

async function buildDrive(opts: GlobalOptions): Promise<DriveClient> {
  const config = loadConfig(nodeFs, opts.config);
  const { client } = await getAccountClient(nodeFs, config, opts.account);
  return buildDriveClient(client);
}

/** Coerces a googleapis media payload to a Buffer for binary-safe output. */
function toBuffer(content: unknown): Buffer {
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  if (ArrayBuffer.isView(content))
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  if (typeof content === "string") return Buffer.from(content);
  return Buffer.from(String(content ?? ""));
}

const stdout = (msg: string) => process.stdout.write(msg + "\n");

/**
 * Which resolver backs each argument is decision 0025 §1's role table, and this
 * is where it is written down: `resolveTargetId` for a container ("look inside
 * this") or content ("read what is in this") argument, `resolvePath` for an
 * entry ("this file, as an entry in a folder"). Here: `ls` and `download`
 * follow; `info` does not, because it is the command that answers *what is
 * this id*.
 */
export function registerDriveRead(program: Command): void {
  const ls = createLsCommand();
  ls.action(async (folder: string | undefined) => {
    const opts = resolveGlobalOptions(program);
    const o = ls.opts<
      { type?: string; trashed?: boolean; limit?: string; order?: string } & DriveScopeArgs
    >();
    try {
      const type = parseType(o.type);
      const limit = parseLimit(o.limit);
      const order = parseOrder(o.order);
      const drive = await buildDrive(opts);
      const scope = await resolveDriveScope(drive, o);
      const result = await handleLs({
        // container
        resolvePath: (arg) => resolveTargetId(drive, arg),
        listChildren: (id, options) => listChildren(drive, id, options),
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(folder !== undefined ? { folder } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(o.trashed ? { trashed: true } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(order !== undefined ? { order } : {}),
        ...(scope !== undefined ? { scope } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  program.addCommand(ls);

  const search = createSearchCommand();
  search.action(async (query: string) => {
    const opts = resolveGlobalOptions(program);
    const o = search.opts<{ type?: string; limit?: string; order?: string } & DriveScopeArgs>();
    try {
      const type = parseType(o.type);
      const limit = parseLimit(o.limit);
      const order = parseOrder(o.order);
      const drive = await buildDrive(opts);
      const scope = await resolveDriveScope(drive, o);
      const result = await handleSearch({
        searchFiles: (q, options) => searchFiles(drive, q, options),
        query,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(type !== undefined ? { type } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(order !== undefined ? { order } : {}),
        ...(scope !== undefined ? { scope } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  program.addCommand(search);

  const drives = createDrivesCommand();
  drives.action(async () => {
    const opts = resolveGlobalOptions(program);
    try {
      const drive = await buildDrive(opts);
      const result = await handleDrives({
        listSharedDrives: () => listSharedDrives(drive),
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  program.addCommand(drives);

  const info = createInfoCommand();
  info.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    try {
      const drive = await buildDrive(opts);
      const result = await handleInfo({
        // entry
        resolvePath: (arg) => resolvePath(drive, arg),
        getFile: (id) => getFile(drive, id),
        file,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  program.addCommand(info);

  const download = createDownloadCommand();
  download.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = download.opts<{ output?: string; exportAs?: string }>();
    try {
      const drive = await buildDrive(opts);
      const exportAs = parseExportAs(o.exportAs);
      const result = await handleDownload({
        // content
        resolveTarget: (arg) => resolveTarget(drive, arg),
        getFile: (id) => getFile(drive, id),
        downloadMedia: (id) => downloadMedia(drive, id),
        exportFile: (id, mime) => exportFile(drive, id, mime),
        writeFile: (path, content) => {
          try {
            writeFileSync(path, toBuffer(content));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new AppError("IO_ERROR", `Failed to write ${path}: ${message}`);
          }
        },
        writeStdout: (content) => process.stdout.write(toBuffer(content)),
        file,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.output !== undefined ? { output: o.output } : {}),
        ...(exportAs !== undefined ? { exportAs } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  program.addCommand(download);
}
