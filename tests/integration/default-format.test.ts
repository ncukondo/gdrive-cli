import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../src/index.ts";
import { registerDriveRead } from "../../src/commands/drive-read.ts";
import type { DriveClient } from "../../src/lib/api.ts";
import { createTreeDrive, type DriveNode } from "../helpers/fake-drive.ts";
import { ExitSignal, mockProcessExit } from "../helpers/mock.ts";

/**
 * What a caller gets when it asks for nothing. Decision 0036 §1 moved that from
 * the convenience layer to the machine one, and the move happens between
 * `resolveGlobalOptions` and the handler — so it is asserted through the real
 * commander program, with only the Drive client replaced.
 */

const clients = vi.hoisted(() => {
  const state: { drive?: DriveClient } = {};
  return state;
});

vi.mock("../../src/lib/google-clients.ts", () => ({
  buildDriveClient: () => clients.drive,
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
];

const workDir = mkdtempSync(join(tmpdir(), "gdrive-format-"));
const emptyConfig = join(workDir, "empty.toml");
writeFileSync(emptyConfig, "");
const textConfig = join(workDir, "text.toml");
writeFileSync(textConfig, 'default_format = "text"\n');

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let stdout: string[];

beforeEach(() => {
  clients.drive = createTreeDrive(tree);
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

async function ls(config: string, args: string[] = []): Promise<string> {
  stdout = [];
  const program = createProgram();
  registerDriveRead(program);
  try {
    await program.parseAsync(["node", "gdrive", "--config", config, "ls", ...args]);
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
  }
  return stdout.join("");
}

describe("the format a command uses when it is not told one (decision 0036 §1)", () => {
  it("emits the JSON envelope with no config and no -f", async () => {
    const parsed = JSON.parse(await ls(emptyConfig));
    expect(parsed.success).toBe(true);
    expect(parsed.data.files.map((f: { id: string }) => f.id)).toEqual(["rep1", "plain"]);
  });

  it("emits tab-separated text when default_format asks for it", async () => {
    const lines = (await ls(textConfig)).trim().split("\n");
    expect(lines[0]?.split("\t")).toEqual(["Type", "Modified", "Name", "ID"]);
    expect(lines[1]?.split("\t").at(-1)).toBe("rep1");
  });

  it("lets -f text override a json config, and -f json a text one", async () => {
    expect((await ls(emptyConfig, ["-f", "text"])).split("\n")[0]).toContain("Type\tModified");
    expect(JSON.parse(await ls(textConfig, ["-f", "json"])).success).toBe(true);
  });

  /**
   * `--quiet` itself is untouched: decision 0007 has always said JSON mode
   * ignores it, and text mode emits bare ids. What changed underneath is which
   * of the two `-q` composes with when nothing else is said, so a caller that
   * wanted bare ids now asks for the mode they belong to.
   */
  it("keeps --quiet meaning what it always did in each format", async () => {
    expect((await ls(textConfig, ["-q"])).trim()).toBe("rep1\nplain");
    expect((await ls(emptyConfig, ["-q", "-f", "text"])).trim()).toBe("rep1\nplain");
    expect(JSON.parse(await ls(emptyConfig, ["-q"])).data.files).toHaveLength(2);
  });
});
