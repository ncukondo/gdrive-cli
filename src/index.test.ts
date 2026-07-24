import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalOptions } from "./index.ts";
import { createProgram, resolveGlobalOptions, handleError } from "./index.ts";
import { AppError, ExitCode } from "./types/index.ts";
import pkg from "../package.json" with { type: "json" };

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
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    program.parse(["node", "gdrive", "nope"]);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.ARGUMENT);
  });
});

describe("format validation", () => {
  it("rejects an invalid format with exit code 3", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const program = createProgram();
    program.parse(["node", "gdrive", "--format", "xml"]);
    resolveGlobalOptions(program);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.ARGUMENT);
    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("invalid format");
  });
});

describe("handleError", () => {
  it("writes a text message to stderr and exits 1 for general errors", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    handleError(new Error("boom"), "text");

    expect(stderrSpy.mock.calls.map((c) => c[0]).join("")).toContain("boom");
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GENERAL);
  });

  it("writes a JSON envelope to stderr for json format", () => {
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    handleError(new AppError("AUTH_REQUIRED", "login first"), "json");

    const parsed = JSON.parse(stderrSpy.mock.calls.map((c) => c[0]).join(""));
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("AUTH_REQUIRED");
    expect(parsed.error.message).toBe("login first");
  });

  it("maps AppError codes to exit codes", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    handleError(new AppError("AUTH_REQUIRED", "x"), "text");
    expect(exitSpy).toHaveBeenLastCalledWith(ExitCode.AUTH);

    handleError(new AppError("INVALID_ARGS", "x"), "text");
    expect(exitSpy).toHaveBeenLastCalledWith(ExitCode.ARGUMENT);

    handleError(new AppError("NOT_FOUND", "x"), "text");
    expect(exitSpy).toHaveBeenLastCalledWith(ExitCode.GENERAL);
  });
});
