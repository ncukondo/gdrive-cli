import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { stringify } from "yaml";
import { z } from "zod";
import {
  describeLive,
  gdrive,
  gdriveAs,
  gdriveError,
  list,
  LIVE_TIMEOUT,
  useSandbox,
} from "./helpers/sandbox.ts";

/**
 * The four write-side defects the Forms API is the only party that can refuse.
 *
 * Each one shipped past a full unit suite and was caught by a person running
 * the CLI by hand, and each was an encoding a fake accepted:
 *
 * | Case below | What no fake could say |
 * | --- | --- |
 * | an `other: true` option | the API refuses `value` beside `isOther` |
 * | a `file_upload` question | the API cannot create one, and the batch is atomic |
 * | `documentTitle` at creation | Drive otherwise calls the form `Untitled form` |
 * | a copied `go_to_section_id` | it is an item id belonging to another form |
 *
 * The first three ride on one create: before their fixes it did not merely
 * report the wrong thing, it failed, because a `batchUpdate` is all-or-nothing
 * and one refused request took the whole document down with it.
 *
 * **Never make `forms create` fail after the form exists.** It creates the
 * form, fills it, and moves it into `--parent` last, so a failure in between
 * leaves an empty form in **My Drive's root** — outside every sandbox, which
 * 0043 §2 does not allow. Measured while writing this file. Every create here
 * is one the API accepts.
 */

const optionSchema = z.union([
  z.string(),
  z.looseObject({
    value: z.string().optional(),
    other: z.boolean().optional(),
    go_to_action: z.string().optional(),
    go_to_section_id: z.string().optional(),
  }),
]);

const itemSchema = z.looseObject({
  id: z.string().optional(),
  question_id: z.string().optional(),
  type: z.string(),
  title: z.string().optional(),
  options: z.array(optionSchema).optional(),
});

const formSchema = z.looseObject({
  id: z.string().optional(),
  title: z.string(),
  items: z.array(itemSchema),
});

const readSchema = z.object({ form: formSchema });
const skippedSchema = z.array(z.object({ index: z.number(), title: z.string(), kind: z.string() }));
const createdSchema = z.object({
  id: z.string(),
  title: z.string(),
  unsupported: skippedSchema.optional(),
});

const FORM_NAME = "a form with an Other option";
const COPY_NAME = "a form copied from that one";
const CHOICE = "Which team are you on?";

/**
 * `value: Other` beside `other: true` is the defect verbatim: the document is
 * free to carry the label, and the request must not. The `file_upload` item
 * sits between two writable ones, so a create that skipped the rest of the
 * batch would be visible as a missing question rather than as a missing form.
 */
const SOURCE = {
  title: "the document's title, which the argument overrides",
  items: [
    {
      type: "choice",
      choice_type: "radio",
      title: CHOICE,
      options: ["Sales", "Engineering", { value: "Other", other: true }],
    },
    { type: "file_upload", title: "Attach your notes" },
    { type: "page_break", title: "The second page" },
    { type: "text", title: "Anything else?" },
  ],
};

