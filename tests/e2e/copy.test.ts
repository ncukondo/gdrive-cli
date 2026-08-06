import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import {
  describeLive,
  file,
  gdrive,
  gdriveAs,
  gdriveError,
  info,
  list,
  LIVE_TIMEOUT,
  useSandbox,
  type DriveFile,
} from "./helpers/sandbox.ts";

/**
 * The write paths whose defects were Drive's own defaults rather than this
 * CLI's arithmetic.
 *
 * A copy sent without a name is renamed by Drive, and *not uniformly*: a
 * Google-native document comes back as `Copy of <name>` while a binary file
 * beside it keeps its own. A fake answers whichever of the two its author had
 * in mind, and a tree copied under it is a tree half of whose files were
 * silently renamed. A rename is the mirror image: Drive carries the new name
 * into the in-document title, which is the only reason `rename` needs no
 * per-type behaviour, and nothing but Drive can confirm it.
 *
 * These built their own fixtures from the start and share nothing with
 * `drive.test.ts` but a temporary directory, so they are a file of their own:
 * one sandbox per file means vitest runs them beside it rather than after it,
 * and `pre-push` pays the longer of the two instead of the sum.
 *
 * **One case here names a path outside the sandbox, on purpose.** Everything
 * else in the live suite addresses ids inside it, and `shortcuts.test.ts`
 * drops a whole case rather than name an ancestor. The root refusal earns the
 * exception because the thing it checks *is* the boundary: `resolvePath`
 * answers the alias `root` while a `parents` list carries My Drive's real id,
 * and no fake can tell those apart — it is handed whichever one its author
 * wrote down. The cost is stated rather than hidden: if `refuseCycle`
 * regresses, `cp -r` starts reproducing the account into this sandbox and runs
 * until the timeout, and the sandbox is kept holding whatever it got through.
 * That is why it is **one** spelling and not three (below).
 */

const documentSchema = z.object({ id: z.string(), title: z.string() });
const entrySchema = z.object({ src: z.string(), dst: z.string(), name: z.string() });
const reportSchema = z.object({
  file: z.looseObject({ id: z.string(), name: z.string() }),
  folders: z.array(entrySchema),
  copied: z.array(entrySchema),
});

/**
 * The fixture is eight sequential Drive calls and then a whole `cp -r` over
 * what they built, which is more than the per-call budget `LIVE_TIMEOUT` was
 * sized for. This file is the suite's long pole, so a slow account day would
 * otherwise stop a push with a timeout that is not a regression — and keep a
 * sandbox for nothing (0043 §2 keeps the evidence of *failures*, and this
 * would not be one).
 */
const SETUP_TIMEOUT = 4 * LIVE_TIMEOUT;

const TREE = "the folder that gets copied";
const SUBFOLDER = "a subfolder inside it";
const TREE_DOC = "a document Drive would rename";
const TREE_BINARY = "a binary Drive would not rename";
const TREE_LINK = "a shortcut inside the tree";
const LINK_TARGET = "the folder that shortcut points at";
const LINK_TARGET_CHILD = "the one child of the shortcut's target";

