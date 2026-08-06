import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { formatValues, line, renderSuccess } from "../../lib/output.ts";
import { parseFormDocument, type FormDocument } from "../../lib/form-document.ts";
import type { FormsRequest } from "../../lib/forms-api.ts";
import { planFormCreate } from "./plan.ts";
import { reportSkippedItems } from "./format.ts";
import { documentSource } from "./write.ts";
import { MY_DRIVE, refuseUnaddressableName, type FindSiblings } from "../../lib/names.ts";
import { ROOT_ID } from "../../lib/resolve-path.ts";

export interface FormsCreateDeps {
  resolvePath: (arg: string) => Promise<string>;
  createForm: (title: string) => Promise<{ id: string; title: string }>;
  batchUpdate: (formId: string, requests: FormsRequest[]) => Promise<void>;
  /** Drive move — the Forms API cannot create a form inside a folder. */
  moveFile: (formId: string, parentId: string) => Promise<unknown>;
  /** What the title would collide with where the form lands (decision 0055 §1). */
  findSiblings: FindSiblings;
  readInput: (arg: string) => Promise<string>;
  title: string;
  /** The `--file` option; without it the new form is empty (decision 0028 §7). */
  source?: string;
  parent?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  warn: (msg: string) => void;
}

/**
 * Creates, moves, then fills — the three calls decision 0028 §7 records, in the
 * order [#36](https://github.com/ncukondo/gdrive-cli/issues/36) put them.
 * `forms.create` takes a title and nothing else, so the form is in My Drive's
 * root until the Drive move takes it out; and the fill is one `batchUpdate`,
 * which is atomic, so a single item the API refuses fails it with the form
 * already made. Moving first is what keeps that form inside the folder the
 * caller named instead of loose in the root (0043 §2). §7's own wording is
 * "creates, then fills, then moves", which is what this did before; the record
 * gives no reason for that half of the order, and the code is the source of
 * truth for what happens.
 *
 * The document is parsed before the form exists, so a document that does not
 * parse leaves no empty form behind to clean up. Decision 0055 §2 puts the name
 * check in the same place and for the same reason, which is what moves
 * `--parent`'s resolution ahead of the create: it was resolved either way, and
 * a refusal afterwards would leave a form to go and delete.
 */
export async function handleFormsCreate(deps: FormsCreateDeps): Promise<CommandResult> {
  let document: FormDocument | undefined;
  if (deps.source !== undefined) {
    document = parseFormDocument(await deps.readInput(documentSource(deps.source)));
  }

  const parentId = deps.parent !== undefined ? await deps.resolvePath(deps.parent) : undefined;
  await refuseUnaddressableName({
    name: deps.title,
    parentId: parentId ?? ROOT_ID,
    findSiblings: deps.findSiblings,
    where: deps.parent ?? MY_DRIVE,
  });

  const created = await deps.createForm(deps.title);
  if (parentId !== undefined) await deps.moveFile(created.id, parentId);

  const plan = document === undefined ? undefined : planFormCreate(document, created.title);
  if (plan !== undefined && plan.requests.length > 0) {
    await deps.batchUpdate(created.id, plan.requests);
  }

  deps.write(
    renderSuccess(
      {
        data: {
          id: created.id,
          title: created.title,
          ...(parentId !== undefined ? { parent_id: parentId } : {}),
          ...(plan !== undefined ? { plan: plan.entries } : {}),
          ...(plan === undefined ? {} : reportSkippedItems(plan.skipped, deps.format, deps.warn)),
        },
        text: line`Created ${created.title} (${created.id})`,
        quiet: formatValues([created.id]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createFormsCreateCommand(): Command {
  return new Command("create")
    .description("Create a new Google Form, optionally from a form document")
    .argument("<title>", "Form title")
    .option("--file <path|@path|->", "A form document to fill the new form with")
    .option("--parent <folder>", "Parent folder ID or path");
}
