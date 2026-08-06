import { describe, expect, it, vi } from "vitest";
import { refuseTakenName, refuseUnaddressableName, refuseUnpathableName } from "./names.ts";
import { childrenNamed, ROOT_ID, resolvePath } from "./resolve-path.ts";
import { AppError } from "../types/index.ts";
import { createTreeDrive, createWritableTreeDrive } from "../../tests/helpers/fake-drive.ts";
import type { ListParams } from "./api.ts";

const none = async () => [];

/** A shared drive's root, and My Drive's own real root id: one shape, both. */
const DRIVE_ROOT = "0ABCDEFGHIJKLMNOPQR";
const SUBFOLDER = "1FoLdEr";

/**
 * Names a path loses **wherever the file sits** — the argument's trailing trim
 * eats the end of one, a `/` splits one, and an empty one is filtered away.
 */
const REFUSED_ANYWHERE = [
  ["Notes ", "the argument's own trim removes the trailing space"],
  [" Notes ", "trailing, whatever else is going on"],
  ["Q1/Q2", "the separator between one segment and the next"],
  ["/", "nothing but the separator"],
  ["", "there is no name"],
  ["   ", "nor here"],
] as const;

/**
 * Names a path loses **only at the top of a drive**, where the name is the whole
 * argument and the resolver reads the argument before it splits anything.
 *
 * One segment in front of them and every one is fine, which is the correction
 * decision 0056's Context records and the round trip below measures both ways.
 */
const REFUSED_AT_A_ROOT = [
  [" Notes", "a leading space, which only the first segment loses"],
  ["root", "a spelling of a drive's root"],
  ["1AbCdEfGhIjKlMnOpQrSt", "20 characters of id shape"],
  // The ordinary shape of a machine-made name, and the false refusal that sent
  // this rule back for a second draft. `Reports/Meeting_notes_2026_08` finds it
  // on a real account; only as a whole argument is it read as an id.
  ["Meeting_notes_2026_08", "21 word characters, no space and no slash"],
  [DRIVE_ROOT, "a drive root's own shape: `0A` and 17 more, 19 in all"],
  ["drive:Finance", "read as a shared drive name (decision 0019)"],
] as const;

/** Names that reach the file from anywhere, including each row's near miss. */
const ACCEPTED = [
  "Budget",
  "Q1 report",
  "a b.txt",
  "2026-01",
  "Q1\nreport",
  "Budget (2)",
  // 19 characters, one short of id-shaped and not starting `0A`.
  "AbCdEfGhIjKlMnOpQrS",
  // 18 characters starting `0A`: one short of a drive root's shape.
  "0ABCDEFGHIJKLMNOPQ",
  "drivelist",
  "root2",
];

/** Where a file can sit, and the path that names it there. */
const PLACES = {
  root: (name: string) => ({
    nodes: [{ id: "N1", name, parents: [ROOT_ID] }],
    path: name,
    parentId: ROOT_ID,
  }),
  subfolder: (name: string) => ({
    nodes: [
      { id: SUBFOLDER, name: "Reports", parents: [ROOT_ID] },
      { id: "N1", name, parents: [SUBFOLDER] },
    ],
    path: `Reports/${name}`,
    parentId: SUBFOLDER,
  }),
};

/**
 * Decision 0056 §2's sentence, run: give a file this name in this place, ask
 * `resolvePath` for it by the path that names it there, and answer whether the
 * file came back.
 */
async function resolverFindsIt(name: string, place: keyof typeof PLACES): Promise<boolean> {
  const { nodes, path } = PLACES[place](name);
  const client = createTreeDrive(nodes, []);
  const id = await resolvePath(client, path).catch(() => null);
  return id === "N1";
}

/** The refusal's own answer for the same name in the same place. */
function refusesIt(name: string, place: keyof typeof PLACES): boolean {
  try {
    refuseUnpathableName(name, PLACES[place](name).parentId);
    return false;
  } catch {
    return true;
  }
}

function messageFor(name: string, parentId: string | null, flag?: string): string {
  try {
    refuseUnpathableName(name, parentId, flag);
    return "";
  } catch (error: unknown) {
    return error instanceof AppError ? error.message : String(error);
  }
}

