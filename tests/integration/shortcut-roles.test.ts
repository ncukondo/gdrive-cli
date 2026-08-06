import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";
import { createProgram } from "../../src/index.ts";
import { registerDriveRead } from "../../src/commands/drive-read.ts";
import { registerDriveWrite } from "../../src/commands/drive-write.ts";
import { registerDocs } from "../../src/commands/docs/index.ts";
import { registerSheets } from "../../src/commands/sheets/index.ts";
import { registerShare } from "../../src/commands/share/index.ts";
import { registerForms } from "../../src/commands/forms/index.ts";
import { registerSlides } from "../../src/commands/slides/index.ts";
import type { DriveClient, DriveFileRaw } from "../../src/lib/api.ts";
import type { DocsClient } from "../../src/lib/docs-api.ts";
import type { SheetsClient } from "../../src/lib/sheets-api.ts";
import type { FormsClient } from "../../src/lib/forms-api.ts";
import type { SlidesClient } from "../../src/lib/slides-api.ts";
import { createTreeDrive, type DriveNode } from "../helpers/fake-drive.ts";
import { ExitSignal, mockProcessExit } from "../helpers/mock.ts";

/**
 * Decision 0025 §1 wires *arguments*, not commands: the same `mv` resolves its
 * source without following a shortcut and its destination by following one. The
 * wiring lives in the five registry files, so this exercises it there — through
 * the real commander program, with only the Google clients replaced.
 */

const clients = vi.hoisted(() => {
  const state: {
    drive?: DriveClient;
    docs?: DocsClient;
    sheets?: SheetsClient;
    forms?: FormsClient;
    slides?: SlidesClient;
  } = {};
  return state;
});

vi.mock("../../src/lib/google-clients.ts", () => ({
  buildDriveClient: () => clients.drive,
  buildDocsClient: () => clients.docs,
  buildSheetsClient: () => clients.sheets,
  buildFormsClient: () => clients.forms,
  buildSlidesClient: () => clients.slides,
}));

vi.mock("../../src/lib/account.ts", () => ({
  getAccountClient: async () => ({ email: "me@example.com", client: {} }),
}));

const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const FORM = "application/vnd.google-apps.form";
const SLIDES = "application/vnd.google-apps.presentation";

// root/
//   Reports/                (rep1)
//     2026/                 (y2026)
//     Notes        (doc1)   a Doc
//     Budget       (sh1)    a Sheet
//     Survey       (frm1)   a Form
//     Q3           (prs1)   a Slides deck
//     link-to-2026   -> 2026    (lnkFolder)
//     link-to-doc    -> Notes   (lnkDoc)
//     link-to-sheet  -> Budget  (lnkSheet)
//     link-to-form   -> Survey  (lnkForm)
//     link-to-deck   -> Q3      (lnkDeck)
//   Other/                  (other)
//   plain.txt               (plain)
const tree: DriveNode[] = [
  { id: "rep1", name: "Reports", mimeType: FOLDER, parents: ["root"] },
  { id: "y2026", name: "2026", mimeType: FOLDER, parents: ["rep1"] },
  { id: "doc1", name: "Notes", mimeType: DOC, parents: ["rep1"] },
  { id: "sh1", name: "Budget", mimeType: SHEET, parents: ["rep1"] },
  { id: "frm1", name: "Survey", mimeType: FORM, parents: ["rep1"] },
  { id: "prs1", name: "Q3", mimeType: SLIDES, parents: ["rep1"] },
  { id: "lnkFolder", name: "link-to-2026", parents: ["rep1"], target: "y2026" },
  { id: "lnkDoc", name: "link-to-doc", parents: ["rep1"], target: "doc1" },
  { id: "lnkSheet", name: "link-to-sheet", parents: ["rep1"], target: "sh1" },
  { id: "lnkForm", name: "link-to-form", parents: ["rep1"], target: "frm1" },
  { id: "lnkDeck", name: "link-to-deck", parents: ["rep1"], target: "prs1" },
  // Points at an id the tree does not hold: `files.get` answers 404, which is
  // what a trashed, deleted or unreadable target looks like.
  { id: "lnkGone", name: "link-to-gone", parents: ["rep1"], target: "1GoneDoc" },
  { id: "other", name: "Other", mimeType: FOLDER, parents: ["root"] },
  { id: "plain", name: "plain.txt", parents: ["root"] },
  // The ids the Docs/Sheets fakes hand back, so the follow-up Drive move finds them.
  { id: "newDoc", name: "Draft", mimeType: DOC, parents: [] },
  { id: "newSheet", name: "Draft", mimeType: SHEET, parents: [] },
];

