import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Which files each test command collects (issue #18).
 *
 * The thing that can be wrong here is a shell, so the test runs the collector
 * rather than reading a config: `vitest list --filesOnly` reports exactly the
 * set a run would execute, after globs, excludes and positional filters have
 * all been applied. Asserting on `package.json`'s text instead would be
 * asserting what the program is made of (`tests/CLAUDE.md`), and it would pass
 * on Windows in the state this task exists to fix — the quoting is *accepted*
 * there, it just does not mean what it says.
 *
 * These are slow for unit tests, ~2s each, which is why there are two of them
 * and not one per script.
 */

const listed = z.array(z.object({ file: z.string() }));

/** The files `vitest list` reports for `args`, repo-relative. */
function collects(args: string[]): string[] {
  // `bunx`, not `npx`. This is the one test in the suite guarding a defect that
  // only appears on Windows, and `npx` there is `npx.cmd`: `execFile` does no
  // PATHEXT resolution without a shell, and Node refuses to spawn a `.cmd`
  // outright since 18.20. So the guard would throw on the platform it exists
  // for. Nothing else in the repo shells out to npm either — `.husky/pre-commit`
  // uses `bunx`.
  //
  // `--json` takes an optional value, so anything positional has to come before
  // it or vitest reads the path as the file to write the list into.
  //
  // stderr is inherited rather than ignored: when the spawn itself fails, the
  // reason is the only useful thing there is.
  const raw = execFileSync("bunx", ["vitest", "list", ...args, "--filesOnly", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return listed
    .parse(JSON.parse(raw))
    .map(({ file }) => file.replace(`${process.cwd()}/`, ""))
    .sort();
}

/** What each script passes vitest, taken from `package.json` so they cannot drift. */
const scripts = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync("package.json", "utf8"))).scripts;

function argsOf(script: string): string[] {
  const command = scripts[script];
  if (command === undefined) throw new Error(`no script named ${script}`);
  return command
    .split(" ")
    .slice(1)
    .filter((arg) => arg !== "run");
}

describe("the test scripts collect what they claim", () => {
  /**
   * The live suite writes to a real Google account, so `bun run test` reaching
   * it is the failure this is here to prevent — the one decision 0038 removed
   * from CI and issue #18 says a Windows contributor would get back.
   */
  it("`test` collects the unit and integration suites and no live test", () => {
    const files = collects(argsOf("test"));
    expect(files.filter((f) => f.startsWith("tests/e2e/"))).toEqual([]);
    expect(files).toContain("src/index.test.ts");
    expect(files).toContain("tests/integration/failed-create.test.ts");
  });

  /**
   * And the other direction, which is the half a config-level exclude alone
   * would break: `test:e2e` has to still reach them.
   */
  it("`test:e2e` collects every live test and nothing else", () => {
    const files = collects(argsOf("test:e2e"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.startsWith("tests/e2e/"))).toBe(true);
  });

  /**
   * The rule, rather than one spelling of it. Every quoting style is a bet on
   * which shell runs the script, and `cmd.exe` loses the POSIX one — so the fix
   * is to give a shell nothing to interpret at all, not to quote differently.
   */
  /**
   * The two that select with a path rather than a config still select it.
   *
   * A vitest positional is a **substring match on the path**, not a directory —
   * so `vitest run src scripts` collects any test file whose path contains
   * either word. This file was called `test-scripts-collect.test.ts` until it
   * failed its own assertion here by being collected into `test:unit`. Nothing
   * is wrong with the scripts; the filter is just wider than it reads, and the
   * next file named after a directory will find the same thing.
   */
  it("`test:unit` and `test:integration` still reach their own directories", () => {
    const unit = collects(argsOf("test:unit"));
    expect(unit).toContain("src/index.test.ts");
    expect(unit.filter((f) => f.startsWith("tests/"))).toEqual([]);

    const integration = collects(argsOf("test:integration"));
    expect(integration.length).toBeGreaterThan(0);
    expect(integration.every((f) => f.startsWith("tests/integration/"))).toBe(true);
  });

  it("hands no script an argument a shell could disagree about", () => {
    for (const [name, command] of Object.entries(scripts)) {
      if (!name.startsWith("test")) continue;
      expect([name, command]).toEqual([name, expect.not.stringMatching(/['"*?]/)]);
    }
  });
});
