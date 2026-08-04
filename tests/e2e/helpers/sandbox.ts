import { execFile, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe } from "vitest";
import { z } from "zod";

/**
 * The live suite runs the real CLI against a real Google account
 * (decision 0043). Nothing here is injected: a fake encodes what its author
 * believes the API does, and every test written against one can only confirm
 * that belief. This layer exists so Google can contradict the author.
 *
 * The whole safety story is one invariant (0043 §2). Every write goes inside a
 * subfolder this module creates under `GDRIVE_CLI_E2E_FOLDER`, and no test ever
 * names a path outside it. Nothing else about these tests is load-bearing.
 *
 * Every response is parsed with `zod` rather than asserted into shape
 * (decision 0015): the CLI's stdout is an edge, and an assertion here would
 * make the suite agree with whatever the CLI printed instead of checking it.
 */

const execFileAsync = promisify(execFile);

const CLI = fileURLToPath(new URL("../../../src/index.ts", import.meta.url));

/** Every live call gets two minutes: Docs and Sheets are not fast. */
export const LIVE_TIMEOUT = 120_000;

/** The folder every sandbox is created under. Unset means "no live account". */
export const PARENT = process.env["GDRIVE_CLI_E2E_FOLDER"] ?? "";

/** A sandbox older than this is a leftover from a run that failed. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const SANDBOX_PREFIX = "e2e-";

/**
 * Exactly what `sandboxName` produces, and nothing a person would type.
 *
 * The pruner is the only code here that deletes something it did not create, so
 * what it recognises has to be narrow. `startsWith("e2e-")` would take a
 * `e2e-baseline.csv` somebody parked in the folder.
 */
const SANDBOX_NAME = /^e2e-\d{8}T\d{6}Z-\d+$/;

/**
 * Spellings of `GDRIVE_CLI_E2E_FOLDER` that must never be accepted.
 *
 * `src/lib/resolve-path.ts` trims a path and maps `root`, `/` and the empty
 * string to My Drive's root, so an anchor of `" "` would put the sandbox at the
 * top of the account and point the pruner at everything in it. `drive:` reaches
 * a shared drive, which decision 0043 §2 rules out. A folder id contains no
 * slash and no colon, which is what is left after these.
 */
function rejectAnchor(anchor: string): string | undefined {
  const trimmed = anchor.trim();
  if (trimmed === "" || trimmed === "root" || trimmed === "/") {
    return "it names My Drive's root";
  }
  if (trimmed !== anchor) return "it has surrounding whitespace";
  if (anchor.includes("/")) return "it is a path, and only a folder id is accepted";
  if (anchor.includes(":")) return "it addresses a shared drive, which E2E never writes to";
  return undefined;
}

const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

/** The normalized file object every Drive command reports (docs/commands.md). */
const driveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  mime_type: z.string(),
  size: z.number().nullable(),
  trashed: z.boolean(),
  created: z.string(),
  web_view_link: z.string().nullable(),
  target_id: z.string().nullable(),
  target_type: z.string().nullable(),
});

export type DriveFile = z.infer<typeof driveFileSchema>;

const oneFileSchema = z.object({ file: driveFileSchema });
const manyFilesSchema = z.object({ files: z.array(driveFileSchema) });
const accountsSchema = z.object({ data: z.object({ accounts: z.array(z.unknown()) }) });

/** What `execFile` rejects with when the child exits non-zero or times out. */
const execFailureSchema = z.object({
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  code: z.number().optional(),
  message: z.string().optional(),
});

/**
 * Whether a real account is reachable. A machine with no credentials — a fresh
 * clone, someone else's laptop, CI — skips rather than fails (0043 §3): a hook
 * that fails where it cannot possibly pass teaches everyone to bypass it.
 */
