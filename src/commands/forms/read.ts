import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import { formDocumentToYaml, toFormDocument, type FormRaw } from "../../lib/form-document.ts";
import { reportUnsupportedItems } from "./format.ts";

export interface FormsReadDeps {
  resolvePath: (arg: string) => Promise<string>;
  getForm: (formId: string) => Promise<FormRaw>;
  file: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  warn: (msg: string) => void;
}

export async function handleFormsRead(deps: FormsReadDeps): Promise<CommandResult> {
  const formId = await deps.resolvePath(deps.file);
  const { document, unsupported } = toFormDocument(await deps.getForm(formId));

  deps.write(
    renderSuccess(
      {
        data: {
          id: document.id ?? formId,
          // The structure itself, not the YAML as a string (decision 0027 §5).
          form: document,
          ...reportUnsupportedItems(unsupported, deps.format, deps.warn),
        },
        text: formDocumentToYaml(document),
        quiet: document.id ?? formId,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createFormsReadCommand(): Command {
  return new Command("read")
    .description("Export a form's structure as a YAML document")
    .argument("<form>", "Form ID or path");
}
