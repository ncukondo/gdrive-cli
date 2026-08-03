import { describe, expect, it } from "vitest";
import {
  formatJsonSuccess,
  formatJsonError,
  formatRow,
  formatTable,
  renderSuccess,
  renderError,
} from "./output.ts";
import type { ErrorCode } from "../types/index.ts";
import { errorToExit, ExitCode } from "../types/index.ts";

describe("formatJsonSuccess", () => {
  it("wraps data in a success envelope", () => {
    const parsed = JSON.parse(formatJsonSuccess({ id: "abc" }));
    expect(parsed).toEqual({ success: true, data: { id: "abc" } });
  });
});

describe("formatJsonError", () => {
  it("wraps code and message in an error envelope", () => {
    const parsed = JSON.parse(formatJsonError("NOT_FOUND", "missing"));
    expect(parsed).toEqual({ success: false, error: { code: "NOT_FOUND", message: "missing" } });
  });
});

/**
 * Drive accepts a name containing a newline — one was created to confirm it —
 * and a line-oriented format cannot carry one. Text mode is lossy on purpose
 * (decision 0036 §2); what it may not do is let a value invent a field or a row
 * that no record ever had.
 */
describe("a value cannot forge a field or a row", () => {
  it.each([
    ["a tab", "one\ttwo"],
    ["a newline", "one\ntwo"],
    ["a carriage return", "one\rtwo"],
    ["a line separator", "one\u2028two"],
    ["a paragraph separator", "one\u2029two"],
    ["a NUL", "one\u0000two"],
  ])("replaces %s in a field with a space", (_label, value) => {
    const row = formatRow(["a", value, "b"]);
    expect(row.split("\n")).toHaveLength(1);
    expect(row.split("\t")).toEqual(["a", "one two", "b"]);
  });

  it("keeps a table's row count equal to its record count", () => {
    const table = formatTable(
      ["Name", "ID"],
      [
        ["one\ntwo", "id1"],
        ["three", "id2"],
      ],
    );
    expect(table.split("\n")).toHaveLength(3);
  });

  it("leaves everything else exactly as it was given", () => {
    expect(formatRow(["研修医へのフィードバックシート", "❤️ 👍🏽", "  spaced  "])).toBe(
      "研修医へのフィードバックシート\t❤️ 👍🏽\t  spaced  ",
    );
  });
});

describe("renderSuccess", () => {
  const r = { data: { id: "abc" }, text: "human text", quiet: "abc" };

  it("returns human text in text mode", () => {
    expect(renderSuccess(r, "text", false)).toBe("human text");
  });

  it("returns the quiet variant in text mode when quiet", () => {
    expect(renderSuccess(r, "text", true)).toBe("abc");
  });

  it("falls back to text when no quiet variant is given", () => {
    expect(renderSuccess({ data: {}, text: "only text" }, "text", true)).toBe("only text");
  });

  it("returns the JSON envelope in json mode", () => {
    expect(JSON.parse(renderSuccess(r, "json", false))).toEqual({
      success: true,
      data: { id: "abc" },
    });
  });

  it("ignores --quiet in json mode", () => {
    expect(renderSuccess(r, "json", true)).toBe(renderSuccess(r, "json", false));
  });
});

describe("renderError", () => {
  it("returns a text line in text mode", () => {
    expect(renderError("API_ERROR", "boom", "text")).toBe("Error: boom\n");
  });

  it("returns a JSON envelope in json mode", () => {
    expect(JSON.parse(renderError("AUTH_REQUIRED", "login", "json"))).toEqual({
      success: false,
      error: { code: "AUTH_REQUIRED", message: "login" },
    });
  });
});

describe("errorToExit", () => {
  const cases: [ErrorCode, number][] = [
    ["AUTH_REQUIRED", ExitCode.AUTH],
    ["AUTH_EXPIRED", ExitCode.AUTH],
    ["ACCOUNT_NOT_FOUND", ExitCode.AUTH],
    ["NOT_FOUND", ExitCode.GENERAL],
    ["API_ERROR", ExitCode.GENERAL],
    ["CONFIG_ERROR", ExitCode.GENERAL],
    ["IO_ERROR", ExitCode.GENERAL],
    ["INVALID_ARGS", ExitCode.ARGUMENT],
  ];
  it.each(cases)("maps %s to exit %i", (code, exit) => {
    expect(errorToExit(code)).toBe(exit);
  });
});
