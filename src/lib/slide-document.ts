import YAML from "yaml";
import { z } from "zod";
import { AppError } from "../types/index.ts";

/**
 * The deck document (decision 0029): one YAML projection of a presentation,
 * emitted by `slides read` and accepted back by `slides write` (0030). Both
 * directions live in this file, as `form-document.ts` holds both of a form's.
 *
 * The one thing to know before reading further: geometry never appears. A
 * `pageElement` carries a `transform` and a `size` in EMU and the array is
 * z-order rather than reading order, and 0029 §2 keeps all of it out of the
 * document in both directions. What a deck *says* is here; what it looks like
 * stays in the template.
 */

// --- Raw Slides v1 shapes (only the fields we read) -------------------------

export interface TextRunRaw {
  content?: string | null;
}

export interface TextElementRaw {
  textRun?: TextRunRaw;
  /**
   * Where a paragraph starts. Declared but never read: what it carries — the
   * bullet, the alignment — is styling, and it is here so that counting the
   * runs of a shape's text cannot mistake a paragraph break for one.
   */
  paragraphMarker?: unknown;
  autoText?: unknown;
}

export interface TextContentRaw {
  textElements?: TextElementRaw[] | null;
}

export interface PlaceholderRaw {
  type?: string | null;
  index?: number | null;
}

export interface ShapeRaw {
  placeholder?: PlaceholderRaw;
  shapeType?: string | null;
  text?: TextContentRaw;
}

/** Several elements joined into one, which the document reports as its members. */
export interface GroupRaw {
  children?: PageElementRaw[] | null;
}

/**
 * A page element. Every kind but `shape` and `elementGroup` is declared
 * `unknown`: the document reports a kind and, for a shape, its text, so nothing
 * else is read. The kinds are still named here because the projection reports
 * the *key*, and a key googleapis adds later has to reach `unknown` rather than
 * be missed.
 */
export interface PageElementRaw {
  objectId?: string | null;
  shape?: ShapeRaw;
  image?: unknown;
  table?: unknown;
  sheetsChart?: unknown;
  video?: unknown;
  line?: unknown;
  elementGroup?: GroupRaw;
  wordArt?: unknown;
  speakerSpotlight?: unknown;
  size?: unknown;
  transform?: unknown;
  title?: string | null;
  description?: string | null;
}

export interface LayoutPropertiesRaw {
  name?: string | null;
  displayName?: string | null;
}

export interface NotesPropertiesRaw {
  speakerNotesObjectId?: string | null;
}

export interface SlidePropertiesRaw {
  isSkipped?: boolean | null;
  layoutObjectId?: string | null;
  notesPage?: PageRaw;
}

export interface PageRaw {
  objectId?: string | null;
  pageElements?: PageElementRaw[] | null;
  layoutProperties?: LayoutPropertiesRaw;
  notesProperties?: NotesPropertiesRaw;
  slideProperties?: SlidePropertiesRaw;
}

export interface PresentationRaw {
  presentationId?: string | null;
  title?: string | null;
  revisionId?: string | null;
  slides?: PageRaw[] | null;
  layouts?: PageRaw[] | null;
}

// --- The document schema (decision 0029 §2, §3) -----------------------------

/**
 * The kinds an `elements` entry reports. `unknown` is the floor: the kind is
 * read off the element's own keys, so an element type newer than this CLI is
 * still listed with its id instead of vanishing from the slide.
 */
export const ELEMENT_KINDS = [
  "shape",
  "image",
  "table",
  "chart",
  "video",
  "line",
  "group",
  "word_art",
  "speaker_spotlight",
  "unknown",
] as const;

export type ElementKind = (typeof ELEMENT_KINDS)[number];

/**
 * Read-only (0029 §3): everything the document has no field for, listed so a
 * hand-built deck does not read as empty. 0030 §3 makes editing one an error
 * rather than a silent no-op.
 *
 * `placeholder` is 0051 §2's distinction, carrying the API's own placeholder
 * type (`BODY`, `SLIDE_NUMBER`, …) for an entry that *is* a layout placeholder
 * — the second `BODY` of a two-column slide, say — and absent for a shape
 * outside every layout. The two look identical otherwise and their futures are
 * not the same: the API would rewrite the first as readily as the `body` above
 * it, while nothing can put the second back under a layout. Which one an entry
 * is decides what a refusal to write it means, so the document says it rather
 * than leaving a caller to infer it from an id.
 */
const SlideElementSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(ELEMENT_KINDS),
  placeholder: z.string().optional(),
  text: z.string().optional(),
});

/**
 * As in `form-document.ts`, the keys are declared in the order the projection
 * emits them — what the slide *is* before what it says — because zod hands the
 * parsed keys back in declaration order, and a document that went out through
 * `parseSlideDocument` and back through `slideDocumentToYaml` would otherwise
 * come out reordered.
 */