interface DriveSpies {
  client: DriveClient;
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  copy: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  export: ReturnType<typeof vi.fn>;
  permissionList: ReturnType<typeof vi.fn>;
  permissionCreate: ReturnType<typeof vi.fn>;
  permissionDelete: ReturnType<typeof vi.fn>;
}

const madeUp = (id: string): DriveFileRaw => ({ id, name: "made-up", mimeType: "text/plain" });

/** The tree fake plus recording stubs for everything that writes. */
function createDriveSpies(): DriveSpies {
  const base = createTreeDrive(tree);
  const list = vi.fn(base.files.list);
  const get = vi.fn(base.files.get);
  const create = vi.fn(async (params: { media?: { body?: unknown } }) => {
    // `upload` hands over a live read stream. Nothing here consumes it, so it
    // is closed now — and its late "the temp file is gone" error ignored —
    // rather than surfacing after this suite has cleaned up.
    const body = params.media?.body;
    if (body instanceof Readable) {
      body.on("error", () => {});
      body.destroy();
    }
    return { data: madeUp("created") };
  });
  const copy = vi.fn(async () => ({ data: madeUp("copied") }));
  const update = vi.fn(async () => ({ data: madeUp("updated") }));
  const exported = vi.fn(async () => ({ data: "EXPORTED" }));
  const permissionList = vi.fn(async () => ({ data: { permissions: [] } }));
  const permissionCreate = vi.fn(async () => ({
    data: { id: "p1", type: "user", role: "writer" },
  }));
  const permissionDelete = vi.fn(async () => ({}));
  const client: DriveClient = {
    ...base,
    files: { ...base.files, list, get, create, copy, update, export: exported },
    permissions: {
      ...base.permissions,
      list: permissionList,
      create: permissionCreate,
      delete: permissionDelete,
    },
  };
  return {
    client,
    list,
    create,
    copy,
    update,
    get,
    export: exported,
    permissionList,
    permissionCreate,
    permissionDelete,
  };
}

interface DocsSpies {
  client: DocsClient;
  get: ReturnType<typeof vi.fn>;
  batchUpdate: ReturnType<typeof vi.fn>;
}

function createDocsSpies(): DocsSpies {
  const get = vi.fn(async ({ documentId }: { documentId: string }) => ({
    data: { documentId, title: "Notes", body: { content: [] } },
  }));
  const batchUpdate = vi.fn(async () => ({ data: { replies: [] } }));
  const create = vi.fn(async () => ({ data: { documentId: "newDoc", title: "Draft" } }));
  return { client: { documents: { get, create, batchUpdate } }, get, batchUpdate };
}

