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

/**
 * A page element. Every kind but `shape` is declared `unknown`: the document
 * reports a kind and, for a shape, its text, so nothing else is read. The
 * kinds are still named here because the projection reports the *key*, and a
 * key googleapis adds later has to reach `unknown` rather than be missed.
 */
export interface PageElementRaw {
  objectId?: string | null;
  shape?: ShapeRaw;
  image?: unknown;
  table?: unknown;
  sheetsChart?: unknown;
  video?: unknown;
  line?: unknown;
  elementGroup?: unknown;
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
 * Read-only (0029 §3): everything a template did not put on the slide, listed
 * so a hand-built deck does not read as empty. 0030 §3 makes editing one an
 * error rather than a silent no-op.
 */
const SlideElementSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(ELEMENT_KINDS),
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
const FIELD_BY_PLACEHOLDER: Record<string, "title" | "subtitle" | "body"> = {
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
  const text = textOf(element.shape);
  const { objectId } = element;
  return {
    ...(objectId ? { id: objectId } : {}),
    kind: kindOf(element),
    ...(text === "" ? {} : { text }),
  };
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
 * A slide's placeholders and, for everything else, its `elements` (0029 §3).
 *
 * A placeholder is projected on its text alone: an empty one is omitted rather
 * than emitted as `""`, and one whose field is already taken — a second `BODY`
 * on a two-column layout, a type this document has no field for — falls
 * through to `elements` rather than losing its text, which is the outcome
 * 0029 §3 exists to prevent.
 */
function toSlide(slide: PageRaw, layoutName: (id: string) => string): SlideDocumentSlide {
  const named: { title?: string; subtitle?: string; body?: string } = {};
  const elements: SlideElement[] = [];

  for (const element of slide.pageElements ?? []) {
    const { shape } = element;
    const placeholderType = shape?.placeholder?.type;
    if (placeholderType !== undefined && placeholderType !== null) {
      const text = textOf(shape);
      if (text === "") continue;
      const field = FIELD_BY_PLACEHOLDER[placeholderType];
      if (field !== undefined && named[field] === undefined) {
        named[field] = text;
        continue;
      }
    }
    elements.push(toElement(element));
  }

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
