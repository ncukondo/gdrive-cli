import { existsSync, createReadStream } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { buildDriveClient } from "../lib/google-clients.ts";
import { AppError } from "../types/index.ts";
import { nodeFs } from "../lib/fs.ts";
import { loadConfig } from "../lib/config.ts";
import { getAccountClient } from "../lib/account.ts";
import {
  copyFile,
  createFolder,
  deleteFile,
  moveFile,
  trashFile,
  uploadMedia,
  type DriveClient,
} from "../lib/api.ts";
import { resolvePath } from "../lib/resolve-path.ts";
import { resolveGlobalOptions, handleError, type GlobalOptions } from "../index.ts";
import { createUploadCommand, guessMimeType, handleUpload, type LocalFile } from "./upload.ts";
import { createMkdirCommand, handleMkdir } from "./mkdir.ts";
import { createMvCommand, handleMv } from "./mv.ts";
import { createCpCommand, handleCp } from "./cp.ts";
import { createRmCommand, handleRm } from "./rm.ts";

async function buildDrive(opts: GlobalOptions): Promise<DriveClient> {
  const config = loadConfig(nodeFs, opts.config);
  const { client } = await getAccountClient(nodeFs, config, opts.account);
  return buildDriveClient(client);
}

function readLocalFile(path: string): LocalFile {
  if (!existsSync(path)) {
    throw new AppError("IO_ERROR", `Local file not found: ${path}`);
  }
  try {
    return { body: createReadStream(path), mimeType: guessMimeType(path), name: basename(path) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError("IO_ERROR", `Failed to read ${path}: ${message}`);
  }
}

const stdout = (msg: string) => process.stdout.write(msg + "\n");

export function registerDriveWrite(program: Command): void {
  const upload = createUploadCommand();
  upload.action(async (local: string) => {
    const opts = resolveGlobalOptions(program);
    const o = upload.opts<{ parent?: string; name?: string; asDoc?: boolean; asSheet?: boolean }>();
    try {
      const drive = await buildDrive(opts);
      const result = await handleUpload({
        resolvePath: (arg) => resolvePath(drive, arg),
        readLocalFile,
        uploadMedia: (input) => uploadMedia(drive, input),
        local,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.parent !== undefined ? { parent: o.parent } : {}),
        ...(o.name !== undefined ? { name: o.name } : {}),
        ...(o.asDoc ? { asDoc: true } : {}),
        ...(o.asSheet ? { asSheet: true } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  program.addCommand(upload);

  const mkdir = createMkdirCommand();
  mkdir.action(async (name: string) => {
    const opts = resolveGlobalOptions(program);
    const o = mkdir.opts<{ parent?: string }>();
    try {
      const drive = await buildDrive(opts);
      const result = await handleMkdir({
        resolvePath: (arg) => resolvePath(drive, arg),
        createFolder: (n, parentId) => createFolder(drive, n, parentId),
        name,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.parent !== undefined ? { parent: o.parent } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  program.addCommand(mkdir);

  const mv = createMvCommand();
  mv.action(async (file: string, folder: string) => {
    const opts = resolveGlobalOptions(program);
    try {
      const drive = await buildDrive(opts);
      const result = await handleMv({
        resolvePath: (arg) => resolvePath(drive, arg),
        moveFile: (id, parentId) => moveFile(drive, id, parentId),
        file,
        dest: folder,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  program.addCommand(mv);

  const cp = createCpCommand();
  cp.action(async (file: string, folder: string) => {
    const opts = resolveGlobalOptions(program);
    const o = cp.opts<{ name?: string }>();
    try {
      const drive = await buildDrive(opts);
      const result = await handleCp({
        resolvePath: (arg) => resolvePath(drive, arg),
        copyFile: (id, parentId, name) => copyFile(drive, id, parentId, name),
        file,
        dest: folder,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.name !== undefined ? { name: o.name } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  program.addCommand(cp);

  const rm = createRmCommand();
  rm.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = rm.opts<{ permanent?: boolean }>();
    try {
      const drive = await buildDrive(opts);
      const result = await handleRm({
        resolvePath: (arg) => resolvePath(drive, arg),
        trashFile: (id) => trashFile(drive, id),
        deleteFile: (id) => deleteFile(drive, id),
        file,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.permanent ? { permanent: true } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  program.addCommand(rm);
}
