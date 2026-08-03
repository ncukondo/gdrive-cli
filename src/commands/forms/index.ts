import type { Command } from "commander";
import { buildDriveClient, buildFormsClient } from "../../lib/google-clients.ts";
import { nodeFs } from "../../lib/fs.ts";
import { loadConfig } from "../../lib/config.ts";
import { getAccountClient } from "../../lib/account.ts";
import type { DriveClient } from "../../lib/api.ts";
import { getForm, listResponses, type FormsClient } from "../../lib/forms-api.ts";
import { resolvePath } from "../../lib/resolve-path.ts";
import { resolveGlobalOptions, handleError, type GlobalOptions } from "../../index.ts";
import { createFormsReadCommand, handleFormsRead } from "./read.ts";
import { createFormsResponsesCommand, handleFormsResponses } from "./responses.ts";

async function buildClients(
  opts: GlobalOptions,
): Promise<{ drive: DriveClient; forms: FormsClient }> {
  const config = loadConfig(nodeFs, opts.config);
  const { client } = await getAccountClient(nodeFs, config, opts.account);
  return {
    drive: buildDriveClient(client),
    forms: buildFormsClient(client),
  };
}

const stdout = (msg: string) => process.stdout.write(msg + "\n");
/** Notes about items the schema could not model go to stderr (0021 §3). */
const stderr = (msg: string) => process.stderr.write(msg + "\n");

export function registerForms(program: Command): void {
  const forms = program.command("forms").description("Read Google Forms and their responses");

  const read = createFormsReadCommand();
  read.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    try {
      const { drive, forms: formsClient } = await buildClients(opts);
      const result = await handleFormsRead({
        resolvePath: (arg) => resolvePath(drive, arg),
        getForm: (id) => getForm(formsClient, id),
        file,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        warn: stderr,
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  forms.addCommand(read);

  const responses = createFormsResponsesCommand();
  responses.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = responses.opts<{ as?: string }>();
    try {
      const { drive, forms: formsClient } = await buildClients(opts);
      const result = await handleFormsResponses({
        resolvePath: (arg) => resolvePath(drive, arg),
        getForm: (id) => getForm(formsClient, id),
        listResponses: (id) => listResponses(formsClient, id),
        file,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        ...(o.as !== undefined ? { as: o.as } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  forms.addCommand(responses);
}
