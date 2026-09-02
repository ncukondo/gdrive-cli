import { AppError } from "../../types/index.ts";
import { refusedPlan } from "../../lib/prune-refusal.ts";
import {
  layoutFieldPlaceholders,
  elementRuns,
  slideTextTargets,
  toSlideDocument,
  type PageRaw,
  type PresentationRaw,
  type SlideDocument,
  type SlideDocumentSlide,
  type SlideElement,
  type SlideTextTargets,
} from "../../lib/slide-document.ts";
import type {
  LayoutReferenceWrite,
  PlaceholderIdMappingWrite,
  SlidesRequest,
} from "../../lib/slides-api.ts";

/**
 * Turning a deck document into a list of edits (decision 0030). Pure and
 * separate from both commands, as `forms/plan.ts` is: it is the piece that
 * decides which box on a slide gets rewritten, and rewriting the wrong one is
 * invisible until someone opens the deck.
 */

export type SlidePlanAction = "create" | "update" | "move" | "delete";

/** One line of the plan `write` reports (decision 0028 §4, adopted by 0030 §1). */
export interface SlidePlanEntry {
  action: SlidePlanAction;
  /**
   * The slide's object id. Present on a create too, unlike a form's: this CLI
   * supplies the id a new slide gets, because `createSlide` and the
   * `insertText` that fills it are in one batch and the second has to address
   * what the first made.
   */
  id?: string;
  /** What names it to a reader: the slide's title, empty when it has none. */
  title: string;
  /** Where the slide ends up (create, move) or is (update, delete). */
  index?: number;
  /** Where a moved slide was. */
  from?: number;
  /** The document fields this entry writes. */
  fields?: string[];
  /**
   * The fields whose inline formatting the rewrite drops (0030 §2). There is no
   * request that sets a shape's text, so a changed placeholder is deleted and
   * re-inserted, and every run style inside it goes with it. Carried on the
   * plan so `--dry-run` shows it before anything is written.
   */
  formatting_loss?: string[];
}

/**
 * Something the document asked for that no request can carry. Reported through
 * 0021 §3's channel rather than as a plan entry, because nothing was planned —
 * the point is that a caller learns the edit did not happen instead of reading
 * a success and assuming it did.
 */
export interface SkippedField {
  /** The slide's position in the document. Absent when it is the deck itself. */
  index?: number;
  title: string;
  /** The document field that could not be written — the vocabulary `read` reports in. */
  kind: string;
}

export interface SlidePlan {
  entries: SlidePlanEntry[];
  requests: SlidesRequest[];
  skipped: SkippedField[];
}

/** The fields a slide's text lives in, in the order the document writes them. */
const TEXT_FIELDS = ["title", "subtitle", "body", "notes"] as const;

/**
 * Slides' own layouts, the set `slideLayoutReference.predefinedLayout` accepts.
 * Only reached when the deck reported no layouts to match a name against — a
 * name that is neither is an error rather than a slide built on `BLANK`.
 */
const PREDEFINED_LAYOUTS = new Set([
  "BLANK",
  "CAPTION_ONLY",
  "TITLE",
  "TITLE_AND_BODY",
  "TITLE_AND_TWO_COLUMNS",
  "TITLE_ONLY",
  "SECTION_HEADER",
  "SECTION_TITLE_AND_DESCRIPTION",
  "ONE_COLUMN_TEXT",
  "MAIN_POINT",
  "BIG_NUMBER",
]);

export interface SlidePlanOptions {
  prune: boolean;
  /** Every slide is new, whatever id it carries — what `slides create` needs. */
  ignoreIds?: boolean;
}

// --- Ids for what the batch creates -----------------------------------------

/**
 * Every object id the presentation already uses, so a generated one is free.
 *
 * A subset of what the API's uniqueness rule covers: the masters and the notes
 * master are not in `PresentationRaw` at all, because nothing here reads them.
 * That is safe for the ids below rather than in general — the collision that
 * can realistically happen is with an id a previous run of this command left in
 * the deck, and those are all in `slides`, while Google's own ids look nothing
 * like a `gdrive_` prefix. Anything that starts generating ids of another shape
 * has to widen this first.
 */
