import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../src/index.ts";
import { registerDriveRead } from "../../src/commands/drive-read.ts";
import { registerDocs } from "../../src/commands/docs/index.ts";
import { registerForms } from "../../src/commands/forms/index.ts";
import { registerSheets } from "../../src/commands/sheets/index.ts";
import type { DriveClient } from "../../src/lib/api.ts";
import type { DocsClient } from "../../src/lib/docs-api.ts";
import type { FormsClient } from "../../src/lib/forms-api.ts";
import type { SheetsClient } from "../../src/lib/sheets-api.ts";
import { createTreeDrive, type DriveNode } from "../helpers/fake-drive.ts";
import { ExitSignal, mockProcessExit } from "../helpers/mock.ts";

/**
 * What a caller gets when it asks for nothing. Three records meet here and the
 * meeting point is `resolveGlobalOptions`, so this exercises the real commander
 * program with only the Google clients replaced:
 *
 * - [0036](../../decisions/0036-machine-format-by-default.md) §1 — unasked, a
 *   command emits its machine representation: the envelope for a command that
 *   returns records, the document itself for `docs read` and `forms read`.
 * - [0038](../../decisions/0038-quiet-asks-for-a-value.md) §1 — `-q` selects the
 *   terse output whatever the default is, and §2 — a named `-f` still wins.
 */

const clients = vi.hoisted(() => {
  const state: {
    drive?: DriveClient;
    docs?: DocsClient;
    forms?: FormsClient;
    sheets?: SheetsClient;
  } = {};
  return state;
});

