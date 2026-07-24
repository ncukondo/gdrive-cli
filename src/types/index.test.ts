import { describe, expect, it } from "vitest";
import { AppError, ExitCode, errorToCode, errorToExit } from "./index.ts";

describe("errorToCode", () => {
  it("returns an AppError's own code", () => {
    expect(errorToCode(new AppError("AUTH_EXPIRED", "x"))).toBe("AUTH_EXPIRED");
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
});
