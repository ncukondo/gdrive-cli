import type { Command } from "commander";
import { buildDocsClient, buildDriveClient } from "../../lib/google-clients.ts";
import { nodeFs } from "../../lib/fs.ts";
import { loadConfig } from "../../lib/config.ts";
import { getAccountClient } from "../../lib/account.ts";
import { moveFile, type DriveClient } from "../../lib/api.ts";
import {
  createDocument,
  getDocument,
  insertMarkdown,
  insertText,
  replaceAllText,
  replaceMarkdown,
  type DocsClient,
} from "../../lib/docs-api.ts";
import { readInput, readProcessStdin } from "../../lib/input.ts";
import { resolveTargetId } from "../../lib/resolve-path.ts";
import { resolveGlobalOptions, handleError, type GlobalOptions } from "../../index.ts";
import { createDocsReadCommand, handleDocsRead } from "./read.ts";
import { createDocsCreateCommand, handleDocsCreate } from "./create.ts";
import { createDocsAppendCommand, handleDocsAppend } from "./append.ts";
import { createDocsReplaceCommand, handleDocsReplace } from "./replace.ts";
import { createDocsInsertCommand, handleDocsInsert } from "./insert.ts";

async function buildClients(
  opts: GlobalOptions,
): Promise<{ drive: DriveClient; docs: DocsClient }> {
  const config = loadConfig(nodeFs, opts.config);
  const { client } = await getAccountClient(nodeFs, config, opts.account);
  return {
    drive: buildDriveClient(client),
    docs: buildDocsClient(client),
  };
}

const stdout = (msg: string) => process.stdout.write(msg + "\n");
/** Notes about content Docs cannot hold go to stderr, so stdout stays pipeable. */
const stderr = (msg: string) => process.stderr.write(msg + "\n");
const input = (arg: string) => readInput(arg, { fs: nodeFs, readStdin: readProcessStdin });

/**
 * Every `<file>` here is content — "read or edit what is in this" — and
 * `create --parent` is a container, so all six follow a shortcut
 * (decision 0025 §1). Sending a shortcut id to the Docs API answers 404 for a
 * document that plainly exists, which is the bug this closes.
 */
export function registerDocs(program: Command): void {
  const docs = program.command("docs").description("Read and edit Google Docs");

  const read = createDocsReadCommand();
  read.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = read.opts<{ as?: string }>();
    try {
      const { drive, docs: docsClient } = await buildClients(opts);
      const result = await handleDocsRead({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        getDocument: (id) => getDocument(docsClient, id),
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
  docs.addCommand(read);

  const create = createDocsCreateCommand();
  create.action(async (title: string) => {
    const opts = resolveGlobalOptions(program);
    const o = create.opts<{ content?: string; parent?: string; as?: string }>();
    try {
      const { drive, docs: docsClient } = await buildClients(opts);
      const result = await handleDocsCreate({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        createDocument: (t) => createDocument(docsClient, t),
        insertText: (id, index, text) => insertText(docsClient, id, index, text),
        insertMarkdown: (id, index, source) => insertMarkdown(docsClient, id, index, source),
        moveFile: (id, parentId) => moveFile(drive, id, parentId),
        readInput: input,
        title,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        warn: stderr,
        ...(o.content !== undefined ? { content: o.content } : {}),
        ...(o.parent !== undefined ? { parent: o.parent } : {}),
        ...(o.as !== undefined ? { as: o.as } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  docs.addCommand(create);

  const append = createDocsAppendCommand();
  append.action(async (file: string, text: string) => {
    const opts = resolveGlobalOptions(program);
    const o = append.opts<{ as?: string }>();
    try {
      const { drive, docs: docsClient } = await buildClients(opts);
      const result = await handleDocsAppend({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        getDocument: (id) => getDocument(docsClient, id),
        insertText: (id, index, t) => insertText(docsClient, id, index, t),
        insertMarkdown: (id, index, source, options) =>
          insertMarkdown(docsClient, id, index, source, options),
        readInput: input,
        file,
        text,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        warn: stderr,
        ...(o.as !== undefined ? { as: o.as } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  docs.addCommand(append);

  const replace = createDocsReplaceCommand();
  replace.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = replace.opts<{ find: string; replace: string; matchCase?: boolean; as?: string }>();
    try {
      const { drive, docs: docsClient } = await buildClients(opts);
      const result = await handleDocsReplace({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        replaceAllText: (id, find, to, matchCase) =>
          replaceAllText(docsClient, id, find, to, matchCase),
        replaceMarkdown: (id, find, to, matchCase) =>
          replaceMarkdown(docsClient, id, find, to, matchCase),
        readInput: input,
        file,
        find: o.find,
        replace: o.replace,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        warn: stderr,
        ...(o.matchCase ? { matchCase: true } : {}),
        ...(o.as !== undefined ? { as: o.as } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  docs.addCommand(replace);

  const insert = createDocsInsertCommand();
  insert.action(async (file: string, text: string) => {
    const opts = resolveGlobalOptions(program);
    const o = insert.opts<{
      index?: string;
      at?: string;
      before?: string;
      after?: string;
      matchCase?: boolean;
      as?: string;
    }>();
    try {
      const { drive, docs: docsClient } = await buildClients(opts);
      const result = await handleDocsInsert({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        getDocument: (id) => getDocument(docsClient, id),
        insertText: (id, index, t) => insertText(docsClient, id, index, t),
        insertMarkdown: (id, index, source) => insertMarkdown(docsClient, id, index, source),
        readInput: input,
        file,
        text,
        format: opts.format,
        quiet: opts.quiet,
        write: stdout,
        warn: stderr,
        ...(o.index !== undefined ? { index: o.index } : {}),
        ...(o.at !== undefined ? { at: o.at } : {}),
        ...(o.before !== undefined ? { before: o.before } : {}),
        ...(o.after !== undefined ? { after: o.after } : {}),
        ...(o.matchCase ? { matchCase: true } : {}),
        ...(o.as !== undefined ? { as: o.as } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
  docs.addCommand(insert);
}
