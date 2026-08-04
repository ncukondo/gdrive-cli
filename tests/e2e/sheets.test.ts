import { beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { describeLive, gdrive, gdriveAs, LIVE_TIMEOUT, useSandbox } from "./helpers/sandbox.ts";

/**
 * What Sheets stores, as opposed to what was sent.
 *
 * `--input-mode` is the whole subject: RAW keeps a formula a string, and
 * `user` hands it to Sheets to evaluate. No fake can say which, because the
 * answer is Sheets'.
 */

const valuesSchema = z.object({ values: z.array(z.array(z.string())) });
const tabsSchema = z.object({ tabs: z.array(z.object({ title: z.string() })) });
const createdSchema = z.object({ id: z.string() });

describeLive("Sheets against a real account", () => {
  const sandbox = useSandbox();
  let sheetId = "";
  let tab = "";

  beforeAll(async () => {
    sheetId = (
      await gdriveAs(createdSchema, "sheets", "create", "Round trip", "--parent", sandbox.id)
    ).id;
    tab = (await gdriveAs(tabsSchema, "sheets", "tabs", sheetId)).tabs[0]?.title ?? "";
  }, LIVE_TIMEOUT);

  it(
    "reports at least one tab, and names it",
    () => {
      expect(tab).not.toBe("");
    },
    LIVE_TIMEOUT,
  );

  it(
    "stores a formula as text when nobody asked Sheets to read it",
    async () => {
      await gdrive("sheets", "write", sheetId, `${tab}!A1:C1`, "--values", '[["=1+1","42","x"]]');
      const read = await gdriveAs(valuesSchema, "sheets", "read", sheetId, `${tab}!A1:C1`);
      expect(read.values).toEqual([["=1+1", "42", "x"]]);
    },
    LIVE_TIMEOUT,
  );

  it(
    "evaluates the same formula when --input-mode user says to",
    async () => {
      await gdrive(
        "sheets",
        "write",
        sheetId,
        `${tab}!A2:C2`,
        "--values",
        '[["=1+1","42","x"]]',
        "--input-mode",
        "user",
      );
      const read = await gdriveAs(valuesSchema, "sheets", "read", sheetId, `${tab}!A2:C2`);
      expect(read.values[0]?.[0]).toBe("2");
    },
    LIVE_TIMEOUT,
  );

  it(
    "appends after the last row, not after the range it was given",
    async () => {
      const before = await gdriveAs(valuesSchema, "sheets", "read", sheetId, `${tab}!A1:C10`);
      await gdrive("sheets", "append", sheetId, `${tab}!A1:C1`, "--values", '[["appended"]]');
      const after = await gdriveAs(valuesSchema, "sheets", "read", sheetId, `${tab}!A1:C10`);

      expect(after.values).toHaveLength(before.values.length + 1);
      expect(after.values.at(-1)?.[0]).toBe("appended");
      expect(after.values.slice(0, before.values.length)).toEqual(before.values);
    },
    LIVE_TIMEOUT,
  );

  it(
    "clears the values and leaves the rest of the tab alone",
    async () => {
      await gdrive("sheets", "clear", sheetId, `${tab}!A1:C1`);
      const read = await gdriveAs(valuesSchema, "sheets", "read", sheetId, `${tab}!A1:C2`);
      expect(read.values[0]).toEqual([]);
      expect(read.values[1]?.[0]).toBe("2");
    },
    LIVE_TIMEOUT,
  );
});
