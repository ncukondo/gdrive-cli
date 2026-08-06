import type { PresentationRaw } from "../../src/lib/slide-document.ts";
import type { SlidesClient } from "../../src/lib/slides-api.ts";

export interface FakeSlidesOptions {
  /** What `presentations.get` returns; omitting it leaves the method throwing. */
  presentation?: PresentationRaw;
  /** Thrown instead, for the error-mapping tests. */
  error?: unknown;
}

export interface FakeSlides {
  client: SlidesClient;
  /** Every call the wrapper made, e.g. `presentations.get`. */
  calls: string[];
  /** The presentation id each call carried. */
  ids: string[];
}

/**
 * A {@link SlidesClient} backed by fixed data (decision 0012). Shared by the
 * `lib/slides-api` tests and the `slides` commands so they cannot disagree
 * about the shape of a presentation.
 */
export function createFakeSlides(options: FakeSlidesOptions = {}): FakeSlides {
  const calls: string[] = [];
  const ids: string[] = [];

  const client: SlidesClient = {
    presentations: {
      get: async ({ presentationId }) => {
        calls.push("presentations.get");
        ids.push(presentationId);
        if (options.error !== undefined) throw options.error;
        if (options.presentation === undefined) {
          throw new Error(`no presentation in the fake: ${presentationId}`);
        }
        return { data: options.presentation };
      },
    },
  };

  return { client, calls, ids };
}
