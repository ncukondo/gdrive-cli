import { mapDriveError as mapApiError } from "./api.ts";
import { AppError } from "../types/index.ts";
import type { PresentationRaw } from "./slide-document.ts";

/**
 * The Slides v1 client port (decision 0029). The raw presentation shapes live
 * in `slide-document.ts` next to the projection that consumes them, as the
 * form's do — what is here is the client and nothing else.
 *
 * Slides needs no new OAuth scope: `presentations.get` accepts the `drive`
 * scope [0005](../../decisions/0005-auth-and-scopes.md) already requests.
 */

// --- The write side (decision 0030) -----------------------------------------

/**
 * Which layout a new slide is built from. Two spellings, one meaning: a layout
 * of *this* presentation by id, or one of Slides' predefined layouts by name.
 * `plan.ts` prefers the id, because it has read the deck's own layouts and an
 * id cannot be resolved against the wrong master.
 */
export type LayoutReferenceWrite = { layoutId: string } | { predefinedLayout: string };

/**
 * Which placeholder of the layout becomes which shape on the new slide. Only
 * the type and the index are needed to name the layout's, says the generated
 * type; `objectId` is the id the created one gets, which is the whole point —
 * without it there is nothing for the following `insertText` to address.
 */
export interface PlaceholderIdMappingWrite {
  layoutPlaceholder: { type: string; index: number };
  objectId: string;
}

/**
 * The `batchUpdate` requests this CLI sends (decision 0030). There is no
 * request that sets a shape's text, so a change is `deleteText` then
 * `insertText`; and `updateSlideProperties` carries `isSkipped` alone, because
 * every other field of `SlideProperties` — `layoutObjectId`, `masterObjectId`,
 * `notesPage` — is documented read-only and would be sent beside a mask that
 * cannot name it.
 *
 * `google-clients.ts` checks every member and field here against the generated
 * `slides_v1.Schema$Request`, the way it does for Docs and Forms.
 */
export type SlidesRequest =
  | {
      createSlide: {
        objectId: string;
        insertionIndex: number;
        slideLayoutReference?: LayoutReferenceWrite;
        placeholderIdMappings?: PlaceholderIdMappingWrite[];
      };
    }
  | { deleteObject: { objectId: string } }
  | { updateSlidesPosition: { slideObjectIds: string[]; insertionIndex: number } }
  | {
      updateSlideProperties: {
        objectId: string;
        slideProperties: { isSkipped: boolean };
        fields: string;
      };
    }
  // `Range.Type.ALL` "will use the correct bounds", which is the only way to
  // clear a shape without counting the implicit trailing newline the API says
  // cannot be deleted.
  | { deleteText: { objectId: string; textRange: { type: "ALL" } } }
  | { insertText: { objectId: string; insertionIndex: number; text: string } };

export interface BatchUpdatePresentationParams {
  presentationId: string;
  requestBody: {
    requests: SlidesRequest[];
    writeControl?: { requiredRevisionId: string };
  };
}

export interface SlidesClient {
  presentations: {
    get: (params: { presentationId: string }) => Promise<{ data: PresentationRaw }>;
    /**
     * The request body is a whole presentation and the API ignores all but the
     * title — "Other fields in the request, including any provided content, are
     * ignored", says the generated type — so the port offers the one field that
     * has an effect rather than a shape that pretends otherwise.
     */
    create: (params: { requestBody: { title: string } }) => Promise<{ data: PresentationRaw }>;
    batchUpdate: (
      params: BatchUpdatePresentationParams,
    ) => Promise<{ data: { presentationId?: string | null } }>;
  };
}

// --- Wrapper operations -----------------------------------------------------

export async function getPresentation(
  client: SlidesClient,
  presentationId: string,
): Promise<PresentationRaw> {
  try {
    const res = await client.presentations.get({ presentationId });
    return res.data;
  } catch (error) {
    mapApiError(error);
  }
}

/**
 * Creates a deck holding the one slide Slides puts in every new presentation.
 *
 * The whole resource is returned rather than an id and a title: `create`
 * (0030 §4) has to delete that default slide, and building the document's own
 * slides needs the theme's layouts, which arrive in the same response.
 */
export async function createPresentation(
  client: SlidesClient,
  title: string,
): Promise<PresentationRaw> {
  try {
    const res = await client.presentations.create({ requestBody: { title } });
    return res.data;
  } catch (error) {
    mapApiError(error);
  }
}

/**
 * Whether a failure is the API refusing a stale `requiredRevisionId`. The twin
 * of `forms-api.ts`'s, and narrow for the same reason: a 400 has many other
 * causes, and telling a caller to re-read when the request was malformed sends
 * them round a loop that cannot end.
 */
function isRevisionConflict(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const { code } = error;
  if (code !== 400 && code !== 409) return false;
  return /revision/i.test(error.message);
}

/**
 * Applies a planned batch. `revisionId` is the one the document was read at
 * (decision 0028 §5, adopted by 0030 §1): sent, it makes a deck edited in the
 * browser meanwhile fail instead of being overwritten; absent, the write is
 * unconditional, which is what a hand-authored document gets.
 */
export async function batchUpdatePresentation(
  client: SlidesClient,
  presentationId: string,
  requests: SlidesRequest[],
  revisionId?: string,
): Promise<void> {
  try {
    await client.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests,
        ...(revisionId !== undefined ? { writeControl: { requiredRevisionId: revisionId } } : {}),
      },
    });
  } catch (error) {
    if (revisionId !== undefined && isRevisionConflict(error)) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new AppError(
        "API_ERROR",
        `The presentation changed since it was read at revision ${revisionId}, so nothing was written: ${detail}. Read the presentation again and apply your edit to the fresh document.`,
      );
    }
    mapApiError(error);
  }
}
