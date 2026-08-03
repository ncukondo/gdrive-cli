import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import {
  formDocumentToYaml,
  toFormDocument,
  type FormRaw,
  type UnsupportedItemNote,
} from "../../lib/form-document.ts";

/**
 * What the schema could not model, kept verbatim under `raw` (0027 §4) and
 * reported through the channel 0021 §3 defines: one line on stderr in text
 * mode, so stdout stays a document a caller can redirect, and a field in JSON.
 */
export function reportUnsupportedItems(
  notes: UnsupportedItemNote[],
  format: OutputFormat,
  warn: (message: string) => void,
): { unsupported: UnsupportedItemNote[] } | Record<string, never> {
  if (notes.length === 0) return {};
  if (format === "text") {
    const listed = notes.map((note) => `${note.kind} (item ${note.id})`).join(", ");
    warn(`Kept as raw: ${listed}`);
  }
  return { unsupported: notes };
}

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