function takenIds(presentation: PresentationRaw): Set<string> {
  const taken = new Set<string>();
  const walk = (page: PageRaw | undefined): void => {
    if (page === undefined) return;
    if (page.objectId) taken.add(page.objectId);
    const elements = [...(page.pageElements ?? [])];
    while (elements.length > 0) {
      const element = elements.pop();
      if (element === undefined) continue;
      if (element.objectId) taken.add(element.objectId);
      elements.push(...(element.elementGroup?.children ?? []));
    }
    walk(page.slideProperties?.notesPage);
  };
  for (const slide of presentation.slides ?? []) walk(slide);
  for (const layout of presentation.layouts ?? []) walk(layout);
  return taken;
}

/**
 * Ids for the slides and placeholders the batch asks the API to create.
 *
 * Deterministic and prefixed, because the API requires an id to be unique
 * "among all pages and page elements in the presentation" and rejects the whole
 * batch otherwise: a run that adds a slide to a deck a previous run added one
 * to has to pick a different id, and it can only see the ids the deck already
 * has. Google's own ids look nothing like these.
 */
function idFactory(presentation: PresentationRaw): (hint: string) => string {
  const taken = takenIds(presentation);
  const counters = new Map<string, number>();
  return (hint: string): string => {
    for (;;) {
      const next = (counters.get(hint) ?? 0) + 1;
      counters.set(hint, next);
      const id = `gdrive_${hint}_${next}`;
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
  };
}

// --- Matching ---------------------------------------------------------------

/** A document slide that will hold a position in the deck, and what it matched. */
interface Placed {
  slide: SlideDocumentSlide;
  /** The deck slide it matched: its id, and where the deck had it. */
  match?: { id: string; at: number };
}

function titleOf(slide: SlideDocumentSlide): string {
  return slide.title ?? "";
}

/** How a refusal names a slide a reader has to go find: a blank one has an id. */
function describe(title: string, id: string): string {
  return title === "" ? `an untitled slide (${id})` : `"${title}" (${id})`;
}

function classify(
  current: SlideDocument,
  document: SlideDocument,
  options: SlidePlanOptions,
): { placed: Placed[]; matched: Set<string> } {
  const known = new Map<string, number>();
  for (const [at, slide] of current.slides.entries()) if (slide.id) known.set(slide.id, at);

  const placed: Placed[] = [];
  const matched = new Set<string>();

  for (const [index, slide] of document.slides.entries()) {
    const id = options.ignoreIds === true ? undefined : slide.id;
    if (id === undefined) {
      placed.push({ slide });
      continue;
    }
    const at = known.get(id);
    // Creating it would half-apply a document written against another deck.
    if (at === undefined) {
      throw new AppError(
        "INVALID_ARGS",
        `The presentation has no slide with id "${id}" (document slide ${index}). The document was written against a different deck; drop the id to add the slide as a new one.`,
      );
    }
    if (matched.has(id)) {
      throw new AppError(
        "INVALID_ARGS",
        `The document names slide "${id}" more than once, so it does not describe one deck.`,
      );
    }
    matched.add(id);
    placed.push({ slide, match: { id, at } });
  }

  return { placed, matched };
}

/**
 * The requests that bring the deck's surviving slides into the document's
 * order — `forms/plan.ts`'s selection pass, for the same reason.
 *
 * Walk the target order, and whenever the slide in that position is not the one
 * wanted, move the wanted one back to it. Every move is therefore from a later
 * index to an earlier one, which is the only reading of `updateSlidesPosition`
 * that is unambiguous: its `insertionIndex` counts the arrangement *before* the
 * move, so moving a slide forwards would have to account for its own removal.
 */
function reorder(
  survivors: string[],
  target: string[],
  titles: Map<string, string>,
): { entries: SlidePlanEntry[]; requests: SlidesRequest[] } {
  const order = [...survivors];
  const entries: SlidePlanEntry[] = [];
  const requests: SlidesRequest[] = [];

  for (const [index, wanted] of target.entries()) {
    if (order[index] === wanted) continue;
    const from = order.indexOf(wanted, index + 1);
    if (from === -1) continue;
    order.splice(from, 1);
    order.splice(index, 0, wanted);
    entries.push({ action: "move", id: wanted, title: titles.get(wanted) ?? "", from, index });
    requests.push({ updateSlidesPosition: { slideObjectIds: [wanted], insertionIndex: index } });
  }
  return { entries, requests };
}

// --- Elements (0030 §3, as 0063 §2 narrows it) -------------------------------

/**
 * Whether two entries differ in anything but their text.
 *
 * This is what `elements` is still read-only *about* (0063 §2). An entry's
 * `text` is writable, because `insertText` addresses a shape by object id and
 * the id is in the document; its `id`, `kind` and `placeholder` are not, and
 * neither is the list's length. So a structural change is still refused, and
 * only that.
 */
function sameElementStructure(a: SlideElement, b: SlideElement): boolean {
  return a.id === b.id && a.kind === b.kind && a.placeholder === b.placeholder;
}

/**
 * Why a structural change cannot be honoured. The old version of this had a
 * second branch for a displaced placeholder, saying the write was not
 * implemented; 0063 §1 implemented it, so the only entry left that cannot be
 * addressed at all is one the deck gave no id.
 */
function whyUnwritable(element: SlideElement): string {
  return element.id === undefined
    ? "an entry with no id has nothing a request can address"
    : `${element.id} would have to be created, removed or re-typed, and this document models an element's text and nothing else about it`;
}

/**
 * What differs, in the only terms this comparison can honestly report.
 *
 * It is positional, not a diff: at the first entry that does not match there is
 * no way to tell an edit from an insertion that shifted everything after it. So
 * a difference in *count* is reported as one — prepending an entry says the
 * document lists more than the slide has, rather than claiming a text changed
 * that did not.
 */
function elementMismatch(wanted: number, actual: number): string {
  if (wanted === actual) return "an element's id, kind or placeholder changed";
  const listed = wanted === 1 ? "1 element" : `${wanted} elements`;
  const has = actual === 1 ? "1" : String(actual);
  return `the document lists ${listed} where the slide has ${has}`;
}

/** An element whose text the document changed, and the id to send it to. */
interface ElementEdit {
  objectId: string;
  from: string;
  to: string;
}

/**
 * Refuses a *structural* change to `elements`, and collects the text edits
 * (0030 §3 as narrowed by 0063 §2).
 *
 * An absent `elements` key is not a difference: the document is the desired
 * state for the fields it models, and a hand-authored slide that simply does
 * not mention the deck's text boxes is accepted. A key that is *there* is
 * compared entry for entry — but only its `id`, `kind` and `placeholder` are
 * compared, because those are what no request can change. `text` is what the
 * caller is here to edit.
 */
function planElements(
  slideId: string,
  document: SlideDocumentSlide,
  deck: SlideDocumentSlide,
): ElementEdit[] {
  const wanted = document.elements;
  if (wanted === undefined) return [];
  const actual = deck.elements ?? [];

  const refuse = (element: SlideElement): never => {
    throw new AppError(
      "INVALID_ARGS",
      `Slide ${slideId}: ${elementMismatch(wanted.length, actual.length)}, and \`elements\` models only an element's text — ${whyUnwritable(element)}. Nothing was written; restore the slide's \`elements\` as \`slides read\` emitted them, changing only their \`text\`.`,
    );
  };

  const edits: ElementEdit[] = [];
  for (const [index, element] of wanted.entries()) {
    const other = actual[index];
    if (other === undefined || !sameElementStructure(element, other)) refuse(element);
    if (element.id === undefined) {
      // Structurally identical to a deck entry that also has no id: there is
      // still nothing to address, so only an *unchanged* one is acceptable.
      if (element.text !== other?.text) refuse(element);
      continue;
    }
    if (element.text === other?.text) continue;
    edits.push({ objectId: element.id, from: other?.text ?? "", to: element.text ?? "" });
  }
  const dropped = actual[wanted.length];
  if (dropped !== undefined) refuse(dropped);
  return edits;
}

// --- Layouts ----------------------------------------------------------------

/** The deck's layouts by name and by id, which is how a document names one. */
function layoutIndex(presentation: PresentationRaw): Map<string, PageRaw> {
  const layouts = new Map<string, PageRaw>();
  for (const layout of presentation.layouts ?? []) {
    const { objectId } = layout;
    if (objectId) layouts.set(objectId, layout);
    const name = layout.layoutProperties?.name;
    // The id wins where a layout is named after another's id, which nothing
    // produces but the map cannot rule out.
    if (name && !layouts.has(name)) layouts.set(name, layout);
  }
  return layouts;
}

/**
 * Which layout a new slide is built from, and the layout page to read its
 * placeholders off.
 *
 * A layout of *this* deck is named by id, which is the more precise of the two
 * spellings and the only one that can also yield the placeholder types below.
 * It is not a guarantee: `createSlide` resolves **either** spelling against the
 * *current master* — the master of the slide before the insertion point — and
 * answers 400 when the layout is not one of that master's. A deck carrying two
 * themes can therefore refuse a layout this deck really has, and neither
 * spelling avoids it, because the master a new slide belongs to is decided by
 * where it lands rather than by what the document says.
 *
 * The predefined name is the fallback for a deck that reported no layouts at
 * all, and a name that is neither is an error — building the slide on `BLANK`
 * instead would silently produce a deck nobody asked for.
 */
function resolveLayout(
  name: string | undefined,
  layouts: Map<string, PageRaw>,
  index: number,
): { reference?: LayoutReferenceWrite; page?: PageRaw } {
  if (name === undefined) return {};
  const page = layouts.get(name);
  if (page !== undefined && page.objectId) return { reference: { layoutId: page.objectId }, page };
  if (PREDEFINED_LAYOUTS.has(name)) return { reference: { predefinedLayout: name } };
  const known = [...layouts.keys()].join(", ");
  throw new AppError(
    "INVALID_ARGS",
    `Document slide ${index} names layout "${name}", which the presentation does not have${known === "" ? "" : ` (it has ${known})`} and Slides does not predefine.`,
  );
}

// --- The plan ---------------------------------------------------------------

/**
 * The plan for applying `document` to `presentation` (decision 0030).
 *
 * The requests are ordered so that every index one of them names is the index
 * the deck has when it runs: the deletions first, then the moves that put the
 * survivors in the document's order, then the creates in ascending position —
 * by which point everything before each new slide is already in place — and
 * finally the text, which addresses shapes by id and needs no order at all.
 */
export function planSlideWrite(
  presentation: PresentationRaw,
  document: SlideDocument,
  options: SlidePlanOptions,
): SlidePlan {
  const current = toSlideDocument(presentation);
  const rawSlides = presentation.slides ?? [];
  const { placed, matched } = classify(current, document, options);

  const entries: SlidePlanEntry[] = [];
  const requests: SlidesRequest[] = [];
  const skipped: SkippedField[] = [];
  const newId = idFactory(presentation);
  const layouts = layoutIndex(presentation);

  // The deck's own title is its Drive name: `presentations.create` sets it and
  // no `batchUpdate` request touches it, so a renamed document is reported
  // rather than half-applied.
  if (document.title !== current.title) {
    skipped.push({ title: document.title, kind: "presentation.title" });
  }

  // Deletions. A slide the deck has and the document does not — and one the
  // deck gave no id is not among them: `deleteObject` addresses a slide by id,
  // so there is nothing to send, and no document could have named it either.
  const deletions: { id: string; slide: SlideDocumentSlide; index: number }[] = [];
  for (const [index, slide] of current.slides.entries()) {
    const { id } = slide;
    if (id === undefined || matched.has(id)) continue;
    deletions.push({ id, slide, index });
  }

  const deletionEntries: SlidePlanEntry[] = deletions.map(({ id, slide, index }) => ({
    action: "delete",
    id,
    title: titleOf(slide),
    index,
  }));

  if (deletions.length > 0 && !options.prune) {
    const what = deletions.map(({ slide, id }) => describe(titleOf(slide), id)).join(", ");
    const count = deletions.length === 1 ? "1 slide" : `${deletions.length} slides`;
    throw new AppError(
      "PRUNE_REQUIRED",
      `Applying this document would delete ${count} the presentation has and the document does not: ${what}. Nothing has been changed. Re-run with --prune to delete them, or put them back in the document.`,
      { data: refusedPlan(presentation.presentationId, deletionEntries) },
    );
  }

  entries.push(...deletionEntries);
  for (const { id } of deletions) {
    requests.push({ deleteObject: { objectId: id } });
  }

  // Moves, over what the deletions left.
  const deleted = new Set(deletions.map(({ index }) => index));
  const survivors = current.slides
    .filter((_, index) => !deleted.has(index))
    .map((slide) => slide.id ?? "");
  const titles = new Map(current.slides.map((slide) => [slide.id ?? "", titleOf(slide)]));
  const target: string[] = [];
  for (const entry of placed) if (entry.match !== undefined) target.push(entry.match.id);

  const moves = reorder(survivors, target, titles);
  entries.push(...moves.entries);
  requests.push(...moves.requests);

  // Creates, in ascending position: by the time each one runs, every document
  // slide before it is already there, so its position is its index.
  for (const [index, entry] of placed.entries()) {
    if (entry.match !== undefined) continue;
    const { slide } = entry;
    const { reference, page } = resolveLayout(slide.layout, layouts, index);
    const placeholders = page === undefined ? {} : layoutFieldPlaceholders(page);

    const objectId = newId("slide");
    const mappings: PlaceholderIdMappingWrite[] = [];
    const inserts: SlidesRequest[] = [];
    const fields: string[] = [];

    for (const field of ["title", "subtitle", "body"] as const) {
      const text = slide[field];
      if (text === undefined || text === "") continue;
      const layoutPlaceholder = placeholders[field];
      // The layout decides what a slide has. Asking for a placeholder it does
      // not offer creates nothing, so there would be nowhere to put the text.
      if (layoutPlaceholder === undefined) {
        skipped.push({ index, title: titleOf(slide), kind: field });
        continue;
      }
      const shapeId = newId(field);
      mappings.push({ layoutPlaceholder, objectId: shapeId });
      inserts.push({ insertText: { objectId: shapeId, insertionIndex: 0, text } });
      fields.push(field);
    }

    // A new slide's notes page has no id until the slide exists, and nothing in
    // this batch can learn one.
    if (slide.notes !== undefined && slide.notes !== "") {
      skipped.push({ index, title: titleOf(slide), kind: "notes" });
    }
    if (slide.elements !== undefined && slide.elements.length > 0) {
      skipped.push({ index, title: titleOf(slide), kind: "elements" });
    }

    requests.push({
      createSlide: {
        objectId,
        insertionIndex: index,
        ...(reference === undefined ? {} : { slideLayoutReference: reference }),
        ...(mappings.length === 0 ? {} : { placeholderIdMappings: mappings }),
      },
    });
    requests.push(...inserts);
    if (slide.skipped === true) {
      requests.push({
        updateSlideProperties: {
          objectId,
          slideProperties: { isSkipped: true },
          fields: "isSkipped",
        },
      });
      fields.push("skipped");
    }
    entries.push({
      action: "create",
      id: objectId,
      title: titleOf(slide),
      index,
      ...(fields.length === 0 ? {} : { fields }),
    });
  }

  // Updates, at the positions the document gives.
  for (const [index, entry] of placed.entries()) {
    const match = entry.match;
    if (match === undefined) continue;
    const { slide } = entry;
    const deck = current.slides[match.at];
    const raw = rawSlides[match.at];
    if (deck === undefined || raw === undefined) continue;

    // Refuses a structural change and hands back the text edits (0063 §1-§2).
    const elementEdits = planElements(match.id, slide, deck);

    const fields: string[] = [];
    const loss: string[] = [];
    const slideRequests: SlidesRequest[] = [];

    // A layout is not something a request can change; the API offers no
    // "re-apply this layout", and an absent one in the document means the
    // document does not say, not that the slide should lose it.
    if (slide.layout !== undefined && slide.layout !== deck.layout) {
      skipped.push({ index, title: titleOf(slide), kind: "layout" });
    }

    if ((slide.skipped === true) !== (deck.skipped === true)) {
      slideRequests.push({
        updateSlideProperties: {
          objectId: match.id,
          slideProperties: { isSkipped: slide.skipped === true },
          fields: "isSkipped",
        },
      });
      fields.push("skipped");
    }

    const targets: SlideTextTargets = slideTextTargets(raw);
    for (const field of TEXT_FIELDS) {
      const wanted = slide[field] ?? "";
      if (wanted === (deck[field] ?? "")) continue;
      const target = targets[field];
      if (target === undefined) {
        skipped.push({ index, title: titleOf(slide), kind: field });
        continue;
      }
      // 0030 §2: the change is the whole placeholder, and only the ones that
      // changed. `Range.Type.ALL` is what clears a shape without counting the
      // implicit newline the API says cannot be deleted.
      if (target.text !== "") {
        slideRequests.push({
          deleteText: { objectId: target.objectId, textRange: { type: "ALL" } },
        });
      }
      if (wanted !== "") {
        slideRequests.push({
          insertText: { objectId: target.objectId, insertionIndex: 0, text: wanted },
        });
      }
      fields.push(field);
      if (target.runs > 1) loss.push(field);
    }

    // 0063 §1: the entry's own id is the address, so an element is the same
    // pair of requests a placeholder gets. 0063 §3: the rewrite drops inline
    // formatting here too, and a hand-placed box is likelier to be styled than
    // a placeholder is, so the warning matters more rather than less.
    for (const edit of elementEdits) {
      if (edit.from !== "") {
        slideRequests.push({ deleteText: { objectId: edit.objectId, textRange: { type: "ALL" } } });
      }
      if (edit.to !== "") {
        slideRequests.push({
          insertText: { objectId: edit.objectId, insertionIndex: 0, text: edit.to },
        });
      }
      fields.push(edit.objectId);
      if (elementRuns(raw, edit.objectId) > 1) loss.push(edit.objectId);
    }

    if (slideRequests.length === 0) continue;
    requests.push(...slideRequests);
    entries.push({
      action: "update",
      id: match.id,
      title: titleOf(slide),
      index,
      fields,
      ...(loss.length === 0 ? {} : { formatting_loss: loss }),
    });
  }

  // In document order, whichever pass found them; the deck's own first.
  skipped.sort((a, b) => (a.index ?? -1) - (b.index ?? -1));
  return { entries, requests, skipped };
}

/**
 * The plan for filling a deck that was just created (decision 0030 §4). The
 * deck holds the one slide Slides puts in every new presentation and nothing
 * else, so every document slide is new and the ids it came with are read-only
 * fields from wherever it was read — which is what makes
 * `slides read A > d.yaml && slides create B --file d.yaml` a copy rather than
 * an error. `title` is the command's argument, and it wins over the document's.
 *
 * `prune` is on because the default slide is exactly what has to go, and it is
 * the only thing that can: the deck was empty a moment ago.
 */
export function planSlideCreate(
  presentation: PresentationRaw,
  document: SlideDocument,
  title: string,
): SlidePlan {
  return planSlideWrite(presentation, { ...document, title }, { prune: true, ignoreIds: true });
}
