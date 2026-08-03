import type { FormRaw } from "../../src/lib/form-document.ts";
import type { FormResponseRaw, FormsClient } from "../../src/lib/forms-api.ts";

export interface FakeFormsOptions {
  /** What `forms.get` returns; omitting it leaves the method throwing. */
  form?: FormRaw;
  /**
   * What `forms.responses.list` returns, one array per page. The fake hands
   * out a `nextPageToken` for every page but the last, so a caller that reads
   * only the first page is visibly wrong.
   */
  pages?: FormResponseRaw[][];
  /** Thrown by `forms.get`, for the error-mapping tests. */
  error?: unknown;
}

export interface FakeForms {
  client: FormsClient;
  /** Every call the wrapper made, e.g. `forms.get` — 0027 §6 costs exactly two. */
  calls: string[];
  /** The page token each `forms.responses.list` call carried. */
  pageTokens: (string | undefined)[];
}

/**
 * A {@link FormsClient} backed by fixed data (decision 0012). Shared by the
 * `lib/forms-api` tests and both `forms` commands so they agree on the shape.
 */
export function createFakeForms(options: FakeFormsOptions = {}): FakeForms {
  const calls: string[] = [];
  const pageTokens: (string | undefined)[] = [];
  const pages = options.pages ?? [[]];

  const client: FormsClient = {
    forms: {
      get: async ({ formId }) => {
        calls.push("forms.get");
        if (options.error !== undefined) throw options.error;
        if (options.form === undefined) throw new Error(`no form in the fake: ${formId}`);
        return { data: options.form };
      },
      responses: {
        list: async ({ pageToken }) => {
          calls.push("forms.responses.list");
          pageTokens.push(pageToken);
          const index = pageToken === undefined ? 0 : Number(pageToken);
          const responses = pages[index] ?? [];
          const hasMore = index + 1 < pages.length;
          return {
            data: {
              responses,
              ...(hasMore ? { nextPageToken: String(index + 1) } : {}),
            },
          };
        },
      },
    },
  };

  return { client, calls, pageTokens };
}
