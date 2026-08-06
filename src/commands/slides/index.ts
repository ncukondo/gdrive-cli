import type { Command } from "commander";
import { buildDriveClient, buildSlidesClient } from "../../lib/google-clients.ts";
import { nodeFs } from "../../lib/fs.ts";
import { loadConfig } from "../../lib/config.ts";
import { getAccountClient } from "../../lib/account.ts";
import { moveFile, type DriveClient } from "../../lib/api.ts";
import {
  batchUpdatePresentation,
  createPresentation,
  getPresentation,
  type SlidesClient,
  type SlidesRequest,
} from "../../lib/slides-api.ts";
import { readInput, readProcessStdin } from "../../lib/input.ts";
import { childrenNamed, resolveTargetId } from "../../lib/resolve-path.ts";
import {
  documentFormat,
  resolveGlobalOptions,
  handleError,
  type GlobalOptions,
} from "../../index.ts";
import { createSlidesReadCommand, handleSlidesRead } from "./read.ts";
import { createSlidesWriteCommand, handleSlidesWrite } from "./write.ts";
import { createSlidesCreateCommand, handleSlidesCreate } from "./create.ts";

async function buildClients(
  opts: GlobalOptions,
): Promise<{ drive: DriveClient; slides: SlidesClient }> {
  const config = loadConfig(nodeFs, opts.config);
  const { client } = await getAccountClient(nodeFs, config, opts.account);
  return {
    drive: buildDriveClient(client),
    slides: buildSlidesClient(client),
  };
}

const stdout = (msg: string) => process.stdout.write(msg + "\n");
/** What a write could not carry goes to stderr (0021 §3). */
const stderr = (msg: string) => process.stderr.write(msg + "\n");
const input = (arg: string) => readInput(arg, { fs: nodeFs, readStdin: readProcessStdin });

/**
 * `<presentation>` is a content argument — "read or edit what is in this" — so
 * it follows a shortcut (decision 0025 §1), as `docs read` and `forms read` do.
 * Sending a shortcut's own id to the Slides API answers 404 for a deck that
 * plainly exists.
 */
export function registerSlides(program: Command): void {
  const slides = program.command("slides").description("Read and edit Google Slides presentations");

  const read = createSlidesReadCommand();
  read.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    // A deck reads as one YAML document (0029 §4) — already exact, already
    // parseable — so the JSON default does not apply (0036 §1) and
    // `slides read X > deck.yaml` keeps writing YAML.
    const format = documentFormat(opts);
    try {
      const { drive, slides: slidesClient } = await buildClients(opts);
      const result = await handleSlidesRead({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        getPresentation: (id) => getPresentation(slidesClient, id),
        file,
        format,
        quiet: opts.quiet,
        write: stdout,
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, format);
    }
  });
  slides.addCommand(read);

  const write = createSlidesWriteCommand();
  write.action(async (file: string) => {
    const opts = resolveGlobalOptions(program);
    const o = write.opts<{ file?: string; prune?: boolean; dryRun?: boolean }>();
    try {
      const { drive, slides: slidesClient } = await buildClients(opts);
      const result = await handleSlidesWrite({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        getPresentation: (id) => getPresentation(slidesClient, id),
        batchUpdate: (id, requests: SlidesRequest[], revisionId) =>
          batchUpdatePresentation(slidesClient, id, requests, revisionId),
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
  slides.addCommand(write);

  const create = createSlidesCreateCommand();
  create.action(async (title: string) => {
    const opts = resolveGlobalOptions(program);
    const o = create.opts<{ file?: string; parent?: string }>();
    try {
      const { drive, slides: slidesClient } = await buildClients(opts);
      const result = await handleSlidesCreate({
        resolvePath: (arg) => resolveTargetId(drive, arg),
        createPresentation: (t) => createPresentation(slidesClient, t),
        getPresentation: (id) => getPresentation(slidesClient, id),
        batchUpdate: (id, requests: SlidesRequest[]) =>
          batchUpdatePresentation(slidesClient, id, requests),
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
      // A `create` can fail after the deck exists — the batch is atomic, and a
      // layout the new theme lacks is only found out once there is a deck to
      // match against — and then the failure is the only place its id is
      // printed (decision 0031 §4). `-q` is passed on so it lands on stdout.
      handleError(error, opts.format, opts.quiet);
    }
  });
  slides.addCommand(create);
}
