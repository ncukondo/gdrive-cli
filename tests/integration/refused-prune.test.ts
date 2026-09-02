import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { createProgram } from "../../src/index.ts";
import { registerForms } from "../../src/commands/forms/index.ts";
import { registerSlides } from "../../src/commands/slides/index.ts";
import type { DriveClient } from "../../src/lib/api.ts";
import type { FormsClient } from "../../src/lib/forms-api.ts";
import type { SlidesClient } from "../../src/lib/slides-api.ts";
import { createTreeDrive, type DriveNode } from "../helpers/fake-drive.ts";
import { ExitSignal, mockProcessExit } from "../helpers/mock.ts";

/**
 * What a caller can pick up after a `PRUNE_REQUIRED` refusal
 * ([#31](https://github.com/ncukondo/gdrive-cli/issues/31), decisions 0028 §4
 * and 0031 §3–§4).
 *
 * The unit tests beside each planner prove the refusal *carries* the list. This
 * file is about the last three inches: whether it reaches a shell. It is
 * `failed-create.test.ts`'s reason, one command family over — a registrar that
 * calls `handleError(error, opts.format)` and drops `opts.quiet` renders no
 * values at all while every unit test beside the handler still passes, and that
 * is how `-q` came to print nothing on task 0046's first live pass.
 *
 * `-q` is checked on **stdout**. A value on stderr is one `$(…)` cannot take,
 * so it is not a value (decisions 0007 and 0038 §1).
 */

const clients = vi.hoisted(() => {
  const state: { drive?: DriveClient; forms?: FormsClient; slides?: SlidesClient } = {};
  return state;
});

vi.mock("../../src/lib/google-clients.ts", () => ({
  buildDriveClient: () => clients.drive,
  buildDocsClient: () => undefined,
  buildFormsClient: () => clients.forms,
  buildSheetsClient: () => undefined,
  buildSlidesClient: () => clients.slides,
}));

vi.mock("../../src/lib/account.ts", () => ({
  getAccountClient: async () => ({ email: "me@example.com", client: {} }),
}));

/** Two questions. The documents below keep the first and drop the second. */
const formsClient: FormsClient = {
  forms: {
    get: async ({ formId }) => ({
      data: {
        formId,
        info: { title: "Survey" },
        revisionId: "r1",
        items: [
          {
            itemId: "i1",
            title: "Keep me",
            questionItem: { question: { questionId: "q1", textQuestion: {} } },
          },
          {
            itemId: "i2",
            title: "Drop me",
            questionItem: { question: { questionId: "q2", textQuestion: {} } },
          },
        ],
      },
    }),
    create: async () => ({ data: { formId: "unused", info: { title: "" } } }),
    batchUpdate: async () => {
      throw new Error("batchUpdate must not be reached: 0028 §3 refuses before it");
    },
    responses: { list: async () => ({ data: { responses: [] } }) },
  },
};

const slidesClient: SlidesClient = {
  presentations: {
    get: async ({ presentationId }) => ({
      data: {
        presentationId,
        title: "Deck",
        revisionId: "r1",
        layouts: [{ objectId: "L_TB", layoutProperties: { name: "TITLE_AND_BODY" } }],
        slides: [
          { objectId: "s1", slideProperties: { layoutObjectId: "L_TB" } },
          { objectId: "s2", slideProperties: { layoutObjectId: "L_TB" } },
        ],
      },
    }),
    create: async () => ({ data: { presentationId: "unused" } }),
    batchUpdate: async () => {
      throw new Error("batchUpdate must not be reached: 0030 §4 refuses before it");
    },
  },
};

/** The two files the commands below address by id. */
const tree: DriveNode[] = [
  {
    id: "1FoRm",
    name: "Survey",
    mimeType: "application/vnd.google-apps.form",
    parents: ["root"],
  },
  {
    id: "1DeCk",
    name: "Deck",
    mimeType: "application/vnd.google-apps.presentation",
    parents: ["root"],
  },
];

const workDir = mkdtempSync(join(tmpdir(), "gdrive-refused-prune-"));
const config = join(workDir, "empty.toml");
writeFileSync(config, "");

const formDocument = join(workDir, "form.yaml");
writeFileSync(
  formDocument,
  stringify({ title: "Survey", items: [{ id: "i1", type: "text", title: "Keep me" }] }),
);

const deckDocument = join(workDir, "deck.yaml");
writeFileSync(
  deckDocument,
  stringify({ title: "Deck", slides: [{ id: "s1", layout: "TITLE_AND_BODY" }] }),
);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  clients.drive = createTreeDrive(tree);
  clients.forms = formsClient;
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
  registerForms(program);
  registerSlides(program);
  try {
    await program.parseAsync(["node", "gdrive", "--config", config, ...args]);
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
  }
  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

/** Each command, the arguments that reach its refusal, and the id it refuses. */
const commands: [string, string[], string, string][] = [
  // Addressed by name, so the id in the payload is one the command resolved
  // rather than one the test handed it.
  ["forms", ["forms", "write", "Survey", "--file", formDocument], "1FoRm", "i2"],
  ["slides", ["slides", "write", "Deck", "--file", deckDocument], "1DeCk", "s2"],
];

describe("a write refused for want of --prune", () => {
  it.each(commands)("%s: -q puts the refused ids on stdout, alone", async (_n, args, _f, item) => {
    const out = await run(["-q", ...args]);
    expect(out.stdout).toBe(`${item}\n`);
  });

  it.each(commands)("%s: names the reason on stderr, not on stdout", async (_n, args) => {
    const out = await run(["-q", ...args]);
    expect(out.stderr).toContain("Error: ");
    expect(out.stdout).not.toContain("Error");
  });

  it.each(commands)("%s: carries the plan in the json envelope", async (_n, args, file, item) => {
    const out = await run(["-f", "json", ...args]);
    const parsed: unknown = JSON.parse(out.stderr);
    expect(parsed).toMatchObject({
      success: false,
      error: { code: "PRUNE_REQUIRED" },
      data: {
        id: file,
        applied: false,
        plan: [{ action: "delete", id: item }],
      },
    });
    // The envelope is the whole answer in json mode; nothing goes to stdout.
    expect(out.stdout).toBe("");
  });

  /**
   * 0028 §3's guarantee is not weakened by the data arriving beside it: the
   * message still names the item and the flag, so a person reading text mode
   * needs nothing else.
   */
  it.each(commands)(
    "%s: still names the item and the flag in text mode",
    async (_n, args, _f, item) => {
      const out = await run(["-f", "text", ...args]);
      expect(out.stderr).toContain(item);
      expect(out.stderr).toContain("--prune");
    },
  );
});
