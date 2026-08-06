import { describe, expect, it, vi } from "vitest";
import { refuseTakenName, refuseUnaddressableName, refuseUnpathableName } from "./names.ts";
import { childrenNamed, ROOT_ID, resolvePath } from "./resolve-path.ts";
import { AppError } from "../types/index.ts";
import { createWritableTreeDrive } from "../../tests/helpers/fake-drive.ts";
import type { ListParams } from "./api.ts";

const none = async () => [];

describe("refuseUnpathableName", () => {
  it("accepts a name a path argument reaches unchanged", () => {
    for (const name of ["Budget", "Q1 report", "a b.txt", "2026-01"]) {
      expect(() => refuseUnpathableName(name)).not.toThrow();
    }
  });

  /**
   * The refusal exists because of what `resolve-path.ts` does, so the harm is
   * measured there rather than described: a file really given one of these
   * names is not found by the name it was just given.
   */
  it.each([" Notes", "Notes ", " Notes ", "Q1/Q2"])(
    "refuses %j, which resolve-path cannot then find",
    async (name) => {
      const { client } = createWritableTreeDrive([{ id: "N1", name, parents: [ROOT_ID] }]);
      await expect(resolvePath(client, name)).rejects.toBeInstanceOf(AppError);

      expect(() => refuseUnpathableName(name)).toThrowError(
        expect.objectContaining({ code: "INVALID_ARGS" }),
      );
    },
  );

  it("refuses a name that is empty or only whitespace", () => {
    for (const name of ["", "   ", "\t\n"]) {
      expect(() => refuseUnpathableName(name)).toThrowError(
        expect.objectContaining({ code: "INVALID_ARGS" }),
      );
    }
  });

  it("names a replacement that would be accepted", () => {
    const cases = [" Notes ", "Q1/Q2"];
    for (const name of cases) {
      const error = (() => {
        try {
          refuseUnpathableName(name);
          return null;
        } catch (e: unknown) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(AppError);
      const quoted = /"([^"]*)"[^"]*$/.exec(String(error))?.[1] ?? "";
      expect(quoted).not.toBe(name);
      expect(() => refuseUnpathableName(quoted)).not.toThrow();
    }
  });

  it("offers the replacement through the flag that carries a name, when there is one", () => {
    expect(() => refuseUnpathableName("Notes ", "--name")).toThrow(/--name "Notes"/);
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
