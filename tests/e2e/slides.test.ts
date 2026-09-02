import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { stringify } from "yaml";
import { z } from "zod";
import {
  describeLive,
  gdriveAs,
  gdriveError,
  list,
  LIVE_TIMEOUT,
  useSandbox,
} from "./helpers/sandbox.ts";

/**
 * What Slides accepts, and what it does with a deck the CLI just built.
 *
 * `presentations.create` always answers with a deck holding one slide, and the
 * layouts a `createSlide` may name belong to the deck that create just made —
 * neither is a thing a fake can be right about, because both are decided after
 * the request leaves. So is the one that matters most here: the API has no
 * request that *sets* a shape's text, so a title change is a delete and an
 * insert, and whether the body beside it survived is Slides' answer.
 *
 * **Two things cannot be asserted from here and are not approximated.**
 *
 * - *Formatting.* `slides read` emits no styling at all, so "the bold in the
 *   body survived a title-only edit" has no observable here, and nothing below
 *   stands in for it. What the read-back does say is that the body's *text*
 *   came through the edit unchanged; that the CLI planned no request for it is
 *   a property of the planner and is asserted beside it. The bold itself stays
 *   a manual check (0043 §4).
 * - *A real `elements` entry.* Writing one is implemented (decision 0063), and
 *   it still cannot be exercised from here, for a reason worth stating
 *   precisely: an **empty** placeholder is dropped by the projection —
 *   neither a field nor an element — so the second `BODY` of a deck this CLI
 *   built never appears, and there is nothing to address. An entry shows up
 *   only once it *has* text, which means a deck made in the Slides UI or a
 *   second column filled by hand. `slides create` cannot produce one.
 *
 *   So the case below is still a document naming an element the slide does not
 *   have — the same guard, reached from the side a CLI can reach — and the
 *   write itself is a manual check.
 */

const elementSchema = z.looseObject({
  id: z.string().optional(),
  kind: z.string(),
  placeholder: z.string().optional(),
  text: z.string().optional(),
});

const slideSchema = z.looseObject({
  id: z.string().optional(),
  layout: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  elements: z.array(elementSchema).optional(),
});

const deckSchema = z.looseObject({
  id: z.string().optional(),
  title: z.string(),
  slides: z.array(slideSchema),
});

const planEntrySchema = z.looseObject({
  action: z.string(),
  id: z.string().optional(),
  title: z.string(),
  fields: z.array(z.string()).optional(),
});

const readSchema = z.object({ presentation: deckSchema });
const createdSchema = z.object({
  id: z.string(),
  title: z.string(),
  plan: z.array(planEntrySchema),
});
const writtenSchema = z.object({ plan: z.array(planEntrySchema), applied: z.boolean() });

const DECK_NAME = "a deck built from a document";
const BODY = "the first body line\nthe second body line";

const SOURCE = {
  title: "the document's title, which the argument overrides",
  slides: [
    { layout: "TITLE_AND_BODY", title: "what the quarter said", body: BODY },
    { layout: "TITLE_AND_TWO_COLUMNS", title: "two ways to read it", body: "the left column" },
  ],
};

