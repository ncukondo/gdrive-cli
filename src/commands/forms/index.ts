import type { Command } from "commander";
import { buildDriveClient, buildFormsClient } from "../../lib/google-clients.ts";
import { nodeFs } from "../../lib/fs.ts";
import { loadConfig } from "../../lib/config.ts";
import { getAccountClient } from "../../lib/account.ts";
import { moveFile, type DriveClient } from "../../lib/api.ts";
import {
  batchUpdateForm,
  createForm,
  getForm,
  listResponses,
  type FormsClient,
  type FormsRequest,
} from "../../lib/forms-api.ts";
import { readInput, readProcessStdin } from "../../lib/input.ts";
import { childrenNamed, resolveTargetId } from "../../lib/resolve-path.ts";
import {
  documentFormat,
  encodingFormat,
  resolveGlobalOptions,
  handleError,
  type GlobalOptions,
} from "../../index.ts";
import { createFormsReadCommand, handleFormsRead } from "./read.ts";
import { createFormsResponsesCommand, handleFormsResponses } from "./responses.ts";
import { createFormsWriteCommand, handleFormsWrite } from "./write.ts";
import { createFormsCreateCommand, handleFormsCreate } from "./create.ts";

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
const input = (arg: string) => readInput(arg, { fs: nodeFs, readStdin: readProcessStdin });

/**
 * `<form>` is a content argument in every command here — "read or edit what is
 * in this" — so it follows a shortcut (decision 0025 §1), like `docs read` and
 * `sheets read`. Sending a shortcut's own id to the Forms API answers 404 for
 * a form that plainly exists.
 */
export function registerForms(program: Command): void {
  const forms = program.command("forms").description("Read and edit Google Forms");

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

  const write = createFormsWriteCommand();
  write.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = write.opts<{ file?: string; prune?: boolean; dryRun?: boolean }>();
    try {
      const { drive, forms: formsClient } = await buildClients(opts);
      const result = await handleFormsWrite({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        getForm: (id) => getForm(formsClient, id),
        batchUpdate: (id, requests: FormsRequest[], revisionId) =>
          batchUpdateForm(formsClient, id, requests, revisionId),
        readInput: input,
        file,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        warn: stderr,
        ...(o.file !== undefined ? { source: o.file } : {}),
        ...(o.prune === true ? { prune: true } : {}),
        ...(o.dryRun === true ? { dryRun: true } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  forms.addCommand(write);

  const create = createFormsCreateCommand();
  create.action(async (title: string) => {
    const opts = resolveGlobalOptions(program);
    const o = create.opts<{ file?: string; parent?: string }>();
    try {
      const { drive, forms: formsClient } = await buildClients(opts);
      const result = await handleFormsCreate({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        createForm: (t) => createForm(formsClient, t),
        batchUpdate: (id, requests: FormsRequest[]) => batchUpdateForm(formsClient, id, requests),
        moveFile: (id, parentId) => moveFile(drive, id, parentId),
        findSiblings: (parentId, n) => childrenNamed(drive, parentId, n),
        readInput: input,
        title,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        warn: stderr,
        ...(o.file !== undefined ? { source: o.file } : {}),
        ...(o.parent !== undefined ? { parent: o.parent } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  forms.addCommand(create);
}
