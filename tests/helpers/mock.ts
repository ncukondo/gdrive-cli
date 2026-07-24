import { vi } from "vitest";

/**
 * Test-side replacements for the assertions `noUncheckedIndexedAccess` and
 * `process.exit`'s `never` return used to force (decision 0015).
 */

/**
 * The arguments a `vi.fn()` was called with, typed from the mock itself.
 * Throws when the call never happened, which is the failure the old
 * `mock.calls[0]?.[0] as T` quietly turned into `undefined`.
 */
export function callArgs<A extends unknown[]>(fn: { mock: { calls: A[] } }, index = 0): A {
  const call = fn.mock.calls[index];
  if (call === undefined) {
    throw new Error(`expected the mock to have been called at least ${index + 1} time(s)`);
  }
  return call;
}

/** Thrown in place of a real exit; a mock that throws is genuinely `never`. */
export class ExitSignal extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`process.exit(${code})`);
    this.name = "ExitSignal";
    this.code = code;
  }
}

/**
 * Replaces `process.exit` with one that throws {@link ExitSignal}, so the
 * spy's implementation really does never return and callers can assert on the
 * code with `expect(...).toThrow(ExitSignal)`.
 */
export function mockProcessExit() {
  return vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ExitSignal(typeof code === "number" ? code : 0);
  });
}
