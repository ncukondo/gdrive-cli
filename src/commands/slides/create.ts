import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { formatValues, line, renderSuccess } from "../../lib/output.ts";
import {
  parseSlideDocument,
  type PresentationRaw,
  type SlideDocument,
} from "../../lib/slide-document.ts";
import type { SlidesRequest } from "../../lib/slides-api.ts";
import { planSlideCreate } from "./plan.ts";
import { reportSkippedFields } from "./format.ts";
import { documentSource } from "./write.ts";

export interface SlidesCreateDeps {
  resolvePath: (arg: string) => Promise<string>;
  createPresentation: (title: string) => Promise<PresentationRaw>;
  /** Only called when the created deck arrived without its layouts (below). */
  getPresentation: (presentationId: string) => Promise<PresentationRaw>;
  batchUpdate: (presentationId: string, requests: SlidesRequest[]) => Promise<void>;
  /** Drive move — the Slides API cannot create a deck inside a folder. */
  moveFile: (presentationId: string, parentId: string) => Promise<unknown>;
  readInput: (arg: string) => Promise<string>;
  title: string;
  /** The `--file` option; without it the new deck is Slides' own (0030 §4). */
  source?: string;
  parent?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  warn: (msg: string) => void;
}

/**
 * Creates, then reconciles, then moves (decision 0030 §4) — `forms create`'s
 * shape plus the one step the other creates do not need: `presentations.create`
 * always returns a deck holding one slide, and `--file` must not leave it
 * stranded ahead of the document's own first slide, so the same `batchUpdate`
 * that builds the document deletes it.
 *
 * The document is parsed before the deck exists, so a document that does not
 * parse leaves no empty deck behind to clean up. Parsing is as far as that goes:
 * a document naming a layout the new deck's theme does not have is only found
 * out once the deck exists to be matched against, so that one fails with an
 * empty deck left over. Nothing can move it earlier — the layouts belong to the
 * deck the create just made.
 */
export async function handleSlidesCreate(deps: SlidesCreateDeps): Promise<CommandResult> {
  let document: SlideDocument | undefined;
  if (deps.source !== undefined) {
    document = parseSlideDocument(await deps.readInput(documentSource(deps.source)));
  }

  const created = await deps.createPresentation(deps.title);
  const presentationId = created.presentationId ?? "";
  const title = created.title ?? deps.title;

  // A new slide's text goes into the placeholders its layout offers, and their
  // types are read off the layout itself. The created deck carries its theme's
  // layouts, so one call is normally enough; the read-back is what keeps a
  // response that ever arrives without them from producing a deck of empty
  // slides and a pile of warnings.
  let base = created;
  if (document !== undefined && (created.layouts ?? []).length === 0) {
    base = await deps.getPresentation(presentationId);
  }

  const plan = document === undefined ? undefined : planSlideCreate(base, document, title);
  if (plan !== undefined && plan.requests.length > 0) {
    await deps.batchUpdate(presentationId, plan.requests);
  }

  let parentId: string | undefined;
  if (deps.parent !== undefined) {
    parentId = await deps.resolvePath(deps.parent);
    await deps.moveFile(presentationId, parentId);
  }

  deps.write(
    renderSuccess(
      {
        data: {
          id: presentationId,
          title,
          ...(parentId !== undefined ? { parent_id: parentId } : {}),
          ...(plan !== undefined ? { plan: plan.entries } : {}),
          ...(plan === undefined ? {} : reportSkippedFields(plan.skipped, deps.format, deps.warn)),
        },
        text: line`Created ${title} (${presentationId})`,
        quiet: formatValues([presentationId]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createSlidesCreateCommand(): Command {
  return new Command("create")
    .description("Create a new Google Slides presentation, optionally from a deck document")
    .argument("<title>", "Presentation title")
    .option("--file <path|@path|->", "A deck document to build the new presentation from")
    .option("--parent <folder>", "Parent folder ID or path");
}