/**
 * The refusal and the resolver have to agree, name by name and place by place.
 * That is the whole of decision 0056 §2, and running it in *both* places is what
 * catches a check drawn wider than the harm — the first draft of this rule was,
 * and refused names that `Reports/<name>` finds perfectly well.
 */
describe("refuseUnpathableName", () => {
  it.each(ACCEPTED)(
    "accepts %j, which the resolver brings back from either place",
    async (name) => {
      expect(await resolverFindsIt(name, "root")).toBe(true);
      expect(await resolverFindsIt(name, "subfolder")).toBe(true);
      expect(refusesIt(name, "root")).toBe(false);
      expect(refusesIt(name, "subfolder")).toBe(false);
    },
  );

  it.each(REFUSED_ANYWHERE)("refuses %j everywhere — %s", async (name) => {
    expect(await resolverFindsIt(name, "root")).toBe(false);
    expect(await resolverFindsIt(name, "subfolder")).toBe(false);
    expect(refusesIt(name, "root")).toBe(true);
    expect(refusesIt(name, "subfolder")).toBe(true);
    // And with no folder known yet, which is `rename` before its walk.
    expect(messageFor(name, null)).not.toBe("");
  });

  it.each(REFUSED_AT_A_ROOT)("refuses %j at a drive root but not below it — %s", async (name) => {
    expect(await resolverFindsIt(name, "root")).toBe(false);
    expect(refusesIt(name, "root")).toBe(true);

    // The other half, and the one a stricter rule got wrong: one segment in
    // front and the resolver has no trouble at all, so nothing may refuse it.
    expect(await resolverFindsIt(name, "subfolder")).toBe(true);
    expect(refusesIt(name, "subfolder")).toBe(false);
    expect(messageFor(name, null)).toBe("");
  });

  /**
   * A shared drive's root is spelled `drive:Finance/<name>`, so the name is not
   * the first segment there and these six would in fact be reachable. They are
   * refused anyway, because `files.get('root')` answers with an id of exactly a
   * shared drive root's shape — the two roots cannot be told apart from the id,
   * and `rename` sees a top-level file's parent only as that real id. Refusing
   * is the side that never loses a file; the cost is a name a shared drive's
   * root would have carried.
   */
  it.each(REFUSED_AT_A_ROOT)("refuses %j at a shared drive's root too", (name) => {
    expect(messageFor(name, DRIVE_ROOT)).not.toBe("");
  });

  it("says which reading swallowed the name, not just that one did", () => {
    // Six inputs, six reasons: a message naming the class rather than the fault
    // would leave a caller guessing which character to change.
    const inputs = ["", " Notes", "Q1/Q2", "root", "1AbCdEfGhIjKlMnOpQrSt", "drive:Finance"];
    const reasons = new Set(inputs.map((n) => messageFor(n, ROOT_ID).replace(n, "<name>")));
    expect(reasons.size).toBe(inputs.length);
  });

  /**
   * The messages for the root-only readings have to say *where* they bite. One
   * that claimed a path could never find the file would be false — `Reports/root`
   * finds it — and this file's own tables are what prove it false.
   */
  it.each(REFUSED_AT_A_ROOT)("says where the refusal of %j applies", (name) => {
    expect(messageFor(name, ROOT_ID)).toContain("subfolder");
  });

  it.each(REFUSED_ANYWHERE)("does not claim the refusal of %j is local to a root", (name) => {
    expect(messageFor(name, ROOT_ID)).not.toContain("subfolder");
  });

  it.each([...REFUSED_ANYWHERE, ...REFUSED_AT_A_ROOT])(
    "names a replacement for %j that is itself accepted",
    (name) => {
      const message = messageFor(name, ROOT_ID);
      const quoted = /"([^"]*)"[^"]*$/.exec(message)?.[1] ?? "";
      if (name.trim() === "") return; // nothing near an empty name to suggest
      expect(quoted).not.toBe(name);
      // Run back through the check it came from, so a message can never propose
      // a name that would be refused in turn.
      expect(messageFor(quoted, ROOT_ID)).toBe("");
    },
  );

  it("offers the replacement through the flag that carries a name, when there is one", () => {
    expect(messageFor("Notes ", ROOT_ID, "--name")).toContain('--name "Notes"');
  });
});

