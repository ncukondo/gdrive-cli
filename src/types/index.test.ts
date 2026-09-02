import { describe, expect, it } from "vitest";
import { AppError, ExitCode, errorToCode, errorToExit } from "./index.ts";

describe("errorToCode", () => {
  it("returns an AppError's own code", () => {
    expect(errorToCode(new AppError("AUTH_EXPIRED", "x"))).toBe("AUTH_EXPIRED");
    expect(errorToCode(new AppError("PERMISSION_DENIED", "x"))).toBe("PERMISSION_DENIED");
  });

  it("falls back to API_ERROR for a non-ErrorCode string code", () => {
    const err = Object.assign(new Error("nope"), { code: "ENOENT" });
    expect(errorToCode(err)).toBe("API_ERROR");
  });

  it("falls back to API_ERROR for a numeric code, as googleapis throws", () => {
    const err = Object.assign(new Error("nope"), { code: 404 });
    expect(errorToCode(err)).toBe("API_ERROR");
  });

  it("falls back to API_ERROR for a code-less error or a non-Error throw", () => {
    expect(errorToCode(new Error("plain"))).toBe("API_ERROR");
    expect(errorToCode("just a string")).toBe("API_ERROR");
    expect(errorToCode(undefined)).toBe("API_ERROR");
  });

  it("ignores a prototype key masquerading as a code", () => {
    const err = Object.assign(new Error("nope"), { code: "toString" });
    expect(errorToCode(err)).toBe("API_ERROR");
  });
});

describe("errorToExit", () => {
  it("maps auth codes to 2 and argument errors to 3", () => {
    expect(errorToExit("AUTH_REQUIRED")).toBe(ExitCode.AUTH);
    expect(errorToExit("INVALID_ARGS")).toBe(ExitCode.ARGUMENT);
    expect(errorToExit("API_ERROR")).toBe(ExitCode.GENERAL);
  });

  it("keeps PERMISSION_DENIED out of the re-authenticate family (decision 0017)", () => {
    expect(errorToExit("PERMISSION_DENIED")).toBe(ExitCode.GENERAL);
  });

  /**
   * A refused deletion is an argument problem — confirm the intent and re-run
   * with a flag — not a malformed document, so 0028 §3 gives it its own code in
   * the same exit bucket as `INVALID_ARGS` rather than overloading that one.
   */
  /**
   * `docs/commands.md` promises exit 3 for this one in two places, and the map
   * is a plain object — a wrong value is a working program with a broken
   * promise, which nothing else here would notice (decision 0060 §4).
   */
  it("puts LISTING_INCOMPLETE in the argument bucket: the next action is the caller's", () => {
    expect(errorToExit("LISTING_INCOMPLETE")).toBe(ExitCode.ARGUMENT);
    expect(errorToCode(new AppError("LISTING_INCOMPLETE", "x"))).toBe("LISTING_INCOMPLETE");
  });

  it("puts PRUNE_REQUIRED in the argument bucket, distinct from INVALID_ARGS", () => {
    expect(errorToExit("PRUNE_REQUIRED")).toBe(ExitCode.ARGUMENT);
    expect(errorToCode(new AppError("PRUNE_REQUIRED", "x"))).toBe("PRUNE_REQUIRED");
  });
});