interface SheetsSpies {
  client: SheetsClient;
  get: ReturnType<typeof vi.fn>;
  values: {
    get: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
}

function createSheetsSpies(): SheetsSpies {
  const get = vi.fn(async ({ spreadsheetId }: { spreadsheetId: string }) => ({
    data: {
      spreadsheetId,
      properties: { title: "Budget" },
      sheets: [
        {
          properties: {
            sheetId: 0,
            index: 0,
            title: "Sheet1",
            gridProperties: { rowCount: 10, columnCount: 3 },
          },
        },
      ],
    },
  }));
  const valuesGet = vi.fn(async ({ range }: { range: string }) => ({
    data: { range, values: [["a"]] },
  }));
  const valuesUpdate = vi.fn(async ({ range }: { range: string }) => ({
    data: { updatedRange: range, updatedRows: 1, updatedColumns: 1, updatedCells: 1 },
  }));
  const valuesAppend = vi.fn(async ({ range }: { range: string }) => ({
    data: { updates: { updatedRange: range, updatedRows: 1, updatedColumns: 1, updatedCells: 1 } },
  }));
  const valuesClear = vi.fn(async ({ range }: { range: string }) => ({
    data: { clearedRange: range },
  }));
  const create = vi.fn(async () => ({
    data: { spreadsheetId: "newSheet", properties: { title: "Draft" } },
  }));
  return {
    client: {
      spreadsheets: {
        get,
        create,
        values: {
          get: valuesGet,
          update: valuesUpdate,
          append: valuesAppend,
          clear: valuesClear,
        },
      },
    },
    get,
    values: { get: valuesGet, update: valuesUpdate, append: valuesAppend, clear: valuesClear },
  };
}

interface FormsSpies {
  client: FormsClient;
  get: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  batchUpdate: ReturnType<typeof vi.fn>;
}

function createFormsSpies(): FormsSpies {
  const get = vi.fn(async ({ formId }: { formId: string }) => ({
    data: { formId, info: { title: "Survey" }, items: [] },
  }));
  const list = vi.fn(async () => ({ data: { responses: [] } }));
  const create = vi.fn(async ({ requestBody }: { requestBody: { info: { title: string } } }) => ({
    data: { formId: "frmNew", info: { title: requestBody.info.title } },
  }));
  const batchUpdate = vi.fn(async () => ({ data: {} }));
  return {
    client: { forms: { get, create, batchUpdate, responses: { list } } },
    get,
    list,
    create,
    batchUpdate,
  };
}

interface SlidesSpies {
  client: SlidesClient;
  get: ReturnType<typeof vi.fn>;
}

function createSlidesSpies(): SlidesSpies {
  const get = vi.fn(async ({ presentationId }: { presentationId: string }) => ({
    data: { presentationId, title: "Q3 review", slides: [] },
  }));
  return { client: { presentations: { get } }, get };
}

const workDir = mkdtempSync(join(tmpdir(), "gdrive-shortcut-"));
const localFile = join(workDir, "note.txt");
writeFileSync(localFile, "hello");
// An empty config, so nothing on the developer's machine changes the answers.
const noConfig = join(workDir, "gdrive-cli.toml");
writeFileSync(noConfig, "");

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let drive: DriveSpies;
let docs: DocsSpies;
let sheets: SheetsSpies;
let forms: FormsSpies;
let slides: SlidesSpies;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  drive = createDriveSpies();
  docs = createDocsSpies();
  sheets = createSheetsSpies();
  forms = createFormsSpies();
  slides = createSlidesSpies();
  clients.drive = drive.client;
  clients.docs = docs.client;
  clients.sheets = sheets.client;
  clients.forms = forms.client;
  clients.slides = slides.client;
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

function build(): Command {
  const program = createProgram();
  registerDriveRead(program);
  registerDriveWrite(program);
  registerDocs(program);
  registerSheets(program);
  registerShare(program);
  registerForms(program);
  registerSlides(program);
  return program;
}

/** Runs one command to completion, whether it succeeds or fails. */
async function attempt(args: string[]): Promise<void> {
  const program = build();
  try {
    await program.parseAsync(["node", "gdrive", "--config", noConfig, ...args]);
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
  }
}

/**
 * Runs one command and insists it worked. A handler's own `process.exit(0)`
 * surfaces as an `ExitSignal` that the registry's catch turns into an error
 * line, so the real failures are the ones that do *not* mention the fake exit.
 */
async function run(args: string[]): Promise<void> {
  await attempt(args);
  const failures = stderr.filter((line) => !line.includes("process.exit") && line.trim() !== "");
  if (failures.length > 0) throw new Error(`command failed: ${failures.join(" ")}`);
}

/** The `q` of the nth `files.list` that pinned a parent (path walks come first). */
function listedParents(): string[] {
  return drive.list.mock.calls
    .flatMap((call) => (typeof call[0]?.q === "string" ? [call[0].q] : []))
    .flatMap((q: string) => {
      const [, parent] = /'([^']*)' in parents/.exec(q) ?? [];
      return parent === undefined ? [] : [parent];
    });
}

function firstArg(fn: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  const call = fn.mock.calls[index];
  if (call === undefined) throw new Error(`expected at least ${index + 1} call(s)`);
  const [params] = call;
  if (typeof params !== "object" || params === null) throw new Error("expected object params");
  return { ...params };
}