describeLive("Copying and renaming against a real account", () => {
  const sandbox = useSandbox();
  let local = "";
  let source = "";
  let linkTarget = "";
  let destination = "";
  let report: z.infer<typeof reportSchema> = {
    file: { id: "", name: "" },
    folders: [],
    copied: [],
  };
  let copies: DriveFile[] = [];

  beforeAll(async () => {
    local = mkdtempSync(join(tmpdir(), "gdrive-e2e-copy-"));
    const upload = join(local, "tree-payload.bin");
    writeFileSync(upload, "a payload that survives a copy\n");

    linkTarget = (await file("mkdir", LINK_TARGET, "--parent", sandbox.id)).id;
    await gdrive("mkdir", LINK_TARGET_CHILD, "--parent", linkTarget);

    source = (await file("mkdir", TREE, "--parent", sandbox.id)).id;
    await gdrive("mkdir", SUBFOLDER, "--parent", source);
    await gdrive("docs", "create", TREE_DOC, "--parent", source);
    await gdrive("upload", upload, "--parent", source, "--name", TREE_BINARY);
    await gdrive("ln", linkTarget, source, "--name", TREE_LINK);

    destination = (await file("mkdir", "where the copy lands", "--parent", sandbox.id)).id;
    report = await gdriveAs(reportSchema, "cp", "-r", source, destination);
    copies = await list(report.file.id);
  }, SETUP_TIMEOUT);

  afterAll(() => {
    if (local !== "") rmSync(local, { recursive: true, force: true });
  });

  it(
    "gives every copy the name its source had, at every level",
    () => {
      // With no name in the request, the document below comes back as
      // "Copy of …" and the binary beside it does not, so a suite with one
      // file in the tree can pass either way. Both are here for that reason.
      //
      // The top-level folder is not: `copyTree` reaches it through
      // `createFolder`, which names every folder it makes, so Drive is never
      // offered the chance to prepend anything and asserting its name would
      // read as coverage it is not. The three below are the whole case.
      expect(copies.map((child) => child.name).sort()).toEqual(
        [SUBFOLDER, TREE_BINARY, TREE_DOC, TREE_LINK].sort(),
      );
      expect(report.copied.map((entry) => entry.name).sort()).toEqual(
        [TREE_BINARY, TREE_DOC, TREE_LINK].sort(),
      );
    },
    LIVE_TIMEOUT,
  );

  it(
    "copies a shortcut as a pointer, and does not copy what it points at",
    async () => {
      // Decision 0031 §2: the walk enumerates entries, and an entry never
      // follows (0025 §1). `files.copy` on a shortcut duplicates the pointer,
      // which is Drive's behaviour rather than this CLI's.
      const copiedLink = copies.find((child) => child.name === TREE_LINK);
      expect(copiedLink?.type).toBe("shortcut");
      expect(copiedLink?.target_id).toBe(linkTarget);

      expect(report.folders.map((entry) => entry.name)).toEqual([TREE, SUBFOLDER]);
      expect(copies.map((child) => child.name)).not.toContain(LINK_TARGET);
      // Nothing was copied *into* the target either.
      expect((await list(linkTarget)).map((child) => child.name)).toEqual([LINK_TARGET_CHILD]);
    },
    LIVE_TIMEOUT,
  );

  it(
    "refuses cp -r on the root, and copies nothing",
    async () => {
      // `resolvePath` answers the literal alias `root`, while a `parents` list
      // carries My Drive's real id — so the cycle guard used to compare an
      // alias with an id, find no match, and start copying My Drive into a
      // folder inside My Drive, where it kept finding the copy it had just
      // made. The guard resolves the alias now; this is what says so, and only
      // Drive can, because the mismatch is between what it returns in two
      // different fields.
      //
      // One spelling, not the three `walk()` maps to the root. They converge on
      // its first branch before anything Drive-side differs, and that mapping
      // is already covered at `resolve-path.test.ts` and `cp.test.ts`. Running
      // all three here would triple the blast radius of the regression above
      // for no boundary this one does not already reach.
      const empty = await file("mkdir", "where nothing should land", "--parent", sandbox.id);
      expect(await gdriveError("cp", "-r", "root", empty.id)).toBe("INVALID_ARGS");
      expect(await list(empty.id)).toEqual([]);
    },
    LIVE_TIMEOUT,
  );

  it(
    "moves a document's Drive name and its in-document title together",
    async () => {
      const document = await gdriveAs(
        documentSchema,
        "docs",
        "create",
        "the name before the rename",
        "--parent",
        sandbox.id,
      );
      await gdrive("rename", document.id, "the name after the rename");

      expect((await info(document.id)).name).toBe("the name after the rename");
      // The Docs API's own `title`, which is the in-document one. `rename`
      // sends a `files.update` and nothing else; that this reaches the
      // document is Drive's doing, and decision 0052's whole basis.
      const read = await gdriveAs(documentSchema, "docs", "read", document.id);
      expect(read.title).toBe("the name after the rename");
    },
    LIVE_TIMEOUT,
  );
});
