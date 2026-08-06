import { describe, expect, it, vi } from "vitest";
import { AppError, type ErrorData } from "../types/index.ts";
import { afterCreate } from "./after-create.ts";

const NEW = { id: "1NeW", title: "Q4 review" };

function dataOf(error: unknown): ErrorData | undefined {
  return error instanceof AppError ? error.data : undefined;
}

async function failing<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a failure");
}

describe("afterCreate", () => {
  const boom = async () => {
    throw new AppError("API_ERROR", "Forms said no");
  };

  it("moves the file into the parent before it runs the fill", async () => {
    const calls: string[] = [];
    const moveFile = vi.fn(async () => {
      calls.push("move");
    });
    await afterCreate(NEW, { parentId: "1FoLdEr", moveFile }, async () => {
      calls.push("fill");
    });
    expect(moveFile).toHaveBeenCalledWith("1NeW", "1FoLdEr");
    expect(calls).toEqual(["move", "fill"]);
  });

  it("moves nothing when no parent was asked for, and answers what the fill did", async () => {
    const moveFile = vi.fn(async () => {});
    const answer = await afterCreate(NEW, { parentId: undefined, moveFile }, async () => 7);
    expect(answer).toBe(7);
    expect(moveFile).not.toHaveBeenCalled();
  });

  /**
   * Decision 0031 §4: `success: false` stops implying nothing happened. What
   * happened here is a file the caller never got told about, so the id is the
   * whole point — it is what `gdrive rm` needs.
   */
  it("names the file the fill left behind, in the parent it reached", async () => {
    const error = await failing(
      afterCreate(NEW, { parentId: "1FoLdEr", moveFile: async () => {} }, boom),
    );
    expect(error).toBeInstanceOf(AppError);
    expect(dataOf(error)?.payload).toEqual({
      id: "1NeW",
      title: "Q4 review",
      parent_id: "1FoLdEr",
    });
    expect(dataOf(error)?.text).toContain("1NeW");
    expect(dataOf(error)?.text).toContain("1FoLdEr");
    expect(dataOf(error)?.quiet).toBe("1NeW");
  });

  /**
   * `parent_id` is the placement, not the request: absent means the file is
   * still where its create put it, which is My Drive's root. A caller that
   * reads it as "where to look" is then right in both cases.
   */
  it("omits parent_id when the move itself is what failed, and fills nothing", async () => {
    const fill = vi.fn(async () => {});
    const error = await failing(
      afterCreate(
        NEW,
        {
          parentId: "1FoLdEr",
          moveFile: async () => {
            throw new AppError("PERMISSION_DENIED", "Drive said no");
          },
        },
        fill,
      ),
    );
    expect(dataOf(error)?.payload).toEqual({ id: "1NeW", title: "Q4 review" });
    expect(dataOf(error)?.text).toContain("My Drive");
    // Writing into a file the caller was never told about compounds the
    // failure; the move failing stops the run where it stands.
    expect(fill).not.toHaveBeenCalled();
  });

  /**
   * `mapDriveError` sets `transient` for a 429 or a 5xx — Drive asking for a
   * pause rather than refusing — and only the move can produce one here, since
   * it is the only Drive call. Nothing above a `create` retries today, so this
   * changes no behaviour; what it prevents is a retry added later reading a
   * rate limit as a refusal because the re-wrap flattened it.
   *
   * `copy-tree.ts` drops the flag at its own wrap, which is correct there for a
   * reason that does not hold here: that wrap sits *outside* `withRetry`, so by
   * the time it runs the flag has already been acted on.
   */
  it("carries transient through the re-wrap, because nothing here has consumed it", async () => {
    const error = await failing(
      afterCreate(
        NEW,
        {
          parentId: "1FoLdEr",
          moveFile: async () => {
            throw new AppError("API_ERROR", "Rate limit exceeded", { transient: true });
          },
        },
        async () => {},
      ),
    );
    expect(error).toMatchObject({ transient: true });
    expect(dataOf(error)?.payload).toEqual({ id: "1NeW", title: "Q4 review" });
  });

  it("does not invent transient for an ordinary failure", async () => {
    const error = await failing(afterCreate(NEW, { parentId: undefined, moveFile: vi.fn() }, boom));
    expect(error).toMatchObject({ transient: false });
  });

  it("names the file a fill failed on when no parent was asked for", async () => {
    const error = await failing(afterCreate(NEW, { parentId: undefined, moveFile: vi.fn() }, boom));
    expect(dataOf(error)?.payload).toEqual({ id: "1NeW", title: "Q4 review" });
  });

  it("keeps the failure's own code and message", async () => {
    const error = await failing(
      afterCreate(NEW, { parentId: undefined, moveFile: vi.fn() }, async () => {
        throw new AppError("PERMISSION_DENIED", "Forms said no");
      }),
    );
    expect(error).toMatchObject({ code: "PERMISSION_DENIED", message: "Forms said no" });
  });

  /**
   * A dropped socket is a plain `Error` and a bug in this program is a
   * `TypeError`; neither is an `AppError`, and requiring one would throw the id
   * away for the failure least likely to have been anticipated. `copy-tree.ts`
   * made the same call for the same reason.
   */
  it("attaches the report to a failure that is not an AppError", async () => {
    const error = await failing(
      afterCreate(NEW, { parentId: undefined, moveFile: vi.fn() }, async () => {
        throw new TypeError("undefined is not a function");
      }),
    );
    expect(error).toMatchObject({ code: "API_ERROR", message: "undefined is not a function" });
    expect(dataOf(error)?.payload).toEqual({ id: "1NeW", title: "Q4 review" });
  });

  /** A title Drive accepted can hold a newline; one line under the error stays one line. */
  it("keeps a title holding a newline on one line", async () => {
    const error = await failing(
      afterCreate(
        { id: "1NeW", title: "Q4\nreview" },
        { parentId: undefined, moveFile: vi.fn() },
        boom,
      ),
    );
    expect(dataOf(error)?.text).not.toContain("\n");
  });
});