describe("container arguments follow a shortcut (decision 0025 §1)", () => {
  it("`ls <link-to-folder>` lists the target's children", async () => {
    await run(["ls", "Reports/link-to-2026"]);
    // The last listing is the actual `ls`; the earlier ones walked the path.
    expect(listedParents().at(-1)).toBe("y2026");
  });

  it("`mkdir --parent <link>` creates inside the target", async () => {
    await run(["mkdir", "2027", "--parent", "Reports/link-to-2026"]);
    expect(firstArg(drive.create).requestBody).toMatchObject({ parents: ["y2026"] });
  });

  it("`upload --parent <link>` uploads into the target", async () => {
    await run(["upload", localFile, "--parent", "Reports/link-to-2026"]);
    expect(firstArg(drive.create).requestBody).toMatchObject({ parents: ["y2026"] });
  });

  it("`docs create --parent <link>` moves the new doc into the target", async () => {
    await run(["docs", "create", "Draft", "--parent", "Reports/link-to-2026"]);
    expect(firstArg(drive.update)).toMatchObject({ fileId: "newDoc", addParents: "y2026" });
  });

  it("`sheets create --parent <link>` moves the new sheet into the target", async () => {
    await run(["sheets", "create", "Draft", "--parent", "Reports/link-to-2026"]);
    expect(firstArg(drive.update)).toMatchObject({ fileId: "newSheet", addParents: "y2026" });
  });

  it("`mv <file> <link-to-folder>` lands in the target", async () => {
    await run(["mv", "plain.txt", "Reports/link-to-2026"]);
    expect(firstArg(drive.update)).toMatchObject({ fileId: "plain", addParents: "y2026" });
  });

  it("`cp <file> <link-to-folder>` lands in the target", async () => {
    await run(["cp", "plain.txt", "Reports/link-to-2026"]);
    expect(firstArg(drive.copy)).toMatchObject({ fileId: "plain" });
    expect(firstArg(drive.copy).requestBody).toMatchObject({ parents: ["y2026"] });
  });

  it("`ln <file> <link-to-folder>` creates the shortcut inside the target", async () => {
    await run(["ln", "plain.txt", "Reports/link-to-2026"]);
    expect(firstArg(drive.create).requestBody).toMatchObject({ parents: ["y2026"] });
  });
});

describe("content arguments follow a shortcut (decision 0025 §1)", () => {
  it("`download <link>` exports the target", async () => {
    await run(["download", "Reports/link-to-doc"]);
    expect(firstArg(drive.export)).toMatchObject({ fileId: "doc1" });
  });

  it("`docs read <link>` reads the target document", async () => {
    await run(["docs", "read", "Reports/link-to-doc"]);
    expect(firstArg(docs.get)).toMatchObject({ documentId: "doc1" });
  });

  it("`docs append <link>` edits the target document", async () => {
    await run(["docs", "append", "Reports/link-to-doc", "hello"]);
    expect(firstArg(docs.batchUpdate)).toMatchObject({ documentId: "doc1" });
  });

  it("`docs insert <link>` edits the target document", async () => {
    await run(["docs", "insert", "Reports/link-to-doc", "hello", "--index", "1"]);
    expect(firstArg(docs.batchUpdate)).toMatchObject({ documentId: "doc1" });
  });

  it("`docs replace <link>` edits the target document", async () => {
    // `--as text` goes straight to a batchUpdate; the Markdown path would first
    // read the document, and this fake's body holds no marker to replace.
    await run([
      "docs",
      "replace",
      "Reports/link-to-doc",
      "--find",
      "a",
      "--replace",
      "b",
      "--as",
      "text",
    ]);
    expect(firstArg(docs.batchUpdate)).toMatchObject({ documentId: "doc1" });
  });

  it("`sheets tabs <link>` reads the target spreadsheet", async () => {
    await run(["sheets", "tabs", "Reports/link-to-sheet"]);
    expect(firstArg(sheets.get)).toMatchObject({ spreadsheetId: "sh1" });
  });

  it("`sheets read <link>` reads the target spreadsheet", async () => {
    await run(["sheets", "read", "Reports/link-to-sheet"]);
    expect(firstArg(sheets.values.get)).toMatchObject({ spreadsheetId: "sh1" });
  });

  it("`sheets write <link>` writes to the target spreadsheet", async () => {
    await run(["sheets", "write", "Reports/link-to-sheet", "A1", "--values", "x"]);
    expect(firstArg(sheets.values.update)).toMatchObject({ spreadsheetId: "sh1" });
  });

  it("`sheets append <link>` appends to the target spreadsheet", async () => {
    await run(["sheets", "append", "Reports/link-to-sheet", "--values", "x"]);
    expect(firstArg(sheets.values.append)).toMatchObject({ spreadsheetId: "sh1" });
  });

  it("`sheets clear <link>` clears in the target spreadsheet", async () => {
    await run(["sheets", "clear", "Reports/link-to-sheet", "A1"]);
    expect(firstArg(sheets.values.clear)).toMatchObject({ spreadsheetId: "sh1" });
  });

  it("`forms read <link>` reads the target form", async () => {
    await run(["forms", "read", "Reports/link-to-form"]);
    expect(firstArg(forms.get)).toMatchObject({ formId: "frm1" });
  });

  it("`forms responses <link>` tabulates the target form's responses", async () => {
    await run(["forms", "responses", "Reports/link-to-form"]);
    expect(firstArg(forms.get)).toMatchObject({ formId: "frm1" });
    expect(firstArg(forms.list)).toMatchObject({ formId: "frm1" });
  });

  it("`forms write <link>` writes to the target form", async () => {
    const document = join(workDir, "form.yaml");
    writeFileSync(document, "title: Renamed\nitems: []\n");
    await run(["forms", "write", "Reports/link-to-form", "--file", document]);
    expect(firstArg(forms.get)).toMatchObject({ formId: "frm1" });
    expect(firstArg(forms.batchUpdate)).toMatchObject({ formId: "frm1" });
  });

  it("`slides read <link>` reads the target presentation", async () => {
    await run(["slides", "read", "Reports/link-to-deck"]);
    expect(firstArg(slides.get)).toMatchObject({ presentationId: "prs1" });
  });

  it("`ln <link> <folder>` links the document, not the shortcut (decision 0026 §2)", async () => {
    // Drive refuses to store a shortcut to a shortcut, so following turns the
    // request the API would reject into the one the user meant.
    await run(["ln", "Reports/link-to-doc", "Other"]);
    expect(firstArg(drive.create).requestBody).toMatchObject({
      mimeType: "application/vnd.google-apps.shortcut",
      parents: ["other"],
      shortcutDetails: { targetId: "doc1" },
    });
  });
});

