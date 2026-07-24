import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalOptions } from "./index.ts";
import { createProgram, isEntryPoint, resolveGlobalOptions, handleError } from "./index.ts";
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
  it("--format defaults to text", () => {
    expect(parseArgs([]).format).toBe("text");
  });

  it("accepts -f json", () => {
    expect(parseArgs(["-f", "json"]).format).toBe("json");
  });

  it("falls back to $GDRIVE_CLI_FORMAT when -f is absent", () => {
    vi.stubEnv("GDRIVE_CLI_FORMAT", "json");
    expect(parseArgs([]).format).toBe("json");
    expect(parseArgs(["-f", "text"]).format).toBe("text");
    vi.unstubAllEnvs();
  });

  it("falls back to default_format in the config", () => {
    vi.stubEnv("GDRIVE_CLI_FORMAT", "");
    const dir = mkdtempSync(join(tmpdir(), "gdrive-cfg-"));
    const path = join(dir, "gdrive-cli.toml");
    writeFileSync(path, 'default_format = "json"\n');
    try {
      expect(parseArgs(["--config", path]).format).toBe("json");
      expect(parseArgs(["--config", path, "-f", "text"]).format).toBe("text");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it("ignores an unreadable config when defaulting the format", () => {
    vi.stubEnv("GDRIVE_CLI_FORMAT", "");
    expect(parseArgs(["--config", "/nonexistent/gdrive-cli.toml"]).format).toBe("text");
    vi.unstubAllEnvs();
  });

  it("--quiet defaults to false and sets true with -q", () => {
    expect(parseArgs([]).quiet).toBe(false);
    expect(parseArgs(["-q"]).quiet).toBe(true);
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
