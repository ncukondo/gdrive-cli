import type { Command } from "commander";
import { buildDriveClient } from "../../lib/google-clients.ts";
import { nodeFs } from "../../lib/fs.ts";
import { loadConfig } from "../../lib/config.ts";
import { getAccountClient } from "../../lib/account.ts";
import {
  createPermission,
  deletePermission,
  getFile,
  listPermissions,
  updatePermissionRole,
  type DriveClient,
} from "../../lib/api.ts";
import { resolvePath } from "../../lib/resolve-path.ts";
import { resolveGlobalOptions, handleError, type GlobalOptions } from "../../index.ts";
import { createShareListCommand, handleShareList } from "./list.ts";
import { createShareAddCommand, handleShareAdd } from "./add.ts";
import { createShareRemoveCommand, handleShareRemove } from "./remove.ts";
import { createShareLinkCommand, handleShareLink } from "./link.ts";

async function buildDrive(opts: GlobalOptions): Promise<DriveClient> {
  const config = loadConfig(nodeFs, opts.config);
  const { client } = await getAccountClient(nodeFs, config, opts.account);
  return buildDriveClient(client);
}

const stdout = (msg: string) => process.stdout.write(msg + "\n");

/**
 * `share` sits entirely with the entries, so nothing here follows
 * (decision 0025 §1): a shortcut carries its own ACL, and a `share add` that
 * quietly widened access to the target instead would grant a stranger a
 * document rather than a pointer, with nothing in the output to show it.
 */
export function registerShare(program: Command): void {
  const share = program.command("share").description("Manage file permissions");

  const list = createShareListCommand();
  list.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    try {
      const drive = await buildDrive(opts);
      const result = await handleShareList({
        resolvePath: (arg) => resolvePath(drive, arg),
        listPermissions: (id) => listPermissions(drive, id),
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
  share.addCommand(list);

  const add = createShareAddCommand();
  add.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = add.opts<{
      to?: string;
      domain?: string;
      anyone?: boolean;
      role?: string;
      notify?: boolean;
      message?: string;
      allowDiscovery?: boolean;
    }>();
    try {
      const drive = await buildDrive(opts);
      const result = await handleShareAdd({
        resolvePath: (arg) => resolvePath(drive, arg),
        createPermission: (id, input) => createPermission(drive, id, input),
        file,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.to !== undefined ? { to: o.to } : {}),
        ...(o.domain !== undefined ? { domain: o.domain } : {}),
        ...(o.anyone ? { anyone: true } : {}),
        ...(o.role !== undefined ? { role: o.role } : {}),
        ...(o.notify ? { notify: true } : {}),
        ...(o.message !== undefined ? { message: o.message } : {}),
        ...(o.allowDiscovery ? { allowDiscovery: true } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  share.addCommand(add);

  const remove = createShareRemoveCommand();
  remove.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = remove.opts<{ to?: string; permissionId?: string }>();
    try {
      const drive = await buildDrive(opts);
      const result = await handleShareRemove({
        resolvePath: (arg) => resolvePath(drive, arg),
        listPermissions: (id) => listPermissions(drive, id),
        deletePermission: (id, permissionId) => deletePermission(drive, id, permissionId),
        file,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.to !== undefined ? { to: o.to } : {}),
        ...(o.permissionId !== undefined ? { permissionId: o.permissionId } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  share.addCommand(remove);

  const link = createShareLinkCommand();
  link.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = link.opts<{ role?: string }>();
    try {
      const drive = await buildDrive(opts);
      const result = await handleShareLink({
        resolvePath: (arg) => resolvePath(drive, arg),
        getFile: (id) => getFile(drive, id),
        listPermissions: (id) => listPermissions(drive, id),
        createPermission: (id, input) => createPermission(drive, id, input),
        updatePermissionRole: (id, permissionId, role) =>
          updatePermissionRole(drive, id, permissionId, role),
        file,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.role !== undefined ? { role: o.role } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  share.addCommand(link);
}
