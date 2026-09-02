import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../src/index.ts";
import { registerAuth } from "../../src/commands/auth.ts";
import { ExitSignal, mockProcessExit } from "../helpers/mock.ts";

/**
 * Which stream `gdrive auth` prints its consent URL on (decision 0059 §1).
 *
 * This runs the real commander program with only `startOAuthFlow` replaced,
 * because the URL is written in the registrar closure
 * (`src/commands/auth.ts`) — a place no unit test beside `handleAuthLogin`
 * reaches. A unit test that injects a `runFlow` fake and then asserts where
 * that fake wrote is asserting what the test told it to do, and passes with
 * production writing to stdout. Measured: that is exactly what happened, and
 * it is why this file exists.
 */

const oauth = vi.hoisted(() => ({ authUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }));

vi.mock("../../src/lib/auth.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/auth.ts")>();
  return {
    ...actual,
    startOAuthFlow: async () => ({
      authUrl: oauth.authUrl,
      waitForToken: Promise.resolve({
        email: "me@example.com",
        access_token: "at",
        refresh_token: "rt",
        token_type: "Bearer",
        expiry_date: Date.now() + 3_600_000,
        scopes: ["https://www.googleapis.com/auth/drive"],
      }),
      server: { close: () => {} },
    }),
  };
});

let home = "";
let stdout: string[];
let stderr: string[];
let savedHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "gdrive-auth-streams-"));
  mkdirSync(join(home, ".config", "gdrive-cli"), { recursive: true });
  writeFileSync(
    join(home, ".config", "gdrive-cli", "client_secret.json"),
    JSON.stringify({ installed: { client_id: "id", client_secret: "secret" } }),
  );
  savedHome = process.env["HOME"];
  process.env["HOME"] = home;

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
  // A terminal on both, so the flow's gate is open and the format decides.
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = savedHome;
  if (home !== "") rmSync(home, { recursive: true, force: true });
});

async function run(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const program = createProgram();
  registerAuth(program);
  try {
    await program.parseAsync(["node", "gdrive", ...args]);
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
  }
  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

describe("gdrive auth, through the real registrar", () => {
  it("prints the consent URL on stderr", async () => {
    const out = await run(["auth"]);
    expect(out.stderr).toContain(oauth.authUrl);
    expect(out.stdout).not.toContain("accounts.google.com");
  });

  /**
   * The consequence that makes it worth moving: `-f json`'s envelope shares
   * stdout with nothing, so the whole of stdout parses. Before decision 0059
   * §1 the URL sat in front of it and nothing could read the result.
   */
  it("leaves stdout holding one parseable envelope", async () => {
    const out = await run(["-f", "text", "auth"]);
    expect(out.stdout).toBe("Authenticated as me@example.com (set as default account)\n");
  });

  it("refuses before printing anything when stderr is not a terminal", async () => {
    Object.defineProperty(process.stderr, "isTTY", { value: undefined, configurable: true });
    const out = await run(["auth"]);

    expect(out.stdout).toBe("");
    expect(out.stderr).not.toContain("accounts.google.com");
    expect(out.stderr).toContain("needs a terminal");
  });
});
