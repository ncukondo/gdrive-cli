import { describe, expect, it } from "vitest";
import { stripNoise } from "./ts-source.js";

describe("stripNoise", () => {
  it("returns one entry per line, in order", () => {
    expect(stripNoise("a\nb\nc")).toHaveLength(3);
  });

  it("keeps code and drops a line comment", () => {
    const [line] = stripNoise("const n = pad(x); // padEnd is banned here");
    expect(line).toContain("pad(x)");
    expect(line).not.toContain("padEnd");
  });

  it("drops a block comment that spans lines", () => {
    const lines = stripNoise("/* padEnd\n   padStart */\nconst n = 1;");
    expect(lines[0]).not.toContain("padEnd");
    expect(lines[1]).not.toContain("padStart");
    expect(lines[2]).toContain("const n = 1;");
  });

  it("drops single-quoted, double-quoted and template contents", () => {
    for (const quote of ["'", '"', "`"]) {
      const [line] = stripNoise(`const s = ${quote}padEnd${quote};`);
      expect(line).not.toContain("padEnd");
      expect(line).toContain("const s =");
    }
  });

  it("does not end a string on an escaped quote", () => {
    const [line] = stripNoise(String.raw`const s = "a\"padEnd"; const t = 1;`);
    expect(line).not.toContain("padEnd");
    expect(line).toContain("const t = 1;");
  });

  it("keeps code that follows a closed block comment on the same line", () => {
    const [line] = stripNoise("/* padEnd */ const n = 1;");
    expect(line).not.toContain("padEnd");
    expect(line).toContain("const n = 1;");
  });

  it("treats a division as code rather than opening a comment", () => {
    const [line] = stripNoise("const half = total / 2;");
    expect(line).toContain("total / 2");
  });
});
