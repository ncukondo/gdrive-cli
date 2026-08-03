import type { Command } from "commander";
import { buildDriveClient, buildFormsClient } from "../../lib/google-clients.ts";
import { nodeFs } from "../../lib/fs.ts";
import { loadConfig } from "../../lib/config.ts";
import { getAccountClient } from "../../lib/account.ts";
import type { DriveClient } from "../../lib/api.ts";
import { getForm, listResponses, type FormsClient } from "../../lib/forms-api.ts";
import { resolveTargetId } from "../../lib/resolve-path.ts";
import {
  documentFormat,
  encodingFormat,
  resolveGlobalOptions,
  handleError,
  type GlobalOptions,
} from "../../index.ts";
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

/**
 * `<form>` is a content argument in both commands — "read what is in this" —
 * so it follows a shortcut (decision 0025 §1), like `docs read` and
 * `sheets read`. Sending a shortcut's own id to the Forms API answers 404 for
 * a form that plainly exists.
 */
export function registerForms(program: Command): void {
  const forms = program.command("forms").description("Read Google Forms and their responses");

  const read = createFormsReadCommand();
  read.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    // A form reads as one YAML document (0027 §5) — already exact, already
    // parseable — so the JSON default does not apply (0036 §1) and
    // `forms read X > form.yaml` keeps writing YAML.
    const format = documentFormat(opts);
    try {
      const { drive, forms: formsClient } = await buildClients(opts);
      const result = await handleFormsRead({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        getForm: (id) => getForm(formsClient, id),
        file,
        format,
        quiet: opts.quiet,
        write: stdout,
        warn: stderr,
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, format);
    }
  });
  forms.addCommand(read);

  const responses = createFormsResponsesCommand();
  responses.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = responses.opts<{ as?: string }>();
    // As for `sheets read`: `--as` names a text encoding, so it selects text
    // unless `-f` named a format (decision 0038, generalised).
    const format = encodingFormat(opts, o.as !== undefined);
    try {
      const { drive, forms: formsClient } = await buildClients(opts);
      const result = await handleFormsResponses({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        getForm: (id) => getForm(formsClient, id),
        listResponses: (id) => listResponses(formsClient, id),
        file,
        format,
        quiet: opts.quiet,
        write: stdout,
        warn: stderr,
        ...(o.as !== undefined ? { as: o.as } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, format);
    }
  });
  forms.addCommand(responses);
}
