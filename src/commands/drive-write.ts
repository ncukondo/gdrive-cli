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
  createShortcut,
  deleteFile,
  getFile,
  moveFile,
  renameFile,
  trashFile,
  uploadMedia,
  type DriveClient,
} from "../lib/api.ts";
import { copyTree } from "../lib/copy-tree.ts";
import { childrenNamed, resolvePath, resolveTarget, resolveTargetId } from "../lib/resolve-path.ts";
import { resolveGlobalOptions, handleError, type GlobalOptions } from "../index.ts";
import { createUploadCommand, guessMimeType, handleUpload, type LocalFile } from "./upload.ts";
import { createMkdirCommand, handleMkdir } from "./mkdir.ts";
import { createMvCommand, handleMv } from "./mv.ts";
import { createCpCommand, handleCp } from "./cp.ts";
import { createLnCommand, handleLn } from "./ln.ts";
import { createRmCommand, handleRm } from "./rm.ts";
import { createRenameCommand, handleRename } from "./rename.ts";

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

/**
 * Decision 0025 §1's role table, wired argument by argument: `--parent` is a
 * container and follows a shortcut, and so is the destination of `mv`, `cp` and
 * `ln`, while what `mv`, `cp`, and `rm` act *on* is an entry and never does —
 * `rm link` deletes the link, not the document behind it.
 *
 * `ln`'s `<target>` is the content row (decision 0026 §2): linking a shortcut
 * links the document it points at, because Drive refuses to store a shortcut to
 * a shortcut anyway.
 */
export function registerDriveWrite(program: Command): void {
  const upload = createUploadCommand();
  upload.action(async (local: string) => {
    const opts = resolveGlobalOptions(program);
    const o = upload.opts<{ parent?: string; name?: string; asDoc?: boolean; asSheet?: boolean }>();
    try {
      const drive = await buildDrive(opts);
      const result = await handleUpload({
        // container (--parent)
        resolvePath: (arg) => resolveTargetId(drive, arg),
        readLocalFile,
        uploadMedia: (input) => uploadMedia(drive, input),
        findSiblings: (parentId, n) => childrenNamed(drive, parentId, n),
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
        // container (--parent)
        resolvePath: (arg) => resolveTargetId(drive, arg),
        createFolder: (n, parentId) => createFolder(drive, n, parentId),
        findSiblings: (parentId, n) => childrenNamed(drive, parentId, n),
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
        // entry
        resolvePath: (arg) => resolvePath(drive, arg),
        // container
        resolveFolder: (arg) => resolveTargetId(drive, arg),
        moveFile: (id, parentId) => moveFile(drive, id, parentId),
        getFile: (id) => getFile(drive, id),
        findSiblings: (parentId, n) => childrenNamed(drive, parentId, n),
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
    const o = cp.opts<{ name?: string; recursive?: boolean }>();
    try {
      const drive = await buildDrive(opts);
      const result = await handleCp({
        // entry
        resolvePath: (arg) => resolvePath(drive, arg),
        // container
        resolveFolder: (arg) => resolveTargetId(drive, arg),
        copyFile: (id, parentId, name) => copyFile(drive, id, parentId, name),
        getFile: (id) => getFile(drive, id),
        findSiblings: (parentId, n) => childrenNamed(drive, parentId, n),
        copyTree: (source, destId, name) =>
          copyTree(drive, source, destId, name === undefined ? {} : { name }),
        file,
        dest: folder,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.name !== undefined ? { name: o.name } : {}),
        ...(o.recursive === true ? { recursive: true } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      // `cp -r` is the one command here that can fail after changing something,
      // so it is the one that has a partial result to print (decision 0031 §4).
      handleError(error, opts.format, opts.quiet);
    }
  });
  program.addCommand(cp);

  const ln = createLnCommand();
  ln.action(async (target: string, folder: string) => {
    const opts = resolveGlobalOptions(program);
    const o = ln.opts<{ name?: string }>();
    try {
      const drive = await buildDrive(opts);
      const result = await handleLn({
        // content: linking a shortcut links what it points at (decision 0026 §2)
        resolveTarget: (arg) => resolveTarget(drive, arg),
        // container
        resolveFolder: (arg) => resolveTargetId(drive, arg),
        getFile: (id) => getFile(drive, id),
        createShortcut: (targetId, parentId, name) =>
          createShortcut(drive, targetId, parentId, name),
        findSiblings: (parentId, n) => childrenNamed(drive, parentId, n),
        target,
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
  program.addCommand(ln);

  const rm = createRmCommand();
  rm.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = rm.opts<{ permanent?: boolean }>();
    try {
      const drive = await buildDrive(opts);
      const result = await handleRm({
        // entry
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

  const rename = createRenameCommand();
  rename.action(async (file: string, name: string) => {
    const opts = resolveGlobalOptions(program);
    try {
      const drive = await buildDrive(opts);
      const result = await handleRename({
        // entry: renaming a link renames the link (decision 0052 §2)
        resolvePath: (arg) => resolvePath(drive, arg),
        renameFile: (id, newName) => renameFile(drive, id, newName),
        getFile: (id) => getFile(drive, id),
        findSiblings: (parentId, n) => childrenNamed(drive, parentId, n),
        file,
        name,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  program.addCommand(rename);
}
