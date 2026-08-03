import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import { formatCsv, formatValuesTable } from "../../lib/sheets-api.ts";
import type { FormRaw } from "../../lib/form-document.ts";
import { toFormDocument } from "../../lib/form-document.ts";
import {
  responseGrid,
  tabulateResponses,
  type FormResponseRaw,
  type ResponseTable,
} from "../../lib/forms-api.ts";
import { parseResponsesAs, reportUnsupportedItems, type ResponsesEncoding } from "./format.ts";

/**
 * Renders the table. `json` keeps a checkbox or file-upload answer as the
 * array it is; `table` and `csv` are flat by construction and join it with
 * `; ` (decision 0027 §6).
 */
function encodeResponses(table: ResponseTable, as: ResponsesEncoding): string {
  if (as === "json") return JSON.stringify(table.rows, null, 2);
  const grid = responseGrid(table);
  return as === "csv" ? formatCsv(grid) : formatValuesTable(grid);
}

export interface FormsResponsesDeps {
  resolvePath: (arg: string) => Promise<string>;
  getForm: (formId: string) => Promise<FormRaw>;
  listResponses: (formId: string) => Promise<FormResponseRaw[]>;
  file: string;
  as?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  warn: (msg: string) => void;
}

/**
 * Tabulates a form's responses. The form is fetched as well as the responses,
 * unconditionally: the API keys answers by question id and never says what was
 * asked, so the join is the command (decision 0027 §6). Two calls, always.
 */
export async function handleFormsResponses(deps: FormsResponsesDeps): Promise<CommandResult> {
  const as = parseResponsesAs(deps.as);
  const formId = await deps.resolvePath(deps.file);
  const { document, unsupported } = toFormDocument(await deps.getForm(formId));
  const table = tabulateResponses(document, await deps.listResponses(formId));

  deps.write(
    renderSuccess(
      {
        data: {
          id: document.id ?? formId,
          columns: table.columns.map((column) => column.title),
          responses: table.rows,
          count: table.rows.length,
          // A grid's rows are tabulated out of `raw`, but the item itself is
          // still not modelled — and the caller has to hear that here too.
          ...reportUnsupportedItems(unsupported, deps.format, deps.warn),
        },
        text: encodeResponses(table, as),
        quiet: formatCsv(responseGrid(table)),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createFormsResponsesCommand(): Command {
  return new Command("responses")
    .description("Tabulate a form's responses, headed by the question titles")
    .argument("<form>", "Form ID or path")
    .option("--as <encoding>", "Render as: table | csv | json (default table)");
}
