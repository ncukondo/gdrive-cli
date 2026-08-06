import { describe, expect, it } from "vitest";
import {
  formatJsonSuccess,
  formatJsonError,
  formatRow,
  formatTable,
  formatValues,
  line,
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
 * Decision 0031 §4. A failure that changed something says so in `data`, and a
 * failure that changed nothing renders exactly the two-key object every caller
 * written against decision 0007 already parses — the field is additive, so
 * `data === undefined` and "no such key" have to stay the same thing.
 */
describe("a failure that changed something", () => {
  const data = {
    payload: { folders: [{ src: "1F", dst: "1Z", name: "2026" }] },
    text: "Copied 1 folder and 2 files.",
    quiet: "1Z\n1X\n1Y",
  };

  it("carries the payload as the envelope's data", () => {
    const parsed = JSON.parse(formatJsonError("PERMISSION_DENIED", "denied", data));
    expect(parsed).toEqual({
      success: false,
      error: { code: "PERMISSION_DENIED", message: "denied" },
      data: { folders: [{ src: "1F", dst: "1Z", name: "2026" }] },
    });
  });

  it("emits no data key at all when nothing was changed", () => {
    expect(Object.keys(JSON.parse(formatJsonError("NOT_FOUND", "missing")))).toEqual([
      "success",
      "error",
    ]);
    expect(Object.keys(JSON.parse(renderError("NOT_FOUND", "missing", "json").stderr))).toEqual([
      "success",
      "error",
    ]);
  });

  it("prints the failure and then the summary in text mode", () => {
    expect(renderError("PERMISSION_DENIED", "denied", "text", false, data)).toEqual({
      stderr: "Error: denied\nCopied 1 folder and 2 files.\n",
      stdout: "",
    });
  });

  /**
   * The ids go to **stdout**, which is the difference between a value a shell
   * can capture and one it cannot: `-q` is "minimal text for piping"
   * (decision 0007) read by `$(…)` or by a pipe (0038 §1), and both take
   * stdout. The reason still goes to stderr, in every mode, because a caller
   * reading stderr is owed it.
   */
  it("prints the ids one per line on stdout when quiet, and the reason on stderr", () => {
    expect(renderError("PERMISSION_DENIED", "denied", "text", true, data)).toEqual({
      stderr: "Error: denied\n",
      stdout: "1Z\n1X\n1Y\n",
    });
  });

  it("prints the failure alone when the data has no text for this mode", () => {
    const bare = { payload: { plan: [] } };
    expect(renderError("PRUNE_REQUIRED", "refused", "text", false, bare)).toEqual({
      stderr: "Error: refused\n",
      stdout: "",
    });
    expect(renderError("PRUNE_REQUIRED", "refused", "text", true, bare)).toEqual({
      stderr: "Error: refused\n",
      stdout: "",
    });
  });

  it("ignores --quiet in json mode, as every other envelope does", () => {
    expect(renderError("PERMISSION_DENIED", "denied", "json", true, data)).toEqual(
      renderError("PERMISSION_DENIED", "denied", "json", false, data),
    );
    expect(renderError("PERMISSION_DENIED", "denied", "json", true, data).stdout).toBe("");
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

  /**
   * A table is not the only thing a name can break. The one-line confirmations
   * — `Created folder <name> (<id>)` and its kin — interpolate a name Drive
   * chose, and a newline there prints two lines where a caller reads one.
   */
  it("keeps a value interpolated into a message on one line", () => {
    const message = line`Created folder ${"Q1\nreport"} (${"F1"})`;
    expect(message).toBe("Created folder Q1 report (F1)");
    expect(message.split("\n")).toHaveLength(1);
  });

  /**
   * The other field of `Renderable`. `--quiet` is one value per line, so its
   * line count has to equal its value count — otherwise a caller piping it into
   * `wc -l` or a `for` loop reads more records than exist.
   */
  it("keeps a quiet list's line count equal to its value count", () => {
    expect(formatValues(["a", "b\nc", "d"]).split("\n")).toHaveLength(3);
    expect(formatValues(["a", "b\nc", "d"])).toBe("a\nb c\nd");
    expect(formatValues([])).toBe("");
    expect(formatValues(["only"])).toBe("only");
  });

  /** `share link` prints two lines on purpose; only the values are sanitised. */
  it("leaves a newline the message itself asked for", () => {
    expect(line`Anyone with the link (${"writer"})\n${"https://x/\ny"}`).toBe(
      "Anyone with the link (writer)\nhttps://x/ y",
    );
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
  it("returns a text line in text mode, and nothing for stdout", () => {
    expect(renderError("API_ERROR", "boom", "text")).toEqual({
      stderr: "Error: boom\n",
      stdout: "",
    });
  });

  it("returns a JSON envelope in json mode", () => {
    expect(JSON.parse(renderError("AUTH_REQUIRED", "login", "json").stderr)).toEqual({
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