vi.mock("../../src/lib/google-clients.ts", () => ({
  buildDriveClient: () => clients.drive,
  buildDocsClient: () => clients.docs,
  buildFormsClient: () => clients.forms,
  buildSheetsClient: () => clients.sheets,
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
  { id: "plain", name: "plain.txt", parents: ["root"] },
  {
    id: "doc1",
    name: "Notes",
    mimeType: "application/vnd.google-apps.document",
    parents: ["root"],
  },
  { id: "frm1", name: "Survey", mimeType: "application/vnd.google-apps.form", parents: ["root"] },
  {
    id: "sh1",
    name: "Budget",
    mimeType: "application/vnd.google-apps.spreadsheet",
    parents: ["root"],
  },
];

/** One heading, so the Markdown is recognisable as Markdown and not as prose. */
const docsClient: DocsClient = {
  documents: {
    get: async ({ documentId }) => ({
      data: {
        documentId,
        title: "Meeting notes",
        body: {
          content: [
            {
              paragraph: {
                paragraphStyle: { namedStyleType: "HEADING_1" },
                elements: [{ textRun: { content: "Meeting notes\n" } }],
              },
            },
          ],
        },
      },
    }),
    create: async () => ({ data: { documentId: "newDoc", title: "Draft" } }),
    batchUpdate: async () => ({ data: { replies: [] } }),
  },
};

const formsClient: FormsClient = {
  forms: {
    get: async ({ formId }) => ({
      data: { formId, info: { title: "2026 Engagement survey" }, items: [] },
    }),
    responses: { list: async () => ({ data: { responses: [] } }) },
  },
};

const sheetsClient: SheetsClient = {
  spreadsheets: {
    get: async ({ spreadsheetId }) => ({
      data: {
        spreadsheetId,
        sheets: [{ properties: { index: 0, title: "Sheet1", gridProperties: {} } }],
      },
    }),
    create: async () => ({ data: {} }),
    values: {
      get: async ({ range }) => ({
        data: {
          range,
          values: [
            ["name", "score"],
            ["alice", "90"],
          ],
        },
      }),
      update: async () => ({ data: {} }),
      append: async () => ({ data: {} }),
      clear: async () => ({ data: {} }),
    },
  },
};

const workDir = mkdtempSync(join(tmpdir(), "gdrive-format-"));
const emptyConfig = join(workDir, "empty.toml");
writeFileSync(emptyConfig, "");
const textConfig = join(workDir, "text.toml");
writeFileSync(textConfig, 'default_format = "text"\n');
const jsonConfig = join(workDir, "json.toml");
writeFileSync(jsonConfig, 'default_format = "json"\n');

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let stdout: string[];

beforeEach(() => {
  clients.drive = createTreeDrive(tree);
  clients.docs = docsClient;
  clients.forms = formsClient;
  clients.sheets = sheetsClient;
  stdout = [];
  mockProcessExit();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function run(config: string, args: string[]): Promise<string> {
  stdout = [];
  const program = createProgram();
  registerDriveRead(program);
  registerDocs(program);
  registerForms(program);
  registerSheets(program);
  try {
    await program.parseAsync(["node", "gdrive", "--config", config, ...args]);
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
  }
  return stdout.join("");
}

const ls = (config: string, args: string[] = []) => run(config, ["ls", ...args]);

describe("a command that returns records (decision 0036 §1)", () => {
  it("emits the JSON envelope with no config and no -f", async () => {
    const parsed = JSON.parse(await ls(emptyConfig));
    expect(parsed.success).toBe(true);
    expect(parsed.data.files.map((f: { id: string }) => f.id)).toEqual([
      "rep1",
      "plain",
      "doc1",
      "frm1",
      "sh1",
    ]);
  });

  it("emits tab-separated text when default_format asks for it", async () => {
    const lines = (await ls(textConfig)).trim().split("\n");
    expect(lines[0]?.split("\t")).toEqual(["Type", "Modified", "Name", "ID"]);
    expect(lines[1]?.split("\t").at(-1)).toBe("rep1");
  });

  it("lets -f text override a json config, and -f json a text one", async () => {
    expect((await ls(jsonConfig, ["-f", "text"])).split("\n")[0]).toContain("Type\tModified");
    expect(JSON.parse(await ls(textConfig, ["-f", "json"])).success).toBe(true);
  });
});

/**
 * The document commands are the exemption 0036 §1 spells out: their machine
 * representation *is* the document, so an unasked-for default cannot be JSON.
 * `gdrive forms read X > form.yaml` has to keep writing YAML.
 */
describe("a command whose output is a document (decision 0036 §1)", () => {
  it("prints Markdown, not an envelope, when no format is named", async () => {
    expect((await run(emptyConfig, ["docs", "read", "Notes"])).trim()).toBe("# Meeting notes");
  });

  it("prints YAML, not an envelope, when no format is named", async () => {
    expect(await run(emptyConfig, ["forms", "read", "Survey"])).toContain(
      "title: 2026 Engagement survey",
    );
  });

  it("keeps printing the document when the config prefers json", async () => {
    expect((await run(jsonConfig, ["docs", "read", "Notes"])).trim()).toBe("# Meeting notes");
    expect(await run(jsonConfig, ["forms", "read", "Survey"])).toContain("title:");
  });

  it("wraps it in the envelope when -f json names the format", async () => {
    const doc = JSON.parse(await run(emptyConfig, ["-f", "json", "docs", "read", "Notes"]));
    expect(doc.data.content).toBe("# Meeting notes");
    const form = JSON.parse(await run(emptyConfig, ["-f", "json", "forms", "read", "Survey"]));
    expect(form.data.form.title).toBe("2026 Engagement survey");
  });
});

/**
 * Decision 0038: `-q` asks for a value. A flag the default can switch off is
 * not a default, it is a bug — so the only thing that outranks `-q` is a format
 * the caller named.
 */
describe("--quiet against the default (decision 0038)", () => {
  it("prints bare ids with no config and no -f", async () => {
    expect((await ls(emptyConfig, ["-q"])).trim()).toBe("rep1\nplain\ndoc1\nfrm1\nsh1");
  });

  it("prints bare ids even when the config prefers json", async () => {
    expect((await ls(jsonConfig, ["-q"])).trim()).toBe("rep1\nplain\ndoc1\nfrm1\nsh1");
  });

  it("still prints bare ids under a text config or an explicit -f text", async () => {
    expect((await ls(textConfig, ["-q"])).trim()).toBe("rep1\nplain\ndoc1\nfrm1\nsh1");
    expect((await ls(emptyConfig, ["-q", "-f", "text"])).trim()).toBe(
      "rep1\nplain\ndoc1\nfrm1\nsh1",
    );
  });

  it("yields to an explicit -f json, which is 0007's rule (§2)", async () => {
    expect(JSON.parse(await ls(emptyConfig, ["-q", "-f", "json"])).data.files).toHaveLength(5);
    expect(JSON.parse(await ls(textConfig, ["-f", "json", "-q"])).success).toBe(true);
  });
});

/**
 * `--as csv` names an encoding for text output. Decision 0038's rule, stated
 * generally in its Consequences — a default applies where the caller expressed
 * no preference — makes it a preference like `-q`: nobody types `--as csv`
 * wanting an envelope, and `sheets read S --as csv > out.csv` silently writing
 * JSON is the same defect.
 */
describe("--as names an encoding, which is a preference", () => {
  it("prints CSV with no -f, where the same command without --as prints the envelope", async () => {
    expect((await run(emptyConfig, ["sheets", "read", "Budget", "--as", "csv"])).trim()).toBe(
      "name,score\nalice,90",
    );
    expect(JSON.parse(await run(emptyConfig, ["sheets", "read", "Budget"])).success).toBe(true);
  });

  it("prints CSV even when the config prefers json", async () => {
    expect((await run(jsonConfig, ["sheets", "read", "Budget", "--as", "csv"])).trim()).toBe(
      "name,score\nalice,90",
    );
  });

  it("yields to a named -f json, which still wraps the values", async () => {
    const parsed = JSON.parse(
      await run(emptyConfig, ["-f", "json", "sheets", "read", "Budget", "--as", "csv"]),
    );
    expect(parsed.data.values).toEqual([
      ["name", "score"],
      ["alice", "90"],
    ]);
  });

  it("prints the bare 2-D array for --as json, which is what that flag means", async () => {
    expect(
      JSON.parse(await run(emptyConfig, ["sheets", "read", "Budget", "--as", "json"])),
    ).toEqual([
      ["name", "score"],
      ["alice", "90"],
    ]);
  });
});