const SlideSchema = z.object({
  id: z.string().optional(),
  layout: z.string().optional(),
  skipped: z.boolean().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  notes: z.string().optional(),
  elements: z.array(SlideElementSchema).optional(),
});

export const SlideDocumentSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  revision_id: z.string().optional(),
  slides: z.array(SlideSchema),
});

export type SlideDocument = z.infer<typeof SlideDocumentSchema>;
export type SlideDocumentSlide = z.infer<typeof SlideSchema>;
export type SlideElement = z.infer<typeof SlideElementSchema>;

// --- API resource → document ------------------------------------------------

const KIND_BY_API: Record<string, ElementKind> = {
  shape: "shape",
  image: "image",
  table: "table",
  sheetsChart: "chart",
  video: "video",
  line: "line",
  elementGroup: "group",
  wordArt: "word_art",
  speakerSpotlight: "speaker_spotlight",
};

/** What every element carries whatever its kind — so what is left is the kind. */
const ELEMENT_META = new Set(["objectId", "size", "transform", "title", "description"]);

/**
 * The document field a placeholder type fills. `CENTERED_TITLE` is the title
 * slide's title and `TITLE` every other layout's, and a caller editing a deck
 * should not have to know which layout it landed on to find the heading.
 */
export type NamedField = "title" | "subtitle" | "body";

const FIELD_BY_PLACEHOLDER: Record<string, NamedField> = {
  TITLE: "title",
  CENTERED_TITLE: "title",
  SUBTITLE: "subtitle",
  BODY: "body",
};

/**
 * A shape's text, paragraphs joined by the newlines the API already put
 * between them. The API terminates the last paragraph too, and that trailing
 * newline is an artefact of the representation rather than something anyone
 * typed, so one is dropped.
 */
