import {
  FOLDER_MIME,
  SHORTCUT_MIME,
  type DriveClient,
  type DriveFileRaw,
  type FileCreateBody,
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

/**
 * A googleapis error as Drive actually sends one: an `Error` with the HTTP
 * status on `code`, and the untyped body `mapDriveError` reads its reasons out
 * of. A test that wants a rate limit has to spell it the way Drive does, so the
 * classification is exercised rather than assumed.
 */
export function driveApiError(status: number, message: string, reason?: string): Error {
  const error = new FakeApiError(status, message);
  if (reason === undefined) return error;
  return Object.assign(error, {
    response: { data: { error: { errors: [{ reason }] } } },
  });
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

/** One call the walk made, in the order it made it. */
export interface FakeCall {
  method: "list" | "create" | "copy";
  /** The folder listed, the parent created into, or the file copied. */
  id: string;
  /** How many times this exact call has been made, from 1 — what a retry test counts. */
  attempt: number;
}

export interface WritableTreeDrive {
  client: DriveClient;
  /** The tree as it stands, source nodes and everything the fake created. */
  nodes: DriveNode[];
  calls: FakeCall[];
  /** `<method>:<id>` for each call, which is what an order assertion reads. */
  trace: () => string[];
}

export interface WritableTreeOptions {
  /**
   * How many children one `files.list` page holds. A folder with more children
   * than a page is ordinary in Drive, and a walk that reads only the first page
   * copies a subset without saying so — so the fake pages by default.
   */
  pageSize?: number;
  /** Runs before each call; throw from it to make Drive fail (decisions 0031 §3, §5). */
  before?: (call: FakeCall) => void;
}

/**
 * A {@link DriveClient} over a tree that can be written to: `files.list` pages
 * through a folder's children, `files.create` adds a folder, and `files.copy`
 * duplicates a node into a new parent — a shortcut included, which copies as a
 * shortcut to the same target ([0031](../../decisions/0031-recursive-copy.md) §2).
 *
 * Every call is recorded, so a test can assert not only the resulting tree but
 * what was and was not asked for: that nothing was attempted after a failure,
 * that a shortcut's target was never listed, that a rate limit was retried.
 */
export function createWritableTreeDrive(
  nodes: DriveNode[],
  options: WritableTreeOptions = {},
): WritableTreeDrive {
  const pageSize = options.pageSize ?? 100;
  const calls: FakeCall[] = [];
  let created = 0;

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

  const record = (method: FakeCall["method"], id: string): void => {
    const attempt = calls.filter((c) => c.method === method && c.id === id).length + 1;
    const call: FakeCall = { method, id, attempt };
    calls.push(call);
    options.before?.(call);
  };

  const add = (node: DriveNode): DriveNode => {
    nodes.push(node);
    return node;
  };

  return {
    nodes,
    calls,
    trace: () => calls.map((c) => `${c.method}:${c.id}`),
    client: {
      files: {
        list: async (params: ListParams) => {
          const q = params.q ?? "";
          const parent = extractParent(q);
          record("list", parent ?? "");
          const name = extractName(q);
          const matches = nodes.filter((n) => {
            if (name !== undefined && n.name !== name) return false;
            if (parent !== undefined && !(n.parents ?? []).includes(parent)) return false;
            if (q.includes("trashed = false") && n.trashed === true) return false;
            return true;
          });
          const from = Number.parseInt(params.pageToken ?? "0", 10);
          const page = matches.slice(from, from + pageSize);
          const next = from + pageSize < matches.length ? String(from + pageSize) : null;
          return { data: { files: page.map(toRaw), nextPageToken: next } };
        },
        get: async ({ fileId }: { fileId: string }) => {
          const node = nodes.find((n) => n.id === fileId);
          if (node === undefined) throw notFound(fileId);
          return { data: toRaw(node) };
        },
        create: async ({ requestBody }: { requestBody: FileCreateBody }) => {
          const [parent = ""] = requestBody.parents ?? [];
          record("create", parent);
          created += 1;
          const node: DriveNode = {
            id: `new${created}`,
            name: requestBody.name ?? "Untitled",
            parents: requestBody.parents ?? [],
          };
          if (requestBody.mimeType !== undefined) node.mimeType = requestBody.mimeType;
          if (requestBody.shortcutDetails !== undefined) {
            node.target = requestBody.shortcutDetails.targetId;
          }
          return { data: toRaw(add(node)) };
        },
        copy: async ({ fileId, requestBody }: { fileId: string; requestBody: FileCreateBody }) => {
          record("copy", fileId);
          const source = nodes.find((n) => n.id === fileId);
          if (source === undefined) throw notFound(fileId);
          // Drive refuses to copy a folder at all, which is the whole reason
          // decision 0031 exists; the fake refuses the same way.
          if (mimeOf(source) === FOLDER_MIME) {
            throw new FakeApiError(403, "Copying a folder is not supported.");
          }
          created += 1;
          const node: DriveNode = {
            id: `new${created}`,
            name: requestBody.name ?? source.name,
            mimeType: mimeOf(source),
            parents: requestBody.parents ?? [],
          };
          // A copied shortcut is a second pointer at the same file (0031 §2).
          if (source.target !== undefined) node.target = source.target;
          return { data: toRaw(add(node)) };
        },
        update: async () => {
          throw new Error("not implemented in writable tree fake");
        },
        delete: async () => {
          throw new Error("not implemented in writable tree fake");
        },
        export: async () => {
          throw new Error("not implemented in writable tree fake");
        },
      },
      drives: {
        list: async () => {
          throw new Error("not implemented in writable tree fake");
        },
        get: async () => {
          throw new Error("not implemented in writable tree fake");
        },
      },
      permissions: {
        list: async () => {
          throw new Error("not implemented in writable tree fake");
        },
        create: async () => {
          throw new Error("not implemented in writable tree fake");
        },
        update: async () => {
          throw new Error("not implemented in writable tree fake");
        },
        delete: async () => {
          throw new Error("not implemented in writable tree fake");
        },
      },
    },
  };
}
