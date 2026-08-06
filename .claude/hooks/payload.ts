/**
 * Reads a `PreToolUse` payload from stdin, or refuses.
 *
 * The default here is the whole point. A hook exits 0 to allow and 2 to block,
 * and every path that is not an explicit refusal falls through to 0 — so a
 * payload a shim cannot understand disables the guard silently. Empty stdin, a
 * non-object, a missing `tool_input`, a field of the wrong type: each is "this
 * cannot tell what is about to happen", and each used to pass.
 *
 * So reading is a refusal by default and returns a value only when the field is
 * there and is a string (decision 0047 §2 — the bypass belongs to a person, and
 * an unreadable payload is not a bypass, it is a blind guard).
 */
export function refuse(reason: string): never {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

/** The named string field of `tool_input`, or a refusal. */
export async function readToolInput(hook: string, fields: string[]): Promise<string> {
  let raw: string;
  try {
    raw = await Bun.stdin.text();
  } catch {
    refuse(`${hook}: could not read the hook payload. Refusing rather than passing (0047 §2).`);
  }
  if (raw.trim() === "") {
    refuse(`${hook}: the hook payload was empty, so it cannot tell what is about to happen.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    refuse(`${hook}: the hook payload is not JSON, so it cannot tell what is about to happen.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    refuse(`${hook}: the hook payload is not an object.`);
  }

  const input: unknown = (parsed as Record<string, unknown>)["tool_input"];
  if (typeof input !== "object" || input === null) {
    refuse(`${hook}: the hook payload carries no tool_input object.`);
  }

  for (const field of fields) {
    const value: unknown = (input as Record<string, unknown>)[field];
    if (typeof value === "string" && value !== "") return value;
    if (value !== undefined) {
      refuse(`${hook}: tool_input.${field} is not a string, so its target is unknown.`);
    }
  }
  refuse(`${hook}: tool_input names none of ${fields.join(", ")}, so its target is unknown.`);
}
