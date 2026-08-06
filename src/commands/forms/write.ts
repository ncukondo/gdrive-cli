import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { formatValues, renderSuccess } from "../../lib/output.ts";
import { parseFormDocument, type FormRaw } from "../../lib/form-document.ts";
import type { FormsRequest } from "../../lib/forms-api.ts";
import { planFormWrite } from "./plan.ts";
import { renderPlan, reportSkippedItems } from "./format.ts";

/**
 * Where the document comes from. `--file` names a path, because that is what
 * the option is called; `@path` and `-` are the same two spellings every other
 * content argument in this CLI takes (decision 0007), and no `--file` at all is
 * stdin — so `gdrive forms read F | gdrive forms write F` is a round trip with
 * nothing in between.
 */
export function documentSource(file: string | undefined): string {
  if (file === undefined || file === "-" || file.startsWith("@")) return file ?? "-";
  return `@${file}`;
}

export interface FormsWriteDeps {
  resolvePath: (arg: string) => Promise<string>;
  getForm: (formId: string) => Promise<FormRaw>;
  batchUpdate: (formId: string, requests: FormsRequest[], revisionId?: string) => Promise<void>;
  readInput: (arg: string) => Promise<string>;
  /** The form to write to. */
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

export async function handleFormsWrite(deps: FormsWriteDeps): Promise<CommandResult> {
  // Parsed before anything is fetched: a document that does not parse is an
  // argument error, and costs no round trip to find out.
  const document = parseFormDocument(await deps.readInput(documentSource(deps.source)));

  const formId = await deps.resolvePath(deps.file);
  const form = await deps.getForm(formId);

  // Refuses here, whole, before the first `batchUpdate` (decision 0028 §3).
  const plan = planFormWrite(form, document, { prune: deps.prune === true });

  const dryRun = deps.dryRun === true;
  const applied = plan.requests.length > 0 && !dryRun;
  if (applied) {
    await deps.batchUpdate(formId, plan.requests, document.revision_id);
  }

  deps.write(
    renderSuccess(
      {
        data: {
          id: formId,
          // Every write reports what it did, or would do (decision 0028 §4).
          plan: plan.entries,
          applied,
          ...(dryRun ? { dry_run: true } : {}),
          ...reportSkippedItems(plan.skipped, deps.format, deps.warn),
        },
        text: renderPlan(plan.entries, formId, { applied, dryRun }),
        quiet: formatValues([String(plan.entries.length)]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createFormsWriteCommand(): Command {
  return new Command("write")
    .description("Apply a form document to a form, matching items by id")
    .argument("<form>", "Form ID or path")
    .option("--file <path|@path|->", "The document to apply (default: stdin)")
    .option("--prune", "Delete the form's items that the document does not contain")
    .option("--dry-run", "Report the plan and write nothing");
}
