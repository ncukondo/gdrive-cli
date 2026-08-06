import type { Command } from "commander";
import { buildDriveClient, buildSheetsClient } from "../../lib/google-clients.ts";
import { nodeFs } from "../../lib/fs.ts";
import { loadConfig } from "../../lib/config.ts";
import { getAccountClient } from "../../lib/account.ts";
import { moveFile, type DriveClient } from "../../lib/api.ts";
import {
  appendValues,
  clearValues,
  createSpreadsheet,
  listTabs,
  readValues,
  writeValues,
  type SheetsClient,
} from "../../lib/sheets-api.ts";
import { readInput, readProcessStdin } from "../../lib/input.ts";
import { childrenNamed, resolveTargetId } from "../../lib/resolve-path.ts";
import {
  encodingFormat,
  resolveGlobalOptions,
  handleError,
  type GlobalOptions,
} from "../../index.ts";
import { createSheetsTabsCommand, handleSheetsTabs } from "./tabs.ts";
import { createSheetsReadCommand, handleSheetsRead } from "./read.ts";
import { createSheetsWriteCommand, handleSheetsWrite } from "./write.ts";
import { createSheetsAppendCommand, handleSheetsAppend } from "./append.ts";
import { createSheetsClearCommand, handleSheetsClear } from "./clear.ts";
import { createSheetsCreateCommand, handleSheetsCreate } from "./create.ts";

async function buildClients(
  opts: GlobalOptions,
): Promise<{ drive: DriveClient; sheets: SheetsClient }> {
  const config = loadConfig(nodeFs, opts.config);
  const { client } = await getAccountClient(nodeFs, config, opts.account);
  return {
    drive: buildDriveClient(client),
    sheets: buildSheetsClient(client),
  };
}

const stdout = (msg: string) => process.stdout.write(msg + "\n");
const input = (arg: string) => readInput(arg, { fs: nodeFs, readStdin: readProcessStdin });

/**
 * As in `docs`: every `<file>` is content and `create --parent` is a container,
 * so each one follows a shortcut (decision 0025 §1).
 */
export function registerSheets(program: Command): void {
  const sheets = program.command("sheets").description("Read and edit Google Sheets");

  const tabs = createSheetsTabsCommand();
  tabs.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    try {
      const { drive, sheets: sheetsClient } = await buildClients(opts);
      const result = await handleSheetsTabs({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        listTabs: (id) => listTabs(sheetsClient, id),
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
  sheets.addCommand(tabs);

  const read = createSheetsReadCommand();
  read.action(async (file: string, range: string | undefined) => {
    const opts = resolveGlobalOptions(program);
    const o = read.opts<{ tab?: string; as?: string }>();
    // `--as csv` names a text encoding, so it selects text unless `-f` named a
    // format: a flag a default can switch off is not a flag (decision 0038).
    const format = encodingFormat(opts, o.as !== undefined);
    try {
      const { drive, sheets: sheetsClient } = await buildClients(opts);
      const result = await handleSheetsRead({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        listTabs: (id) => listTabs(sheetsClient, id),
        readValues: (id, a1) => readValues(sheetsClient, id, a1),
        file,
        format,
        quiet: opts.quiet,
        write: stdout,
        ...(range !== undefined ? { range } : {}),
        ...(o.tab !== undefined ? { tab: o.tab } : {}),
        ...(o.as !== undefined ? { as: o.as } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, format);
    }
  });
  sheets.addCommand(read);

  const write = createSheetsWriteCommand();
  write.action(async (file: string, range: string) => {
    const opts = resolveGlobalOptions(program);
    const o = write.opts<{ values: string; tab?: string; inputMode?: string }>();
    try {
      const { drive, sheets: sheetsClient } = await buildClients(opts);
      const result = await handleSheetsWrite({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        listTabs: (id) => listTabs(sheetsClient, id),
        writeValues: (id, a1, values, mode) => writeValues(sheetsClient, id, a1, values, mode),
        readInput: input,
        file,
        range,
        values: o.values,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.tab !== undefined ? { tab: o.tab } : {}),
        ...(o.inputMode !== undefined ? { inputMode: o.inputMode } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  sheets.addCommand(write);

  const append = createSheetsAppendCommand();
  append.action(async (file: string, range: string | undefined) => {
    const opts = resolveGlobalOptions(program);
    const o = append.opts<{ values: string; tab?: string; inputMode?: string }>();
    try {
      const { drive, sheets: sheetsClient } = await buildClients(opts);
      const result = await handleSheetsAppend({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        listTabs: (id) => listTabs(sheetsClient, id),
        appendValues: (id, a1, values, mode) => appendValues(sheetsClient, id, a1, values, mode),
        readInput: input,
        file,
        values: o.values,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(range !== undefined ? { range } : {}),
        ...(o.tab !== undefined ? { tab: o.tab } : {}),
        ...(o.inputMode !== undefined ? { inputMode: o.inputMode } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  sheets.addCommand(append);

  const clear = createSheetsClearCommand();
  clear.action(async (file: string, range: string) => {
    const opts = resolveGlobalOptions(program);
    const o = clear.opts<{ tab?: string }>();
    try {
      const { drive, sheets: sheetsClient } = await buildClients(opts);
      const result = await handleSheetsClear({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        listTabs: (id) => listTabs(sheetsClient, id),
        clearValues: (id, a1) => clearValues(sheetsClient, id, a1),
        file,
        range,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.tab !== undefined ? { tab: o.tab } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  sheets.addCommand(clear);

  const create = createSheetsCreateCommand();
  create.action(async (title: string) => {
    const opts = resolveGlobalOptions(program);
    const o = create.opts<{ parent?: string }>();
    try {
      const { drive, sheets: sheetsClient } = await buildClients(opts);
      const result = await handleSheetsCreate({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        createSpreadsheet: (t) => createSpreadsheet(sheetsClient, t),
        moveFile: (id, parentId) => moveFile(drive, id, parentId),
        findSiblings: (parentId, n) => childrenNamed(drive, parentId, n),
        title,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.parent !== undefined ? { parent: o.parent } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      // A move that fails leaves the spreadsheet in My Drive, and the failure
      // is the only place its id is printed (decision 0031 §4) — so `-q` is
      // passed on, and gets that id on stdout.
      handleError(error, opts.format, opts.quiet);
    }
  });
  sheets.addCommand(create);
}