describe("`gdrive ln` (decision 0026)", () => {
  it("names the shortcut after its target, at the cost of one lookup", async () => {
    await run(["ln", "Reports/Notes", "Other"]);
    expect(firstArg(drive.create).requestBody).toMatchObject({
      name: "Notes",
      shortcutDetails: { targetId: "doc1" },
    });
    // The walk finds the name and then discards it: `resolveTarget` answers
    // `file: null` for a path naming an ordinary file, so the default name is
    // bought with a `files.get` (decision 0026 §3). This is the call the next
    // test shows `--name` saving.
    expect(drive.get).toHaveBeenCalledTimes(1);
  });

  it("names it after what a shortcut target points at, not after the link", async () => {
    await run(["ln", "Reports/link-to-doc", "Other"]);
    expect(firstArg(drive.create).requestBody).toMatchObject({ name: "Notes" });
  });

  it("takes --name instead, and then asks Drive nothing about the target", async () => {
    await run(["ln", "Reports/Notes", "Other", "--name", "Notes (linked)"]);
    expect(firstArg(drive.create).requestBody).toMatchObject({ name: "Notes (linked)" });
    // `--name` is what saves the lookup, not the walk: the same command without
    // it fetches the target above, purely to learn what it is called.
    expect(drive.get).not.toHaveBeenCalled();
  });
});

describe("entry arguments never follow a shortcut (decision 0025 §1)", () => {
  it("`rm <link>` trashes the shortcut, leaving the target alone", async () => {
    await run(["rm", "Reports/link-to-doc"]);
    expect(firstArg(drive.update)).toMatchObject({
      fileId: "lnkDoc",
      requestBody: { trashed: true },
    });
    // The other half of the promise: the target is not touched *as well*.
    expect(drive.update).toHaveBeenCalledTimes(1);
  });

  it("`mv <link> <folder>` moves the shortcut itself", async () => {
    await run(["mv", "Reports/link-to-doc", "Other"]);
    expect(firstArg(drive.update)).toMatchObject({ fileId: "lnkDoc", addParents: "other" });
    expect(drive.update).toHaveBeenCalledTimes(1);
  });

  it("`cp <link> <folder>` copies the shortcut itself", async () => {
    await run(["cp", "Reports/link-to-doc", "Other"]);
    expect(firstArg(drive.copy)).toMatchObject({ fileId: "lnkDoc" });
    expect(drive.copy).toHaveBeenCalledTimes(1);
  });

  it("`share add <link>` permissions the shortcut, not the target", async () => {
    await run(["share", "add", "Reports/link-to-doc", "--to", "you@example.com"]);
    expect(firstArg(drive.permissionCreate)).toMatchObject({ fileId: "lnkDoc" });
  });

  it("`share list <link>` reads the shortcut's own permissions", async () => {
    await run(["share", "list", "Reports/link-to-doc"]);
    expect(firstArg(drive.permissionList)).toMatchObject({ fileId: "lnkDoc" });
  });

  it("`share remove <link>` revokes on the shortcut", async () => {
    await run(["share", "remove", "Reports/link-to-doc", "--permission-id", "p1"]);
    expect(firstArg(drive.permissionDelete)).toMatchObject({ fileId: "lnkDoc" });
  });

  it("`share link <link>` opens up the shortcut, not the document", async () => {
    await run(["share", "link", "Reports/link-to-doc"]);
    expect(firstArg(drive.permissionCreate)).toMatchObject({ fileId: "lnkDoc" });
  });

  it("`info <link>` reports the shortcut and what it points at", async () => {
    await run(["-f", "json", "info", "Reports/link-to-doc"]);
    const parsed: unknown = JSON.parse(stdout.join(""));
    expect(parsed).toMatchObject({
      success: true,
      data: {
        file: { id: "lnkDoc", type: "shortcut", target_id: "doc1", target_type: "doc" },
      },
    });
  });

  it("`info <link>` names the target in text output too", async () => {
    await run(["-f", "text", "info", "Reports/link-to-doc"]);
    const text = stdout.join("");
    expect(text.split("\n")).toContain("Type:\tshortcut");
    expect(text).toContain("doc1");
  });
});