describeLive("Forms against a real account", () => {
  const sandbox = useSandbox();
  let local = "";
  let created = { id: "", title: "" };
  let skipped: z.infer<typeof skippedSchema> = [];
  let form: z.infer<typeof formSchema> = { title: "", items: [] };

  function documentPath(name: string, document: unknown): string {
    const path = join(local, `${name}.yaml`);
    writeFileSync(path, stringify(document));
    return path;
  }

  beforeAll(async () => {
    local = mkdtempSync(join(tmpdir(), "gdrive-e2e-forms-"));
    const made = await gdriveAs(
      createdSchema,
      "forms",
      "create",
      FORM_NAME,
      "--file",
      documentPath("source", SOURCE),
      "--parent",
      sandbox.id,
    );
    created = made;
    skipped = made.unsupported ?? [];
    form = (await gdriveAs(readSchema, "forms", "read", made.id)).form;
  }, LIVE_TIMEOUT);

  afterAll(() => {
    if (local !== "") rmSync(local, { recursive: true, force: true });
  });

  it(
    "creates an Other option, whose label the API refuses to be sent",
    () => {
      // Sending `value` beside `isOther` is "Cannot set option.value or
      // option.image when option.isOther is true" — an error on the create
      // itself, so this case reaching an assertion at all is the fix.
      const choice = form.items[0];
      expect(choice?.title).toBe(CHOICE);
      expect(choice?.options).toEqual(["Sales", "Engineering", { other: true }]);
    },
    LIVE_TIMEOUT,
  );

  it(
    "leaves a file upload question out instead of taking the batch down with it",
    () => {
      expect(skipped).toEqual([
        { index: 1, title: "Attach your notes", kind: "fileUploadQuestion" },
      ]);
      // The items on either side of it landed, which is what "left out" has to
      // mean for a request set the API applies all at once.
      expect(form.items.map((item) => item.type)).toEqual(["choice", "page_break", "text"]);
      expect(form.items.map((item) => item.title)).toEqual([
        CHOICE,
        "The second page",
        "Anything else?",
      ]);
    },
    LIVE_TIMEOUT,
  );

  it(
    "gives the form the Drive name it was told, not Untitled form",
    async () => {
      // `documentTitle` can only be set by `forms.create`; no `batchUpdate`
      // reaches it. Left unset, Drive names every form this CLI made
      // `Untitled form`, and no path could then resolve one.
      const entry = (await list(sandbox.id)).find((child) => child.id === created.id);
      expect(entry?.name).toBe(FORM_NAME);
      expect(entry?.type).toBe("form");
      expect(created.title).toBe(FORM_NAME);
      expect(form.title).toBe(FORM_NAME);
    },
    LIVE_TIMEOUT,
  );

  it(
    "drops a section target that names an item of the form the document came from",
    async () => {
      const source = (await gdriveAs(readSchema, "forms", "read", created.id)).form;
      const sectionId = source.items[1]?.id ?? "";
      expect(sectionId).not.toBe("");

      // Every option branches, not just one. A form mixing `go_to_section_id`
      // with `go_to_action` cannot be copied at all: dropping the section
      // targets leaves the option set half-navigated and the API answers
      // "Invalid Options, Either all or no options should be go to enabled".
      // Measured. That gap is stated rather than approximated.
      const branching = {
        ...source,
        items: source.items.map((item, index) =>
          index === 0
            ? {
                ...item,
                options: [
                  { value: "Sales", go_to_section_id: sectionId },
                  { value: "Engineering", go_to_section_id: sectionId },
                  { other: true, go_to_section_id: sectionId },
                ],
              }
            : item,
        ),
      };
      await gdrive("forms", "write", created.id, "--file", documentPath("branching", branching));

      const branched = (await gdriveAs(readSchema, "forms", "read", created.id)).form;
      const copy = await gdriveAs(
        createdSchema,
        "forms",
        "create",
        COPY_NAME,
        "--file",
        documentPath("copy", branched),
        "--parent",
        sandbox.id,
      );

      // Before the fix this create failed outright: the batch is atomic and
      // the target named an item of a form the new one has never heard of.
      expect(copy.unsupported).toEqual([{ index: 0, title: CHOICE, kind: "option.goToSectionId" }]);

      const copied = JSON.stringify((await gdriveAs(readSchema, "forms", "read", copy.id)).form);
      expect(copied).not.toContain("go_to_section_id");
      for (const item of branched.items) {
        const id = item.id ?? "";
        expect(id).not.toBe("");
        expect(copied).not.toContain(id);
        if (item.question_id !== undefined) expect(copied).not.toContain(item.question_id);
      }
      expect(copied).not.toContain(created.id);
    },
    LIVE_TIMEOUT,
  );

  it(
    "refuses a deletion without --prune, and writes neither the delete nor the create",
    async () => {
      const before = (await gdriveAs(readSchema, "forms", "read", created.id)).form;
      const shortened = {
        ...before,
        items: [
          ...before.items.slice(0, -1),
          { type: "text", title: "a question the refusal must not create" },
        ],
      };

      const code = await gdriveError(
        "forms",
        "write",
        created.id,
        "--file",
        documentPath("shortened", shortened),
      );
      expect(code).toBe("PRUNE_REQUIRED");

      // The plan is built whole or not at all, so the create in the same
      // document is refused with the delete. Only Google can say the requests
      // never arrived.
      const after = (await gdriveAs(readSchema, "forms", "read", created.id)).form;
      expect(after.items.map((item) => item.title)).toEqual(before.items.map((item) => item.title));
    },
    LIVE_TIMEOUT,
  );
});