function hasLiveAccount(): boolean {
  if (PARENT === "") return false;
  const probe = spawnSync("bun", [CLI, "-f", "json", "account", "list"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (probe.status !== 0 || typeof probe.stdout !== "string") return false;
  try {
    const parsed = accountsSchema.safeParse(JSON.parse(probe.stdout));
    return parsed.success && parsed.data.data.accounts.length > 0;
  } catch {
    return false;
  }
}

export const LIVE = hasLiveAccount();

if (!LIVE) {
  const reason =
    PARENT === ""
      ? "GDRIVE_CLI_E2E_FOLDER is not set"
      : "no Google account is authenticated for this machine";
  console.warn(`E2E: skipped because ${reason}. See README.md, Development.`);
}

/**
 * `describe` when an account is reachable, `describe.skip` when it is not.
 *
 * Typed down to the one call shape the suite uses, so that this module does not
 * re-export vitest's collector types under names it cannot reach.
 */
type DescribeSuite = (name: string, body: () => void) => void;

export const describeLive: DescribeSuite = LIVE ? describe : describe.skip;

interface Invocation {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs the CLI and returns its stdout, stderr and exit code. */
async function invoke(args: string[]): Promise<Invocation> {
  try {
    const { stdout, stderr } = await execFileAsync("bun", [CLI, ...args], {
      encoding: "utf8",
      timeout: LIVE_TIMEOUT,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (error: unknown) {
    const parsed = execFailureSchema.safeParse(error);
    const failure = parsed.success ? parsed.data : {};
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message ?? String(error),
      code: failure.code ?? 1,
    };
  }
}

function parseEnvelope(result: Invocation, args: string[]): z.infer<typeof envelopeSchema> {
  const parsed = envelopeSchema.safeParse(JSON.parse(result.stdout));
  if (!parsed.success) {
    throw new Error(
      `gdrive ${args.join(" ")} printed something that is not an envelope:\n${result.stdout}`,
    );
  }
  return parsed.data;
}

/**
 * Runs the CLI in JSON mode and returns `data` from a success envelope.
 *
 * `-f json` is named rather than relied on: decision 0036 made it the default,
 * and decision 0006 lets a `config.toml` move that default per user, so a suite
 * that parses JSON has to ask for it out loud.
 */
export async function gdrive(...args: string[]): Promise<unknown> {
  const result = await invoke(["-f", "json", ...args]);
  if (result.code !== 0) {
    throw new Error(
      `gdrive ${args.join(" ")} exited ${result.code}\n${result.stderr}${result.stdout}`,
    );
  }
  const envelope = parseEnvelope(result, args);
  if (!envelope.success) {
    throw new Error(
      `gdrive ${args.join(" ")} reported ${envelope.error?.code}: ${envelope.error?.message}`,
    );
  }
  return envelope.data;
}

/** Runs the CLI in JSON mode and parses `data` with the caller's schema. */
export async function gdriveAs<T>(schema: z.ZodType<T>, ...args: string[]): Promise<T> {
  const data = await gdrive(...args);
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `gdrive ${args.join(" ")} returned an unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/**
 * Runs the CLI expecting failure, and returns the error envelope's code.
 *
 * The error envelope goes to stderr, not stdout: a caller piping a command into
 * `jq` gets nothing on the failure path rather than an envelope `jq` would have
 * to be taught to recognise.
 */
export async function gdriveError(...args: string[]): Promise<string> {
  const result = await invoke(["-f", "json", ...args]);
  if (result.code === 0) throw new Error(`gdrive ${args.join(" ")} unexpectedly succeeded`);
  const printed = result.stderr === "" ? result.stdout : result.stderr;
  return parseEnvelope({ ...result, stdout: printed }, args).error?.code ?? "";
}

/** The children of a folder, as `ls` reports them. */
export async function list(folderId: string, ...extra: string[]): Promise<DriveFile[]> {
  return (await gdriveAs(manyFilesSchema, "ls", folderId, ...extra)).files;
}

/**
 * Runs a command that reports one file and returns it.
 *
 * `info`, `mkdir`, `upload`, `cp`, `mv` and `rm` all answer with the file
 * object under `data.file`, while `docs create` and `sheets create` answer with
 * their own shape. Knowing which is which is what this wrapper is for.
 */
export async function file(...args: string[]): Promise<DriveFile> {
  return (await gdriveAs(oneFileSchema, ...args)).file;
}

/** One file's metadata, as `info` reports it. */
export async function info(fileId: string): Promise<DriveFile> {
  return await file("info", fileId);
}

function sandboxName(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${SANDBOX_PREFIX}${stamp}-${process.pid}`;
}

/**
 * Trashes sandboxes left behind by runs that failed more than a day ago. A
 * failed run keeps its folder, because the contents are the evidence; keeping
 * them forever is a different problem.
 */
async function pruneStaleSandboxes(): Promise<void> {
  const cutoff = Date.now() - STALE_AFTER_MS;
  for (const child of await list(PARENT)) {
    if (child.type !== "folder") continue;
    if (!SANDBOX_NAME.test(child.name)) continue;
    const created = Date.parse(child.created);
    if (Number.isNaN(created) || created >= cutoff) continue;
    await gdrive("rm", child.id);
  }
}

/**
 * Refuses an anchor that would let a write escape, before anything is written.
 *
 * This runs where a failure is loud. An anchor that is set but unusable is a
 * misconfiguration, not an absent account, so it fails rather than skips: 0043
 * §3 buys quiet for the machine that has no credentials, not for the one whose
 * variable points somewhere unintended.
 */
async function requireUsableAnchor(): Promise<void> {
  const refusal = rejectAnchor(PARENT);
  if (refusal !== undefined) {
    throw new Error(`GDRIVE_CLI_E2E_FOLDER is not usable: ${refusal}. Give it a folder id.`);
  }
  const anchor = await info(PARENT);
  if (anchor.type !== "folder") {
    throw new Error(`GDRIVE_CLI_E2E_FOLDER names a ${anchor.type}, not a folder.`);
  }
}

/**
 * Creates a sandbox for the calling test file and hands back its id.
 *
 * One per file, not one per run: vitest gives each file its own process, and a
 * shared folder would couple files that have no reason to know about each
 * other. `README.md` says so, because three folders appearing at once is
 * otherwise a surprise while watching the run.
 *
 * Teardown deletes the folder only on a positive account of success — setup
 * finished, at least one test ran, and none of the ones that ran failed. Every
 * other outcome keeps it. That direction is the whole point: whatever went
 * wrong is in there, and inferring "nothing went wrong" from the absence of a
 * signal is how a `beforeAll` failure ends up destroying its own evidence.
 */
export function useSandbox(): { readonly id: string } {
  const handle = { id: "" };
  let setupFinished = false;
  let passed = 0;
  let failures = 0;

  beforeAll(async () => {
    await requireUsableAnchor();
    await pruneStaleSandboxes();
    handle.id = (await file("mkdir", sandboxName(), "--parent", PARENT)).id;
    setupFinished = true;
  }, LIVE_TIMEOUT);

  afterEach((context) => {
    if (context.task.result?.state === "pass") passed += 1;
    else failures += 1;
  });

  afterAll(async () => {
    if (handle.id === "") return;
    const everythingPassed = setupFinished && failures === 0 && passed > 0;
    if (!everythingPassed) {
      console.warn(
        `E2E: this file did not finish cleanly; its sandbox is kept at ${handle.id} for inspection.`,
      );
      return;
    }
    await gdrive("rm", handle.id);
  }, LIVE_TIMEOUT);

  return {
    get id(): string {
      return handle.id;
    },
  };
}