describe("a dangling shortcut, end to end (decision 0025 §6)", () => {
  it("renders an error naming the shortcut as the user typed it", async () => {
    await attempt(["docs", "read", "Reports/link-to-gone"]);
    expect(stderr.join("")).toContain(
      'Error: Shortcut "Reports/link-to-gone" points at a file that is gone or not accessible (target 1GoneDoc).',
    );
  });

  it("keeps the NOT_FOUND code through the JSON envelope", async () => {
    await attempt(["-f", "json", "docs", "read", "Reports/link-to-gone"]);
    const parsed: unknown = JSON.parse(stderr.join(""));
    expect(parsed).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("Shortcut") },
    });
  });

  it("never reaches the Docs API with the shortcut's own id", async () => {
    await attempt(["docs", "read", "Reports/link-to-gone"]);
    expect(docs.get).not.toHaveBeenCalled();
  });
});

describe("--type shortcut", () => {
  it("filters `ls` to shortcuts", async () => {
    await run(["ls", "Reports", "--type", "shortcut"]);
    const [q] = drive.list.mock.calls
      .flatMap((call) => (typeof call[0]?.q === "string" ? [call[0].q] : []))
      .filter((query: string) => query.includes("mimeType"));
    expect(q).toContain("application/vnd.google-apps.shortcut");
  });

  it("filters `search` to shortcuts", async () => {
    await run(["search", "link", "--type", "shortcut"]);
    const [q] = drive.list.mock.calls.flatMap((call) =>
      typeof call[0]?.q === "string" ? [call[0].q] : [],
    );
    expect(q).toContain("application/vnd.google-apps.shortcut");
  });
});

/**
 * What a live account showed once `forms read` shipped: a form read as
 * `type: file`, a shortcut to one as `target_type: file`, and no `--type` value
 * that found a form at all (decision 0034).
 */
describe("a form is a type the CLI can name (decision 0034)", () => {
  it("`info <form>` reports type form", async () => {
    await run(["-f", "json", "info", "Reports/Survey"]);
    const parsed: unknown = JSON.parse(stdout.join(""));
    expect(parsed).toMatchObject({ data: { file: { id: "frm1", type: "form" } } });
  });

  it("`info <link-to-form>` names the target as a form", async () => {
    await run(["-f", "json", "info", "Reports/link-to-form"]);
    const parsed: unknown = JSON.parse(stdout.join(""));
    expect(parsed).toMatchObject({
      data: { file: { type: "shortcut", target_id: "frm1", target_type: "form" } },
    });
  });

  it("filters `ls` to forms", async () => {
    await run(["ls", "Reports", "--type", "form"]);
    const [q] = drive.list.mock.calls
      .flatMap((call) => (typeof call[0]?.q === "string" ? [call[0].q] : []))
      .filter((query: string) => query.includes("mimeType"));
    expect(q).toContain("application/vnd.google-apps.form");
  });

  it("filters `search` to forms", async () => {
    await run(["search", "survey", "--type", "form"]);
    const [q] = drive.list.mock.calls.flatMap((call) =>
      typeof call[0]?.q === "string" ? [call[0].q] : [],
    );
    expect(q).toContain("application/vnd.google-apps.form");
  });
});
