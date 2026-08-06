import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { createProgram } from "../../src/index.ts";
import { registerDocs } from "../../src/commands/docs/index.ts";
import { registerForms } from "../../src/commands/forms/index.ts";
import { registerSheets } from "../../src/commands/sheets/index.ts";
import { registerSlides } from "../../src/commands/slides/index.ts";
import type { DriveClient } from "../../src/lib/api.ts";
import type { DocsClient } from "../../src/lib/docs-api.ts";
import type { FormsClient } from "../../src/lib/forms-api.ts";
import type { SheetsClient } from "../../src/lib/sheets-api.ts";
import type { SlidesClient } from "../../src/lib/slides-api.ts";
import { createTreeDrive, type DriveNode } from "../helpers/fake-drive.ts";
import { ExitSignal, mockProcessExit } from "../helpers/mock.ts";

/**
 * What a caller can pick up after a `create` failed with the file already made
 * ([#36](https://github.com/ncukondo/gdrive-cli/issues/36), decision 0031 §4).
 *
 * The unit tests beside each command prove the failure *carries* the id. This
 * file is about the last three inches: whether the id reaches a shell. It runs
 * the real commander program with only the Google clients replaced, because the
 * defect it exists to catch lives in the registrar — a `handleError(error,
 * opts.format)` that drops `opts.quiet` renders no values at all, and every
 * unit test beside the handler still passes. That is exactly how `-q` came to
 * print nothing on the first live pass of this task.
 *
 * `-q` is checked on **stdout**, not on stderr. A value on stderr is one `$(…)`
 * cannot take, so it is not a value (decisions 0007 and 0038 §1).
 *
 * **What this does not reach.** Three of the four fail without `--parent`, which
 * is the shortest route to a fill that fails, and the fourth — `sheets`, whose
 * failure *is* the move — reaches the branch where `parent_id` is absent. So the
 * `parent_id`-present payload never runs through the real program here.
 * Placement is decided in `lib/after-create.ts` and asserted there and in each
 * command's own tests; nothing below is evidence that a file reached a folder.
 */

const clients = vi.hoisted(() => {
  const state: {
    drive?: DriveClient;
    docs?: DocsClient;
    forms?: FormsClient;
    sheets?: SheetsClient;
    slides?: SlidesClient;
  } = {};
  return state;
});

vi.mock("../../src/lib/google-clients.ts", () => ({
  buildDriveClient: () => clients.drive,
  buildDocsClient: () => clients.docs,
  buildFormsClient: () => clients.forms,
  buildSheetsClient: () => clients.sheets,
  buildSlidesClient: () => clients.slides,
}));

vi.mock("../../src/lib/account.ts", () => ({
  getAccountClient: async () => ({ email: "me@example.com", client: {} }),
}));

const tree: DriveNode[] = [
  {
    id: "rep1",
    name: "Reports",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["root"],
  },
];

const REFUSED = "the API refused one item, and the batch is atomic";

/** Every fill fails; every create succeeds. That is the shape #36 is about. */
const docsClient: DocsClient = {
  documents: {
    get: async ({ documentId }) => ({ data: { documentId, title: "" } }),
    create: async ({ requestBody }) => ({
      data: { documentId: "1NeWdOc", title: requestBody.title },
    }),
    batchUpdate: async () => {
      throw new Error(REFUSED);
    },
  },
};

const formsClient: FormsClient = {
  forms: {
    get: async ({ formId }) => ({ data: { formId, info: { title: "" }, items: [] } }),
    create: async ({ requestBody }) => ({
      data: { formId: "1NeWfOrM", info: { title: requestBody.info.title } },
    }),
    batchUpdate: async () => {
      throw new Error(REFUSED);
    },
    responses: { list: async () => ({ data: { responses: [] } }) },
  },
};