describe("refuseTakenName", () => {
  const check = (overrides: Partial<Parameters<typeof refuseTakenName>[0]> = {}) => ({
    name: "Budget",
    parentId: "FOLDER",
    findSiblings: none,
    ...overrides,
  });

  it("accepts a name nothing in the folder holds", async () => {
    await expect(refuseTakenName(check())).resolves.toBeUndefined();
  });

  it("refuses a name a sibling already holds, naming it and what to pass instead", async () => {
    await expect(
      refuseTakenName(
        check({
          where: "Reports",
          flag: "--name",
          findSiblings: async () => [{ id: "B1", name: "Budget" }],
        }),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_ARGS",
      message: expect.stringContaining("B1"),
    });
  });

  it("looks in the folder it was given, under the name it was given", async () => {
    const findSiblings = vi.fn(none);
    await refuseTakenName(check({ name: "Budget", parentId: "FOLDER", findSiblings }));
    expect(findSiblings).toHaveBeenCalledWith("FOLDER", "Budget");
  });

  /** Renaming a file to the name it already has is a no-op, not a collision. */
  it("does not count the file being named as its own collision", async () => {
    await expect(
      refuseTakenName(
        check({ selfId: "B1", findSiblings: async () => [{ id: "B1", name: "Budget" }] }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("refuseUnaddressableName", () => {
  it("decides an unpathable name without asking Drive anything", async () => {
    const findSiblings = vi.fn(none);
    await expect(
      refuseUnaddressableName({ name: "Notes ", parentId: "FOLDER", findSiblings }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(findSiblings).not.toHaveBeenCalled();
  });

  it("asks about a name that survives a path", async () => {
    const findSiblings = vi.fn(none);
    await refuseUnaddressableName({ name: "Notes", parentId: "FOLDER", findSiblings });
    expect(findSiblings).toHaveBeenCalledWith("FOLDER", "Notes");
  });
});

/**
 * The lookup the refusal is wired to is the one a path walk itself does
 * ({@link childrenNamed}), so what a sibling *is* cannot drift from what a path
 * would match. These pin the request that leaves, not the fake's answer to it.
 */
describe("the sibling lookup", () => {
  function recorder(): { client: Parameters<typeof childrenNamed>[0]; params: ListParams[] } {
    const params: ListParams[] = [];
    const { client } = createWritableTreeDrive([]);
    return {
      params,
      client: {
        ...client,
        files: {
          ...client.files,
          list: async (p: ListParams) => {
            params.push(p);
            return client.files.list(p);
          },
        },
      },
    };
  }

  it("asks for exactly the entries a path segment would match", async () => {
    const { client, params } = recorder();
    await childrenNamed(client, "FOLDER", "Budget");
    expect(params).toHaveLength(1);
    expect(params[0]?.q).toBe("name = 'Budget' and 'FOLDER' in parents and trashed = false");
    expect(params[0]?.supportsAllDrives).toBe(true);
    expect(params[0]?.includeItemsFromAllDrives).toBe(true);
  });

  it("escapes a name that would otherwise close the query's own quote", async () => {
    const { client, params } = recorder();
    await childrenNamed(client, "FOLDER", "Bob's");
    expect(params[0]?.q).toBe("name = 'Bob\\'s' and 'FOLDER' in parents and trashed = false");
  });

  /** A file in the trash is not in the folder, and a path never matches one. */
  it("does not see a trashed file as a sibling", async () => {
    const { client } = createWritableTreeDrive([
      { id: "B1", name: "Budget", parents: ["FOLDER"], trashed: true },
    ]);
    expect(await childrenNamed(client, "FOLDER", "Budget")).toEqual([]);
  });

  /** A shortcut is an entry in the folder, so it takes the name like anything else. */
  it("sees a shortcut as a sibling", async () => {
    const { client } = createWritableTreeDrive([
      { id: "T1", name: "Target", parents: ["OTHER"] },
      { id: "L1", name: "Budget", parents: ["FOLDER"], target: "T1" },
    ]);
    expect(await childrenNamed(client, "FOLDER", "Budget")).toMatchObject([{ id: "L1" }]);
  });

  /**
   * `root` is an alias, not an id — the same alias a path walk starts from, so
   * the folder a caller spells `/` is the folder the refusal looks in.
   */
  it("reaches the My Drive root by the alias a path walk uses", async () => {
    const { client, params } = recorder();
    await childrenNamed(client, ROOT_ID, "Budget");
    expect(params[0]?.q).toContain("'root' in parents");
  });
});
