import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { formatValues, renderSuccess } from "../../lib/output.ts";
import { parseSlideDocument, type PresentationRaw } from "../../lib/slide-document.ts";
import type { SlidesRequest } from "../../lib/slides-api.ts";
import { planSlideWrite } from "./plan.ts";
import { renderSlidePlan, reportSkippedFields } from "./format.ts";

/**
 * Where the document comes from. `--file` names a path, because that is what
 * the option is called; `@path` and `-` are the same two spellings every other
 * content argument in this CLI takes (decision 0007), and no `--file` at all is
 * stdin — so `gdrive slides read D | gdrive slides write D` is a round trip
 * with nothing in between.
 */
export function documentSource(file: string | undefined): string {
  if (file === undefined || file === "-" || file.startsWith("@")) return file ?? "-";
  return `@${file}`;
}

export interface SlidesWriteDeps {
  resolvePath: (arg: string) => Promise<string>;
  getPresentation: (presentationId: string) => Promise<PresentationRaw>;
  batchUpdate: (
    presentationId: string,
    requests: SlidesRequest[],
    revisionId?: string,
  ) => Promise<void>;
  readInput: (arg: string) => Promise<string>;
  /** The presentation to write to. */
  file: string;
  /** The `--file` option; stdin when absent. */
  source?: string;
  prune?: boolean;
  dryRun?: boolean;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  warn: (msg: string) => void;
}

export async function handleSlidesWrite(deps: SlidesWriteDeps): Promise<CommandResult> {
  // Parsed before anything is fetched: a document that does not parse is an
  // argument error, and costs no round trip to find out.
  const document = parseSlideDocument(await deps.readInput(documentSource(deps.source)));

  const presentationId = await deps.resolvePath(deps.file);
  const presentation = await deps.getPresentation(presentationId);

  // Refuses here, whole, before the first `batchUpdate` (decision 0028 §3).
  const plan = planSlideWrite(presentation, document, { prune: deps.prune === true });

  const dryRun = deps.dryRun === true;
  const applied = plan.requests.length > 0 && !dryRun;
  if (applied) {
    await deps.batchUpdate(presentationId, plan.requests, document.revision_id);
  }

  deps.write(
    renderSuccess(
      {
        data: {
          id: presentationId,
          // Every write reports what it did, or would do (decision 0028 §4).
          plan: plan.entries,
          applied,
          ...(dryRun ? { dry_run: true } : {}),
          ...reportSkippedFields(plan.skipped, deps.format, deps.warn),
        },
        text: renderSlidePlan(plan.entries, presentationId, { applied, dryRun }),
        quiet: formatValues([String(plan.entries.length)]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createSlidesWriteCommand(): Command {
  return new Command("write")
    .description("Apply a deck document to a presentation, matching slides by id")
    .argument("<presentation>", "Presentation ID or path")
    .option("--file <path|@path|->", "The document to apply (default: stdin)")
    .option("--prune", "Delete the presentation's slides that the document does not contain")
    .option("--dry-run", "Report the plan and write nothing");
}
