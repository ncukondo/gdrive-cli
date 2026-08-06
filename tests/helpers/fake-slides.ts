import type { PresentationRaw } from "../../src/lib/slide-document.ts";
import type { BatchUpdatePresentationParams, SlidesClient } from "../../src/lib/slides-api.ts";

export interface FakeSlidesOptions {
  /** What `presentations.get` returns; omitting it leaves the method throwing. */
  presentation?: PresentationRaw;
  /**
   * What `presentations.create` hands back, minus the title, which comes from
   * the request. A real create returns the whole resource — the default slide
   * and the theme's layouts included — so the fake does too.
   */
  created?: PresentationRaw;
  /** Thrown by `presentations.batchUpdate` alone, for the conflict tests. */
  batchError?: unknown;
  /** Thrown instead, for the error-mapping tests. */
  error?: unknown;
}

export interface FakeSlides {
  client: SlidesClient;
  /** Every call the wrapper made, e.g. `presentations.get`. */
  calls: string[];
  /** The presentation id each call carried. */
  ids: string[];
  /** Every `presentations.batchUpdate` body, so a test can assert what was sent. */
  batches: BatchUpdatePresentationParams[];
  /** The title of every `presentations.create`. */
  createdTitles: string[];
}

/**
 * A {@link SlidesClient} backed by fixed data (decision 0012). Shared by the
 * `lib/slides-api` tests and the `slides` commands so they cannot disagree
 * about the shape of a presentation.
 */
export function createFakeSlides(options: FakeSlidesOptions = {}): FakeSlides {
  const calls: string[] = [];
  const ids: string[] = [];
  const batches: BatchUpdatePresentationParams[] = [];
  const createdTitles: string[] = [];

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
      create: async ({ requestBody }) => {
        calls.push("presentations.create");
        if (options.error !== undefined) throw options.error;
        createdTitles.push(requestBody.title);
        return {
          data: { presentationId: "1NeWdEcK", ...options.created, title: requestBody.title },
        };
      },
      batchUpdate: async (params) => {
        calls.push("presentations.batchUpdate");
        ids.push(params.presentationId);
        if (options.batchError !== undefined) throw options.batchError;
        if (options.error !== undefined) throw options.error;
        batches.push(params);
        return { data: { presentationId: params.presentationId } };
      },
    },
  };

  return { client, calls, ids, batches, createdTitles };
}