const slidesClient: SlidesClient = {
  presentations: {
    get: async ({ presentationId }) => ({ data: { presentationId, title: "" } }),
    create: async ({ requestBody }) => ({
      data: {
        presentationId: "1NeWdEcK",
        title: requestBody.title,
        layouts: [{ objectId: "L_TB", layoutProperties: { name: "TITLE_AND_BODY" } }],
        slides: [{ objectId: "p", slideProperties: { layoutObjectId: "L_TB" } }],
      },
    }),
    batchUpdate: async () => {
      throw new Error(REFUSED);
    },
  },
};

/**
 * A spreadsheet is created complete, so its failure has to come from the move —
 * and `createTreeDrive`'s `files.update` is not implemented, which is that move
 * failing for a reason a caller cannot control.
 */
const sheetsClient: SheetsClient = {
  spreadsheets: {
    get: async ({ spreadsheetId }) => ({ data: { spreadsheetId, sheets: [] } }),
    create: async ({ requestBody }) => ({
      data: { spreadsheetId: "1NeWsHeEt", properties: { title: requestBody.properties.title } },
    }),
    values: {
      get: async ({ range }) => ({ data: { range, values: [] } }),
      update: async () => ({ data: {} }),
      append: async () => ({ data: {} }),
      clear: async () => ({ data: {} }),
    },
  },
};

const workDir = mkdtempSync(join(tmpdir(), "gdrive-failed-create-"));
const config = join(workDir, "empty.toml");
writeFileSync(config, "");
const formDocument = join(workDir, "form.yaml");
writeFileSync(formDocument, stringify({ title: "x", items: [{ type: "text", title: "Why?" }] }));
const deckDocument = join(workDir, "deck.yaml");
writeFileSync(
  deckDocument,
  stringify({ title: "x", slides: [{ layout: "TITLE_AND_BODY", title: "One" }] }),
);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  clients.drive = createTreeDrive(tree);
  clients.docs = docsClient;
  clients.forms = formsClient;
  clients.sheets = sheetsClient;
  clients.slides = slidesClient;
  stdout = [];
  stderr = [];
  mockProcessExit();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function run(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const program = createProgram();
  registerDocs(program);
  registerForms(program);
  registerSheets(program);
  registerSlides(program);
  try {
    await program.parseAsync(["node", "gdrive", "--config", config, ...args]);
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
  }
  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

/** Each command, the argument that reaches its fill, and the id it will make. */
const commands: [string, string[], string][] = [
  ["docs", ["docs", "create", "Plan", "--content", "hello"], "1NeWdOc"],
  ["forms", ["forms", "create", "Survey", "--file", formDocument], "1NeWfOrM"],
  ["slides", ["slides", "create", "Deck", "--file", deckDocument], "1NeWdEcK"],
  // The one whose failure is the move rather than the fill, so `--parent`.
  ["sheets", ["sheets", "create", "Budget", "--parent", "Reports"], "1NeWsHeEt"],
];

describe("a create that failed after making the file", () => {
  it.each(commands)("%s: -q puts the new id on stdout, alone", async (_name, args, id) => {
    const out = await run(["-q", ...args]);
    expect(out.stdout).toBe(`${id}\n`);
  });

  it.each(commands)("%s: names the reason on stderr, not on stdout", async (_name, args) => {
    const out = await run(["-q", ...args]);
    expect(out.stderr).toContain("Error: ");
    expect(out.stdout).not.toContain("Error");
  });

  it.each(commands)("%s: carries the id in the json envelope's data", async (_name, args, id) => {
    const out = await run(["-f", "json", ...args]);
    const parsed = JSON.parse(out.stderr);
    expect(parsed.success).toBe(false);
    expect(parsed.data.id).toBe(id);
    // The envelope is the whole answer in json mode; nothing goes to stdout.
    expect(out.stdout).toBe("");
  });

  it.each(commands)("%s: summarises it under the error in text mode", async (_name, args, id) => {
    const out = await run(["-f", "text", ...args]);
    expect(out.stderr).toContain(id);
    expect(out.stderr).toContain("gdrive rm");
  });
});
