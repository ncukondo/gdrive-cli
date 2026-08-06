import type { Command } from "commander";
import { buildDriveClient, buildSlidesClient } from "../../lib/google-clients.ts";
import { nodeFs } from "../../lib/fs.ts";
import { loadConfig } from "../../lib/config.ts";
import { getAccountClient } from "../../lib/account.ts";
import type { DriveClient } from "../../lib/api.ts";
import { getPresentation, type SlidesClient } from "../../lib/slides-api.ts";
import { resolveTargetId } from "../../lib/resolve-path.ts";
import {
  documentFormat,
  resolveGlobalOptions,
  handleError,
  type GlobalOptions,
} from "../../index.ts";
import { createSlidesReadCommand, handleSlidesRead } from "./read.ts";

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

/**
 * `<presentation>` is a content argument — "read what is in this" — so it
 * follows a shortcut (decision 0025 §1), as `docs read` and `forms read` do.
 * Sending a shortcut's own id to the Slides API answers 404 for a deck that
 * plainly exists.
 */
export function registerSlides(program: Command): void {
  const slides = program.command("slides").description("Read Google Slides presentations");

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
}
