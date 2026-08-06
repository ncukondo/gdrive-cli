import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { formatValues, renderSuccess } from "../../lib/output.ts";
import {
  slideDocumentToYaml,
  toSlideDocument,
  type PresentationRaw,
} from "../../lib/slide-document.ts";

export interface SlidesReadDeps {
  resolvePath: (arg: string) => Promise<string>;
  getPresentation: (presentationId: string) => Promise<PresentationRaw>;
  file: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleSlidesRead(deps: SlidesReadDeps): Promise<CommandResult> {
  const presentationId = await deps.resolvePath(deps.file);
  const document = toSlideDocument(await deps.getPresentation(presentationId));

  deps.write(
    renderSuccess(
      {
        data: {
          id: document.id ?? presentationId,
          // The structure itself, not the YAML as a string (decision 0029 §4).
          presentation: document,
        },
        text: slideDocumentToYaml(document),
        quiet: formatValues([document.id ?? presentationId]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createSlidesReadCommand(): Command {
  return new Command("read")
    .description("Export a presentation's slides as a YAML document")
    .argument("<presentation>", "Presentation ID or path");
}
