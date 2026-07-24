import type { DriveClient, DriveFileRaw, ListParams } from "../../src/lib/api.ts";

/** A node in the virtual Drive tree used by fakes. */
export interface DriveNode {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
}

function unescape(value: string): string {
  return value.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function extractName(q: string): string | undefined {
  const m = /name = '((?:[^'\\]|\\.)*)'/.exec(q);
  return m ? unescape(m[1] as string) : undefined;
}

function extractParent(q: string): string | undefined {
  const m = /'((?:[^'\\]|\\.)*)' in parents/.exec(q);
  return m ? unescape(m[1] as string) : undefined;
}

/**
 * Builds a {@link DriveClient} backed by an in-memory node tree. `files.list`
 * honors the `name = '…'` and `'…' in parents` clauses used by path resolution
 * and child listing. Other methods throw unless overridden — resolve-path and
 * listing tests only exercise `files.list`.
 */
export function createTreeDrive(nodes: DriveNode[]): DriveClient {
  const toRaw = (n: DriveNode): DriveFileRaw => ({
    id: n.id,
    name: n.name,
    mimeType: n.mimeType ?? "application/octet-stream",
    parents: n.parents ?? [],
  });

  return {
    files: {
      list: async (params: ListParams) => {
        const q = params.q ?? "";
        const name = extractName(q);
        const parent = extractParent(q);
        const matches = nodes.filter((n) => {
          if (name !== undefined && n.name !== name) return false;
          if (parent !== undefined && !(n.parents ?? []).includes(parent)) return false;
          return true;
        });
        return { data: { files: matches.map(toRaw) } };
      },
      get: async () => {
        throw new Error("not implemented in tree fake");
      },
      create: async () => {
        throw new Error("not implemented in tree fake");
      },
      copy: async () => {
        throw new Error("not implemented in tree fake");
      },
      update: async () => {
        throw new Error("not implemented in tree fake");
      },
      delete: async () => {
        throw new Error("not implemented in tree fake");
      },
      export: async () => {
        throw new Error("not implemented in tree fake");
      },
    },
    permissions: {
      list: async () => {
        throw new Error("not implemented in tree fake");
      },
      create: async () => {
        throw new Error("not implemented in tree fake");
      },
      update: async () => {
        throw new Error("not implemented in tree fake");
      },
      delete: async () => {
        throw new Error("not implemented in tree fake");
      },
    },
  };
}
