import { describe, expect, it } from "vitest";
import { refusedPlan } from "./prune-refusal.ts";

/**
 * The refusal payload is tested without a command around it for the reason
 * `after-create.test.ts` is: it is a shape two command families depend on
 * agreeing about, and it is the half of a failure a caller parses.
 */
describe("refusedPlan", () => {
  const deletions = [
    { action: "delete", id: "i2", title: "Watch this", index: 1 },
    { action: "delete", id: "i3", title: "Anything else?", index: 2 },
  ];

  it("is the success envelope's data with applied false", () => {
    expect(refusedPlan("1FoRm", deletions).payload).toEqual({
      id: "1FoRm",
      plan: deletions,
      applied: false,
    });
  });

  it("gives -q one id per line, which is what $(…) can take", () => {
    expect(refusedPlan("1FoRm", deletions).quiet).toBe("i2\ni3");
  });

  /**
   * A form item the form gave no id is deleted by position, so there is no id
   * to print. It must not become a blank line: a caller reading `-q` into a
   * list would get an empty element that names nothing.
   */
  it("skips an entry with no id rather than printing an empty line", () => {
    const anonymous: { action: string; id?: string; title: string; index: number }[] = [
      { action: "delete", title: "No id here", index: 3 },
    ];
    expect(refusedPlan("1FoRm", anonymous).quiet).toBe("");
    expect(refusedPlan("1FoRm", [...deletions, ...anonymous]).quiet).toBe("i2\ni3");
  });

  /**
   * The message already names the items (0028 §3). A `text` summary under it
   * would be the same list twice, and an assertion that it is absent is the
   * only thing that keeps somebody from adding one back without a reason.
   */
  it("adds nothing under the error in text mode", () => {
    expect(refusedPlan("1FoRm", deletions).text).toBeUndefined();
  });

  it("omits the id when the API did not return one", () => {
    expect(refusedPlan(undefined, deletions).payload).toEqual({
      plan: deletions,
      applied: false,
    });
    expect(refusedPlan(null, deletions).payload).toEqual({ plan: deletions, applied: false });
  });
});
