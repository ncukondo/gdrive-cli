import { mapDriveError as mapApiError } from "./api.ts";
import type { PresentationRaw } from "./slide-document.ts";

/**
 * The Slides v1 client port (decision 0029). The raw presentation shapes live
 * in `slide-document.ts` next to the projection that consumes them, as the
 * form's do — what is here is the client and nothing else.
 *
 * Slides needs no new OAuth scope: `presentations.get` accepts the `drive`
 * scope [0005](../../decisions/0005-auth-and-scopes.md) already requests.
 */
export interface SlidesClient {
  presentations: {
    get: (params: { presentationId: string }) => Promise<{ data: PresentationRaw }>;
  };
}

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
