import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalOptions } from "./index.ts";
import {
  canPrompt,
  createProgram,
  documentFormat,
  encodingFormat,
  isEntryPoint,
  resolveGlobalOptions,
  handleError,
} from "./index.ts";
import { AppError, ExitCode } from "./types/index.ts";
import pkg from "../package.json" with { type: "json" };
import { ExitSignal, mockProcessExit } from "../tests/helpers/mock.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function parseArgs(args: string[]): GlobalOptions {
  const program = createProgram();
  program.parse(["node", "gdrive", ...args]);
  return resolveGlobalOptions(program);
}

describe("--version", () => {
  it("matches package.json version", () => {
    const program = createProgram();
    expect(program.version()).toBe(pkg.version);
  });
});

describe("global options", () => {
  /**
   * Decision 0036 §1: a command that is not told otherwise emits its machine
   * representation. This is 0007's own first paragraph — "the primary consumer
   * is an AI agent" — applied to the flag it never reached.
   *
   * "No config" has to mean the test machine's config too, so every place
   * `findConfigPath` looks is pointed at one empty directory: `$GDRIVE_CLI_CONFIG`
   * and the current directory are consulted before `$HOME`, and a developer with
   * either set would otherwise get `default_format` answering instead.
   */
  function withNoConfig<T>(body: () => T): T {
    const dir = mkdtempSync(join(tmpdir(), "gdrive-home-"));
    const cwd = process.cwd();
    vi.stubEnv("GDRIVE_CLI_FORMAT", "");
    vi.stubEnv("GDRIVE_CLI_CONFIG", "");
    vi.stubEnv("HOME", dir);
    process.chdir(dir);
    try {
      return body();
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  }

  it("--format defaults to json", () => {
    withNoConfig(() => {
      expect(parseArgs([]).format).toBe("json");
    });
  });

  it("accepts -f text", () => {
    expect(parseArgs(["-f", "text"]).format).toBe("text");
  });

  it("falls back to $GDRIVE_CLI_FORMAT when -f is absent", () => {
    vi.stubEnv("GDRIVE_CLI_FORMAT", "text");
    expect(parseArgs([]).format).toBe("text");
    expect(parseArgs(["-f", "json"]).format).toBe("json");
    vi.unstubAllEnvs();
  });

  it("falls back to default_format in the config, and -f still wins", () => {
    vi.stubEnv("GDRIVE_CLI_FORMAT", "");
    const dir = mkdtempSync(join(tmpdir(), "gdrive-cfg-"));
    const path = join(dir, "gdrive-cli.toml");
    writeFileSync(path, 'default_format = "text"\n');
    const jsonPath = join(dir, "json.toml");
    writeFileSync(jsonPath, 'default_format = "json"\n');
    try {
      expect(parseArgs(["--config", path]).format).toBe("text");
      expect(parseArgs(["--config", path, "-f", "json"]).format).toBe("json");
      expect(parseArgs(["--config", jsonPath, "-f", "text"]).format).toBe("text");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it("ignores an unreadable config when defaulting the format", () => {
    vi.stubEnv("GDRIVE_CLI_FORMAT", "");
    expect(parseArgs(["--config", "/nonexistent/gdrive-cli.toml"]).format).toBe("json");
    vi.unstubAllEnvs();
  });

  it("--quiet defaults to false and sets true with -q", () => {
    expect(parseArgs([]).quiet).toBe(false);
    expect(parseArgs(["-q"]).quiet).toBe(true);
    expect(parseArgs(["-q", "-f", "text"]).quiet).toBe(true);
  });

  /**
   * Decision 0038 §1: `-q` asks for the bare value, and it gets it whatever the
   * configured or built-in default is. A flag the default can switch off is not
   * a default, it is a bug — `gdrive ls -q` returning an envelope was one.
   */
  it("resolves -q to text whatever the unnamed default is", () => {
    withNoConfig(() => {
      expect(parseArgs(["-q"]).format).toBe("text");
    });
    vi.stubEnv("GDRIVE_CLI_FORMAT", "json");
    expect(parseArgs(["-q"]).format).toBe("text");
    vi.unstubAllEnvs();

    vi.stubEnv("GDRIVE_CLI_FORMAT", "");
    const dir = mkdtempSync(join(tmpdir(), "gdrive-quiet-"));
    const path = join(dir, "json.toml");
    writeFileSync(path, 'default_format = "json"\n');
    try {
      expect(parseArgs(["--config", path, "-q"]).format).toBe("text");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  /** Decision 0038 §2: a format the caller named beats an unnamed terseness. */
  it("yields to an explicit -f json, in either order", () => {
    withNoConfig(() => {
      expect(parseArgs(["-q", "-f", "json"]).format).toBe("json");
      expect(parseArgs(["-f", "json", "-q"]).format).toBe("json");
      expect(parseArgs(["-q", "-f", "text"]).format).toBe("text");
    });
  });

  /**
   * Decision 0005 stops `gdrive auth` prompting in JSON mode so automation gets
   * `AUTH_REQUIRED` rather than a hang. The question that rule is really asking
   * is *is a human present*, which the output format only ever approximated:
   * `GDRIVE_CLI_FORMAT=json` and `default_format = "json"` are how a CI
   * environment says nobody is, and with no terminal a prompt cannot be
   * answered whatever the format says.
   */
  function withStdin<T>(isTTY: boolean | undefined, body: () => T): T {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
    try {
      return body();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: original, configurable: true });
    }
  }

  it("allows a prompt only at a terminal, and never when -f json named the format", () => {
    withStdin(true, () => {
      withNoConfig(() => {
        expect(canPrompt(parseArgs([]))).toBe(true);
        expect(canPrompt(parseArgs(["-f", "text"]))).toBe(true);
        expect(canPrompt(parseArgs(["-q"]))).toBe(true);
        expect(canPrompt(parseArgs(["-f", "json"]))).toBe(false);
      });
      // A format the environment named, at a terminal: still a human to ask.
      vi.stubEnv("GDRIVE_CLI_FORMAT", "json");
      expect(canPrompt(parseArgs([]))).toBe(true);
      vi.unstubAllEnvs();
    });
  });

  it("refuses to prompt with no terminal, whatever the format is", () => {
    withStdin(undefined, () => {
      withNoConfig(() => {
        expect(canPrompt(parseArgs([]))).toBe(false);
        expect(canPrompt(parseArgs(["-f", "text"]))).toBe(false);
        expect(canPrompt(parseArgs(["-f", "json"]))).toBe(false);
      });
      vi.stubEnv("GDRIVE_CLI_FORMAT", "json");
      expect(canPrompt(parseArgs([]))).toBe(false);
      vi.unstubAllEnvs();
    });
  });

  /**
   * Decision 0038's rule generalised: a default applies where the caller
   * expressed no preference, and `--as csv` is a preference. Nobody types it
   * wanting an envelope, and `sheets read S --as csv > out.csv` writing JSON is
   * the same bug `--quiet` had.
   */
  it("lets a named --as select text, and yields to a named -f", () => {
    withNoConfig(() => {
      expect(encodingFormat(parseArgs([]), true)).toBe("text");
      expect(encodingFormat(parseArgs([]), false)).toBe("json");
      expect(encodingFormat(parseArgs(["-f", "json"]), true)).toBe("json");
      expect(encodingFormat(parseArgs(["-f", "text"]), true)).toBe("text");
    });
    vi.stubEnv("GDRIVE_CLI_FORMAT", "json");
    expect(encodingFormat(parseArgs([]), true)).toBe("text");
    expect(encodingFormat(parseArgs([]), false)).toBe("json");
    vi.unstubAllEnvs();
  });

  /**
   * Decision 0036 §1's other side: a command whose output *is* a document keeps
   * printing the document unless a format is named, so `forms read > form.yaml`
   * still writes YAML.
   */
  it("hands a document command text unless -f named the format", () => {
    withNoConfig(() => {
      expect(documentFormat(parseArgs([]))).toBe("text");
      expect(documentFormat(parseArgs(["-f", "json"]))).toBe("json");
      expect(documentFormat(parseArgs(["-f", "text"]))).toBe("text");
    });
    vi.stubEnv("GDRIVE_CLI_FORMAT", "json");
    expect(documentFormat(parseArgs([]))).toBe("text");
    expect(documentFormat(parseArgs(["-f", "json"]))).toBe("json");
    vi.unstubAllEnvs();
  });

  it("--account defaults to undefined and reads -a", () => {
    expect(parseArgs([]).account).toBeUndefined();
    expect(parseArgs(["-a", "work"]).account).toBe("work");
  });

  it("--config defaults to undefined and reads a path", () => {
    expect(parseArgs([]).config).toBeUndefined();
    expect(parseArgs(["--config", "/tmp/c.toml"]).config).toBe("/tmp/c.toml");
  });
});

describe("--help", () => {
  it("lists the global options", () => {
    const program = createProgram();
    const help = program.helpInformation();
    expect(help).toContain("--account");
    expect(help).toContain("--format");
    expect(help).toContain("--quiet");
    expect(help).toContain("--config");
  });
});

describe("unknown command", () => {
  it("exits with code 3", () => {
    const program = createProgram();
    const exitSpy = mockProcessExit();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(() => program.parse(["node", "gdrive", "nope"])).toThrow(ExitSignal);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.ARGUMENT);
  });
});

describe("format validation", () => {
  it("rejects an invalid format with exit code 3", () => {
    const exitSpy = mockProcessExit();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const program = createProgram();
    program.parse(["node", "gdrive", "--format", "xml"]);
    expect(() => resolveGlobalOptions(program)).toThrow(ExitSignal);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.ARGUMENT);
    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("invalid format");
  });
});

describe("isEntryPoint", () => {
  it("trusts import.meta.main when the runtime provides it", () => {
    expect(isEntryPoint("file:///whatever.js", undefined, true)).toBe(true);
    expect(isEntryPoint("file:///a.js", "/b.js", false)).toBe(false);
  });

  it("matches when the module is invoked by its own path", () => {
    const dir = mkdtempSync(join(tmpdir(), "gdrive-entry-"));
    const real = join(dir, "index.js");
    writeFileSync(real, "");
    try {
      expect(isEntryPoint(pathToFileURL(real).href, real)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("follows a symlink, as npm's node_modules/.bin link does", () => {
    const dir = mkdtempSync(join(tmpdir(), "gdrive-entry-"));
    const real = join(dir, "index.js");
    const link = join(dir, "gdrive");
    writeFileSync(real, "");
    symlinkSync(real, link);
    try {
      // The bug this guards: argv[1] is the link, import.meta.url is the target.
      expect(isEntryPoint(pathToFileURL(real).href, link)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is false with no argv[1] or for an unrelated path", () => {
    expect(isEntryPoint("file:///a.js", undefined)).toBe(false);
    expect(isEntryPoint("file:///a.js", "/nonexistent/b.js")).toBe(false);
  });
});

describe("handleError", () => {
  it("writes a text message to stderr and exits 1 for general errors", () => {
    const exitSpy = mockProcessExit();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(() => handleError(new Error("boom"), "text")).toThrow(ExitSignal);

    expect(stderrSpy.mock.calls.map((c) => c[0]).join("")).toContain("boom");
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GENERAL);
  });

  it("writes a JSON envelope to stderr for json format", () => {
    mockProcessExit();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(() => handleError(new AppError("AUTH_REQUIRED", "login first"), "json")).toThrow(
      ExitSignal,
    );

    const parsed = JSON.parse(stderrSpy.mock.calls.map((c) => c[0]).join(""));
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("AUTH_REQUIRED");
    expect(parsed.error.message).toBe("login first");
  });

  it("maps AppError codes to exit codes", () => {
    const exitSpy = mockProcessExit();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(() => handleError(new AppError("AUTH_REQUIRED", "x"), "text")).toThrow(ExitSignal);
    expect(exitSpy).toHaveBeenLastCalledWith(ExitCode.AUTH);

    expect(() => handleError(new AppError("INVALID_ARGS", "x"), "text")).toThrow(ExitSignal);
    expect(exitSpy).toHaveBeenLastCalledWith(ExitCode.ARGUMENT);

    expect(() => handleError(new AppError("NOT_FOUND", "x"), "text")).toThrow(ExitSignal);
    expect(exitSpy).toHaveBeenLastCalledWith(ExitCode.GENERAL);
  });
});
