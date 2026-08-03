import {
  SHORTCUT_MIME,
  type DriveClient,
  type DriveFileRaw,
  type ListParams,
} from "../../src/lib/api.ts";

/** A node in the virtual Drive tree used by fakes. */
export interface DriveNode {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  /**
   * Makes this node a shortcut to the node with this id (decision 0025): the
   * MIME becomes the shortcut MIME and `targetMimeType` is read off the target,
   * so a test names the target and the fake stays consistent with the tree.
   * A node given the shortcut MIME *without* a target is the malformed response
   * 0025 §6 answers with `API_ERROR`.
   */
  target?: string;
  trashed?: boolean;
}

function unescape(value: string): string {
  return value.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function extractName(q: string): string | undefined {
  const [, name] = /name = '((?:[^'\\]|\\.)*)'/.exec(q) ?? [];
  return name === undefined ? undefined : unescape(name);
}

function extractParent(q: string): string | undefined {
  const [, parent] = /'((?:[^'\\]|\\.)*)' in parents/.exec(q) ?? [];
  return parent === undefined ? undefined : unescape(parent);
}

/** The shape `mapDriveError` reads: an Error carrying a numeric `code`. */
class FakeApiError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "FakeApiError";
    this.code = code;
  }
}

function notFound(fileId: string): FakeApiError {
  return new FakeApiError(404, `File not found: ${fileId}.`);
}

/**
 * Builds a {@link DriveClient} backed by an in-memory node tree. `files.list`
 * honors the `name = '…'` and `'…' in parents` clauses used by path resolution
 * and child listing, and `files.get` answers by id — 404 for an id the tree does
 * not hold, which is how a dangling shortcut is written. The remaining methods
 * throw unless overridden.
 *
 * `drives` supplies `drives.list`; omitting it leaves that method throwing,
 * which is itself a case worth testing (a `drive:` lookup the account cannot
 * make must not swallow the caller's real error).
 */
export function createTreeDrive(
  nodes: DriveNode[],
  drives?: { id: string; name: string }[],
): DriveClient {
  const mimeOf = (n: DriveNode): string =>
    n.mimeType ?? (n.target === undefined ? "application/octet-stream" : SHORTCUT_MIME);

  const toRaw = (n: DriveNode): DriveFileRaw => {
    const raw: DriveFileRaw = {
      id: n.id,
      name: n.name,
      mimeType: mimeOf(n),
      parents: n.parents ?? [],
      trashed: n.trashed ?? false,
    };
    if (n.target !== undefined) {
      const target = nodes.find((candidate) => candidate.id === n.target);
      raw.shortcutDetails = {
        targetId: n.target,
        targetMimeType: target === undefined ? "application/octet-stream" : mimeOf(target),
      };
    }
    return raw;
  };

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
      get: async ({ fileId }: { fileId: string }) => {
        const node = nodes.find((n) => n.id === fileId);
        if (node === undefined) throw notFound(fileId);
        return { data: toRaw(node) };
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
    drives: {
      list: async () => {
        if (drives === undefined) throw new Error("not implemented in tree fake");
        return { data: { drives } };
      },
      get: async ({ driveId }: { driveId: string }) => {
        const match = (drives ?? []).find((d) => d.id === driveId);
        if (match === undefined) throw new Error(`no such drive in tree fake: ${driveId}`);
        return { data: match };
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
