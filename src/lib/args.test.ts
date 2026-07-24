import { describe, expect, it } from "vitest";
import { AppError } from "../types/index.ts";
import { parseChoice } from "./args.ts";

type Color = "red" | "green";
const COLORS: Color[] = ["red", "green"];

describe("parseChoice", () => {
  it("returns the matching member of the set", () => {
    expect(parseChoice(COLORS, "red", "--color")).toBe("red");
    expect(parseChoice(COLORS, "green", "--color")).toBe("green");
  });

  it("rejects a value outside the set with the flag and the choices", () => {
    expect(() => parseChoice(COLORS, "blue", "--color")).toThrow(
      'Invalid --color "blue". Use: red, green.',
    );
  });

  it("rejects with INVALID_ARGS", () => {
    try {
      parseChoice(COLORS, "blue", "--color");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      if (error instanceof AppError) expect(error.code).toBe("INVALID_ARGS");
    }
  });

  it("does not match by coercion or prototype keys", () => {
    expect(() => parseChoice(COLORS, "toString", "--color")).toThrow("Invalid --color");
    expect(() => parseChoice(COLORS, "", "--color")).toThrow("Invalid --color");
  });
});