describeLive("Slides against a real account", () => {
  const sandbox = useSandbox();
  let local = "";
  let created: z.infer<typeof createdSchema> = { id: "", title: "", plan: [] };
  let deck: z.infer<typeof deckSchema> = { title: "", slides: [] };

  function documentPath(name: string, document: unknown): string {
    const path = join(local, `${name}.yaml`);
    writeFileSync(path, stringify(document));
    return path;
  }

  beforeAll(async () => {
    local = mkdtempSync(join(tmpdir(), "gdrive-e2e-slides-"));
    created = await gdriveAs(
      createdSchema,
      "slides",
      "create",
      DECK_NAME,
      "--file",
      documentPath("source", SOURCE),
      "--parent",
      sandbox.id,
    );
    deck = (await gdriveAs(readSchema, "slides", "read", created.id)).presentation;
  }, LIVE_TIMEOUT);

  afterAll(() => {
    if (local !== "") rmSync(local, { recursive: true, force: true });
  });

  it(
    "builds the document's slides and leaves no blank first slide ahead of them",
    () => {
      // `presentations.create` hands back a deck with one slide whose id only
      // Slides knows, so the delete that removes it travels in the same batch
      // as the creates (0030 §4). Two slides, not three, is that working.
      expect(deck.slides).toHaveLength(2);
      expect(deck.slides.map((slide) => slide.title)).toEqual([
        "what the quarter said",
        "two ways to read it",
      ]);
      expect(deck.slides[0]?.body).toBe(BODY);
      expect(deck.slides[0]?.layout).toBe("TITLE_AND_BODY");
      expect(deck.slides[1]?.layout).toBe("TITLE_AND_TWO_COLUMNS");
      expect(created.plan.filter((entry) => entry.action === "delete")).toHaveLength(1);
    },
    LIVE_TIMEOUT,
  );

  it(
    "names the deck in Drive what the argument said, over the document's own title",
    async () => {
      // A deck's Drive name *is* its title, so this is the one field where the
      // two names cannot drift — and the argument is what writes it.
      const entry = (await list(sandbox.id)).find((child) => child.id === created.id);
      expect(entry?.name).toBe(DECK_NAME);
      expect(entry?.type).toBe("slides");
      expect(deck.title).toBe(DECK_NAME);
    },
    LIVE_TIMEOUT,
  );

  it(
    "rewrites a title and sends no request for the body beside it",
    async () => {
      const edited = {
        ...deck,
        slides: deck.slides.map((slide, index) =>
          index === 0 ? { ...slide, title: "what the quarter said, restated" } : slide,
        ),
      };
      const written = await gdriveAs(
        writtenSchema,
        "slides",
        "write",
        created.id,
        "--file",
        documentPath("retitled", edited),
      );

      // That the write reached the deck at all, and touched one slide. What
      // the entry *says* — its `fields`, and that `body` is not among them —
      // is the planner's own output and is asserted beside it in
      // `plan.test.ts`; repeating it here would be checking this CLI's
      // plumbing against itself. The live half is the read-back below.
      expect(written.applied).toBe(true);
      expect(written.plan).toHaveLength(1);

      const after = (await gdriveAs(readSchema, "slides", "read", created.id)).presentation;
      expect(after.slides[0]?.title).toBe("what the quarter said, restated");
      expect(after.slides[0]?.body).toBe(BODY);
      expect(after.slides[1]?.title).toBe("two ways to read it");
      expect(after.slides[1]?.body).toBe("the left column");
    },
    LIVE_TIMEOUT,
  );

  it(
    "refuses an elements entry rather than reporting a change it cannot make",
    async () => {
      const before = (await gdriveAs(readSchema, "slides", "read", created.id)).presentation;
      const withElement = {
        ...before,
        slides: before.slides.map((slide, index) =>
          index === 0
            ? {
                ...slide,
                title: "a title the refusal must not write",
                elements: [{ id: "an element this slide does not have", kind: "shape", text: "x" }],
              }
            : slide,
        ),
      };

      // 0030 §3: no request writes an element, so reporting success for an edit
      // to one would be reporting a change that did not happen. The refusal is
      // `checkElements`, which reaches no Google call and is asserted beside
      // its source; what this case adds is the half only Google can answer —
      // that the batch travelling with it never arrived.
      const code = await gdriveError(
        "slides",
        "write",
        created.id,
        "--file",
        documentPath("with-element", withElement),
      );
      expect(code).toBe("INVALID_ARGS");

      // Nothing was written — including the title change that travelled in the
      // same document, which is what "the plan is built whole or not at all"
      // has to mean at the boundary.
      const after = (await gdriveAs(readSchema, "slides", "read", created.id)).presentation;
      expect(after.slides[0]?.title).toBe(before.slides[0]?.title);
      expect(after.slides[0]?.body).toBe(BODY);
    },
    LIVE_TIMEOUT,
  );
});
