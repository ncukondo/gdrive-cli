import type { FormRaw } from "../../src/lib/form-document.ts";
import type { BatchUpdateParams, FormResponseRaw, FormsClient } from "../../src/lib/forms-api.ts";

export interface FakeFormsOptions {
  /** What `forms.get` returns; omitting it leaves the method throwing. */
  form?: FormRaw;
  /**
   * The form `forms.get` returns *after* a `forms.batchUpdate` has run, so a
   * test can tell a read of the old revision from a read of the new one.
   */
  formAfterUpdate?: FormRaw;
  /** The id `forms.create` hands back; the title comes from the request. */
  createdId?: string;
  /** Thrown by `forms.batchUpdate` alone, for the conflict tests. */
  batchError?: unknown;
  /**
   * What `forms.responses.list` returns, one array per page. The fake hands
   * out a `nextPageToken` for every page but the last, so a caller that reads
   * only the first page is visibly wrong.
   */
  pages?: FormResponseRaw[][];
  /** Thrown by whichever method is called, for the error-mapping tests. */
  error?: unknown;
}

export interface FakeForms {
  client: FormsClient;
  /** Every call the wrapper made, e.g. `forms.get` — 0027 §6 costs exactly two. */
  calls: string[];
  /** The page token each `forms.responses.list` call carried. */
  pageTokens: (string | undefined)[];
  /** Every `forms.batchUpdate` body, so a test can assert what was sent. */
  batches: BatchUpdateParams[];
  /** Every title `forms.create` was given. */
  created: string[];
}

/**
 * A {@link FormsClient} backed by fixed data (decision 0012). Shared by the
 * `lib/forms-api` tests and both `forms` commands so they agree on the shape.
 */
export function createFakeForms(options: FakeFormsOptions = {}): FakeForms {
  const calls: string[] = [];
  const pageTokens: (string | undefined)[] = [];
  const batches: BatchUpdateParams[] = [];
  const created: string[] = [];
  const pages = options.pages ?? [[]];

  const client: FormsClient = {
    forms: {
      get: async ({ formId }) => {
        calls.push("forms.get");
        if (options.error !== undefined) throw options.error;
        const current =
          batches.length > 0 && options.formAfterUpdate !== undefined
            ? options.formAfterUpdate
            : options.form;
        if (current === undefined) throw new Error(`no form in the fake: ${formId}`);
        return { data: current };
      },
      create: async ({ requestBody }) => {
        calls.push("forms.create");
        if (options.error !== undefined) throw options.error;
        created.push(requestBody.info.title);
        return {
          data: {
            formId: options.createdId ?? "1NeWfOrM",
            info: { title: requestBody.info.title },
          },
        };
      },
      batchUpdate: async (params) => {
        calls.push("forms.batchUpdate");
        if (options.batchError !== undefined) throw options.batchError;
        if (options.error !== undefined) throw options.error;
        batches.push(params);
        return { data: {} };
      },
      responses: {
        list: async ({ pageToken }) => {
          calls.push("forms.responses.list");
          if (options.error !== undefined) throw options.error;
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

  return { client, calls, pageTokens, batches, created };
}
