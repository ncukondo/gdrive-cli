import { describe, expect, it } from "vitest";
import { findWidthCalls } from "./lint-widths.js";

const scan = (source: string) => findWidthCalls([{ path: "src/x.ts", source }]);

describe("findWidthCalls", () => {
  it("finds a padEnd call with its line number", () => {
    const found = scan("const a = 1;\nconst row = name.padEnd(20);");
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(2);
    expect(found[0]?.identifier).toBe("padEnd");
  });

  it("finds padStart and stringWidth", () => {
    expect(scan("n.padStart(4);")[0]?.identifier).toBe("padStart");
    expect(scan("const w = Bun.stringWidth(s);")[0]?.identifier).toBe("stringWidth");
  });

  it("finds a width package imported by name, which lives in a string literal", () => {
    const found = scan(`import width from "eastasianwidth";`);
    expect(found).toHaveLength(1);
    expect(found[0]?.identifier).toBe("eastasianwidth");
  });

  it("finds a width package pulled in by require", () => {
    expect(scan(`const w = require("string-width");`)[0]?.identifier).toBe("string-width");
  });

  it("ignores the same word in a comment or a string", () => {
    expect(scan("// never call padEnd here")).toEqual([]);
    expect(scan("/* padStart is banned */")).toEqual([]);
    expect(scan(`throw new Error("no stringWidth");`)).toEqual([]);
  });

  it("does not match a longer identifier that merely contains one", () => {
    expect(scan("const padEndings = 1;")).toEqual([]);
    expect(scan("obj.unpadStart();")).toEqual([]);
  });

  it("reports the original line, not the stripped one", () => {
    const found = scan(`const row = name.padEnd(20); // aligns the id column`);
    expect(found[0]?.text).toContain("// aligns the id column");
  });

  it("reports every occurrence across files", () => {
    const found = findWidthCalls([
      { path: "src/a.ts", source: "x.padEnd(1);" },
      { path: "src/b.ts", source: "y.padStart(2);" },
    ]);
    expect(found.map((f) => f.file)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("finds nothing in a file that computes no width", () => {
    expect(scan("const cols = fields.join('\\t');")).toEqual([]);
  });
});

describe("the in-band exception", () => {
  it("skips a line that justifies itself", () => {
    expect(scan('const hh = String(h).padStart(2, "0"); // width: a number, not a column')).toEqual(
      [],
    );
  });

  it("still reports an unjustified one on the next line", () => {
    const found = scan("a.padEnd(4); // width: fine\nb.padEnd(4);");
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(2);
  });
});