function textOf(shape: ShapeRaw | undefined): string {
  const elements = shape?.text?.textElements ?? [];
  const text = elements.map((element) => element.textRun?.content ?? "").join("");
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** The first key that is not carried by every element — the kind's own. */
function kindOf(element: PageElementRaw): ElementKind {
  const key = Object.keys(element).find((name) => !ELEMENT_META.has(name));
  return KIND_BY_API[key ?? ""] ?? "unknown";
}

function toElement(element: PageElementRaw): SlideElement {
  const { objectId, shape } = element;
  const placeholder = shape?.placeholder?.type;
  const text = textOf(shape);
  return {
    ...(objectId ? { id: objectId } : {}),
    kind: kindOf(element),
    ...(placeholder ? { placeholder } : {}),
    ...(text === "" ? {} : { text }),
  };
}

/**
 * The element as the document lists it — a group as its members rather than as
 * itself, recursively, because a group is a way of moving shapes together and
 * carries no text of its own. Reporting the wrapper alone would drop every word
 * inside it, and grouping two text boxes is an ordinary thing to do.
 *
 * A group holding nothing is still listed, so no element ever disappears
 * without something in the document standing for it.
 */
function toElements(element: PageElementRaw): SlideElement[] {
  const children = element.elementGroup?.children ?? [];
  if (children.length === 0) return [toElement(element)];
  return children.flatMap(toElements);
}

/**
 * Which page element wins each named field, by position in `pageElements`.
 *
 * The winner is the placeholder with the lowest `placeholder.index`, not the
 * first one the array offers: `pageElements` is z-order (0029 §2), so taking
 * the first would let "bring to front" in the Slides UI swap which column of a
 * two-column slide is `body` — with no text edited, and with 0030's write then
 * rewriting the wrong one. `index` is the API's own answer to which placeholder
 * of a repeated type this is, and it does not move.
 *
 * An empty placeholder never competes: it says nothing, so it is dropped
 * (neither a field nor an element) whatever its index.
 */
function fieldWinners(pageElements: PageElementRaw[]): Map<number, NamedField> {
  const best = new Map<NamedField, { position: number; index: number }>();
  pageElements.forEach((element, position) => {
    const { shape } = element;
    const type = shape?.placeholder?.type;
    if (!type || textOf(shape) === "") return;
    const field = FIELD_BY_PLACEHOLDER[type];
    if (field === undefined) return;
    const index = shape?.placeholder?.index ?? 0;
    const current = best.get(field);
    if (current === undefined || index < current.index) best.set(field, { position, index });
  });

  const winners = new Map<number, NamedField>();
  for (const [field, { position }] of best) winners.set(position, field);
  return winners;
}

/**
 * The speaker notes: the `BODY` placeholder on the slide's notes page, whose
 * id the page names in `speakerNotesObjectId`. The id is preferred over the
 * placeholder type because the API documents it as the answer; the type is the
 * fallback for a notes page that did not carry one.
 */
function notesOf(slideProperties: SlidePropertiesRaw | undefined): string {
  const page = slideProperties?.notesPage;
  if (page === undefined) return "";
  const elements = page.pageElements ?? [];
  const speakerNotesObjectId = page.notesProperties?.speakerNotesObjectId;
  const byId = speakerNotesObjectId
    ? elements.find((element) => element.objectId === speakerNotesObjectId)
    : undefined;
  const notes = byId ?? elements.find((element) => element.shape?.placeholder?.type === "BODY");
  return textOf(notes?.shape);
}

/**
 * A slide's named fields and, for everything the document has no field for,
 * its `elements` (0051 §1).
 *
 * A placeholder is projected on its text alone: an empty one is omitted rather
 * than emitted as `""`, and one whose field is taken by a lower-indexed
 * placeholder — the second `BODY` of a two-column layout, a `SLIDE_NUMBER`
 * with text — falls through to `elements` rather than losing its text, which
 * is the outcome 0029 §3 exists to prevent. It is marked as a placeholder
 * there (0051 §2), because that is what says whether a write could ever reach
 * it.
 */
function toSlide(slide: PageRaw, layoutName: (id: string) => string): SlideDocumentSlide {
  const pageElements = slide.pageElements ?? [];
  const winners = fieldWinners(pageElements);
  const named: { title?: string; subtitle?: string; body?: string } = {};
  const elements: SlideElement[] = [];

  pageElements.forEach((element, position) => {
    const { shape } = element;
    const placeholderType = shape?.placeholder?.type;
    if (placeholderType !== undefined && placeholderType !== null) {
      const text = textOf(shape);
      if (text === "") return;
      const field = winners.get(position);
      if (field !== undefined) {
        named[field] = text;
        return;
      }
    }
    elements.push(...toElements(element));
  });

  const { objectId, slideProperties } = slide;
  const layoutObjectId = slideProperties?.layoutObjectId;
  const notes = notesOf(slideProperties);
  return {
    ...(objectId ? { id: objectId } : {}),
    ...(layoutObjectId ? { layout: layoutName(layoutObjectId) } : {}),
    ...(slideProperties?.isSkipped === true ? { skipped: true } : {}),
    ...(named.title === undefined ? {} : { title: named.title }),
    ...(named.subtitle === undefined ? {} : { subtitle: named.subtitle }),
    ...(named.body === undefined ? {} : { body: named.body }),
    ...(notes === "" ? {} : { notes }),
    ...(elements.length === 0 ? {} : { elements }),
  };
}

/**
 * Projects a presentation onto the document (0029 §2).
 *
 * The layout names are indexed once: a deck's `layouts` are a handful of pages,
 * but every slide needs one, and a scan per slide makes the cost of reading a
 * hundred-slide deck quadratic in nothing anyone can see.
 */
export function toSlideDocument(presentation: PresentationRaw): SlideDocument {
  const names = new Map<string, string>();
  for (const layout of presentation.layouts ?? []) {
    const { objectId } = layout;
    const name = layout.layoutProperties?.name;
    if (objectId && name) names.set(objectId, name);
  }
  // A deck built on a custom layout has no predefined name to report, so it is
  // reported by the id it does have (0029 §2).
  const layoutName = (id: string): string => names.get(id) ?? id;

  const { presentationId, revisionId } = presentation;
  return {
    ...(presentationId ? { id: presentationId } : {}),
    title: presentation.title ?? "",
    ...(revisionId ? { revision_id: revisionId } : {}),
    slides: (presentation.slides ?? []).map((slide) => toSlide(slide, layoutName)),
  };
}

// --- Document → API (decision 0030) -----------------------------------------

/**
 * The shape a field's text lives in, and what a rewrite of it would cost.
 *
 * `runs` is how many text runs the shape's text is made of. There is no request
 * that sets a shape's text, so a change deletes the text and inserts the
 * replacement, and the per-run styling goes with it — 0030 §2 warns on every
 * rewritten placeholder that had more than one run. That over-reports slightly:
 * two plain paragraphs are two runs with no styling between them. It is the
 * count the API's own representation offers, and warning about a paragraph
 * break that carried a bullet is the failure this is meant to catch.
 */
export interface TextTarget {
  objectId: string;
  text: string;
  runs: number;
}

export type SlideTextTargets = Partial<Record<NamedField | "notes", TextTarget>>;

function runsOf(shape: ShapeRaw | undefined): number {
  return (shape?.text?.textElements ?? []).filter((element) => element.textRun !== undefined)
    .length;
}

/** The notes shape's own text target, or nothing when the slide has no notes page. */
function notesTarget(slideProperties: SlidePropertiesRaw | undefined): TextTarget | undefined {
  const page = slideProperties?.notesPage;
  if (page === undefined) return undefined;
  const elements = page.pageElements ?? [];
  const speakerNotesObjectId = page.notesProperties?.speakerNotesObjectId;
  const byId = speakerNotesObjectId
    ? elements.find((element) => element.objectId === speakerNotesObjectId)
    : undefined;
  const notes = byId ?? elements.find((element) => element.shape?.placeholder?.type === "BODY");
  // The page's own id wins over the shape's: the API documents it as the notes
  // shape's address whether or not the shape exists yet, and inserting text
  // through it creates one.
  const objectId = speakerNotesObjectId ?? notes?.objectId;
  if (!objectId) return undefined;
  return { objectId, text: textOf(notes?.shape), runs: runsOf(notes?.shape) };
}

/**
 * Which shape each of a slide's named fields is written to (0030 §2).
 *
 * The mirror of {@link fieldWinners}, and it has to agree with it: the shape a
 * field is written to must be the one its text was read from, or an edit to
 * `body` rewrites a column the caller never saw. It differs in one way only —
 * an empty placeholder is a target here, though it is not projected — because
 * filling in a field the deck left blank is an ordinary edit, and the read side
 * omits an empty placeholder rather than emitting `""`.
 */
export function slideTextTargets(slide: PageRaw): SlideTextTargets {
  const best = new Map<NamedField, { target: TextTarget; index: number }>();

  for (const element of slide.pageElements ?? []) {
    const { objectId, shape } = element;
    const type = shape?.placeholder?.type;
    if (!objectId || !type) continue;
    const field = FIELD_BY_PLACEHOLDER[type];
    if (field === undefined) continue;

    const text = textOf(shape);
    const index = shape?.placeholder?.index ?? 0;
    const current = best.get(field);
    // A placeholder with text wins whatever its index — it is the one the
    // projection named — and between two of a kind the lowest index wins, as
    // it does there.
    const wins =
      current === undefined ||
      (current.target.text === "" && text !== "") ||
      ((current.target.text === "") === (text === "") && index < current.index);
    if (wins) best.set(field, { target: { objectId, text, runs: runsOf(shape) }, index });
  }

  const targets: SlideTextTargets = {};
  for (const [field, { target }] of best) targets[field] = target;
  const notes = notesTarget(slide.slideProperties);
  if (notes !== undefined) targets.notes = notes;
  return targets;
}

/** A layout's placeholder, as `createSlide` names it: only the type and index. */
export interface LayoutPlaceholder {
  type: string;
  index: number;
}

/**
 * Which placeholder of a layout each named field comes from, so a new slide's
 * text has somewhere to go (0030 §1).
 *
 * The types are read off the layout rather than assumed: a `TITLE` layout's
 * heading is a `CENTERED_TITLE`, and a `createSlide` naming a placeholder the
 * layout does not have creates nothing for the `insertText` after it to
 * address. Where a layout repeats a type — `TITLE_AND_TWO_COLUMNS` has two
 * `BODY`s — the lowest index wins, which is the rule the read side applies to
 * a slide.
 */
export function layoutFieldPlaceholders(
  layout: PageRaw,
): Partial<Record<NamedField, LayoutPlaceholder>> {
  const found: Partial<Record<NamedField, LayoutPlaceholder>> = {};
  for (const element of layout.pageElements ?? []) {
    const placeholder = element.shape?.placeholder;
    const type = placeholder?.type;
    if (!type) continue;
    const field = FIELD_BY_PLACEHOLDER[type];
    if (field === undefined) continue;
    const index = placeholder?.index ?? 0;
    const current = found[field];
    if (current === undefined || index < current.index) found[field] = { type, index };
  }
  return found;
}

// --- Document ⇄ YAML --------------------------------------------------------

/**
 * Serializes the document. `lineWidth: 0` disables folding, for the reason
 * `formDocumentToYaml` gives: a body re-wrapped by its length is not something
 * anyone can diff.
 */
export function slideDocumentToYaml(document: SlideDocument): string {
  return YAML.stringify(document, { lineWidth: 0 });
}

/**
 * Parses a document, the entry point `slides write` (0030) will build its plan
 * from. Anything the schema does not accept is `INVALID_ARGS`: the document is
 * an argument, and the caller's next action is to fix it.
 */
export function parseSlideDocument(text: string): SlideDocument {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError("INVALID_ARGS", `Invalid YAML: ${message}`);
  }

  const result = SlideDocumentSchema.safeParse(parsed);
  if (!result.success) {
    const [issue] = result.error.issues;
    const where =
      issue === undefined || issue.path.length === 0 ? "" : ` at ${issue.path.join(".")}`;
    const why = issue === undefined ? "unexpected shape" : issue.message;
    throw new AppError("INVALID_ARGS", `Invalid deck document${where}: ${why}`);
  }
  return result.data;
}
