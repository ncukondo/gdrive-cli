import { describe, expect, it } from "vitest";
import { readInput } from "./input.ts";
import { AppError } from "../types/index.ts";

function fakeFs(files: Record<string, string>) {
  return {
    existsSync: (path: string) => path in files,
    readFileSync: (path: string) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path] as string;
    },
  };
}

const noStdin = () => {
  throw new Error("stdin should not be read");
};

describe("readInput", () => {
  it("passes through a literal string", async () => {
    const out = await readInput("hello world", { fs: fakeFs({}), readStdin: noStdin });
    expect(out).toBe("hello world");
  });

  it("reads @file via the injected fs", async () => {
    const out = await readInput("@/notes.txt", {
      fs: fakeFs({ "/notes.txt": "file body" }),
      readStdin: noStdin,
    });
    expect(out).toBe("file body");
  });

  it("reads '-' from the injected stdin", async () => {
    const out = await readInput("-", {
      fs: fakeFs({}),
      readStdin: () => "piped input",
    });
    expect(out).toBe("piped input");
  });

  it("awaits an async stdin reader", async () => {
    const out = await readInput("-", {
      fs: fakeFs({}),
      readStdin: () => Promise.resolve("async input"),
    });
    expect(out).toBe("async input");
  });

  it("throws IO_ERROR for a missing @file", async () => {
    await expect(
      readInput("@/missing.txt", { fs: fakeFs({}), readStdin: noStdin }),
    ).rejects.toMatchObject({ code: "IO_ERROR" });
  });

  it("throws an AppError (not a bare Error) for a missing @file", async () => {
    const err = await readInput("@/missing.txt", { fs: fakeFs({}), readStdin: noStdin }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AppError);
  });

  it("wraps stdin failures as IO_ERROR", async () => {
    await expect(
      readInput("-", {
        fs: fakeFs({}),
        readStdin: () => {
          throw new Error("broken pipe");
        },
      }),
    ).rejects.toMatchObject({ code: "IO_ERROR" });
  });

  it("treats a literal '@' with no path as a file read of empty path", async () => {
    // "@" alone → path "" which does not exist → IO_ERROR
    await expect(readInput("@", { fs: fakeFs({}), readStdin: noStdin })).rejects.toMatchObject({
      code: "IO_ERROR",
    });
  });
});
