import { AppError } from "../../types/index.ts";
import {
  isWritableItem,
  itemUpdateMask,
  toApiItem,
  toDocumentItem,
  type FormDocument,
  type FormItem,
  type FormRaw,
  type ItemRaw,
  type ItemWrite,
  type OptionWrite,
} from "../../lib/form-document.ts";
import type { FormsRequest } from "../../lib/forms-api.ts";
import { refusedPlan } from "../../lib/prune-refusal.ts";

/**
 * Turning a document into a list of edits (decision 0028 §1). Pure and separate
 * from both commands, because it is the piece that decides whether a question's
 * responses survive an edit, and the piece most likely to be read again.
 */

export type PlanAction = "form_info" | "create" | "update" | "move" | "delete";

/** One line of the plan `write` reports (decision 0028 §4). */
export interface PlanEntry {
  action: PlanAction;
  /** The item's id. Absent on a create — the API assigns one — and on `form_info`. */
  id?: string;
  /** What names it to a reader: the item's title, or the form's. */
  title: string;
  /** Where the item ends up (create, move) or is (update, delete). */
  index?: number;
  /** Where a moved item was. */
  from?: number;
}

/**
 * Something the document asked for that no request can carry. Reported through
 * 0021 §3's channel rather than as a plan entry, because nothing was planned —
 * the point is that a caller learns the edit did not happen instead of reading
 * a success and assuming it did.
 */
export interface SkippedItem {
  /** Its position in the document, which is the only thing that names it. */
  index: number;
  title: string;
  /** The API field that could not be sent — the vocabulary `read` reports in. */
  kind: string;
}

/**
 * What names each kind of item {@link isWritableItem} refuses, so the report
 * says which of the two reasons applies. The guard is `isWritableItem` itself;
 * this only supplies the label.
 */
const UNWRITABLE_KIND: Partial<Record<FormItem["type"], string>> = {
  unsupported: "unsupported",
  file_upload: "fileUploadQuestion",
};

export interface FormPlan {
  entries: PlanEntry[];
  requests: FormsRequest[];
  skipped: SkippedItem[];
}

/** Structural equality, so a document identical to the form plans nothing. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => deepEqual(Reflect.get(a, key), Reflect.get(b, key)));
}

/**
 * The item with its ids removed. They are output-only (0028 §6): carried on an
 * update so the mask can leave them alone, and dropped from a create, where the
 * API would otherwise take a copied id as the one to assign.
 */
function withoutIds(item: ItemWrite): ItemWrite {
  const { itemId: _itemId, questionItem, ...rest } = item;
  if (questionItem === undefined) return rest;
  const { questionId: _questionId, ...question } = questionItem.question;
  return { ...rest, questionItem: { question } };
}

/** The options of a choice question, or nothing for any other item. */
function optionsOf(item: ItemWrite): OptionWrite[] {
  return item.questionItem?.question.choiceQuestion?.options ?? [];
}

/**
 * `Option.goToSectionId` is an **item id** — "Item ID of section header to go
 * to", says the generated type — naming an item of whatever form the document
 * was read from. A new form has none of those ids, so it is dropped on the
 * create-everything path for the same reason 0028 §1 refuses to create an item
 * from an `id` the form does not have: the target would point at nothing.
 * `goToAction` is a constant, not an id, and travels fine.
 */
function withoutSectionTargets(item: ItemWrite): ItemWrite {
  const questionItem = item.questionItem;
  const choice = questionItem?.question.choiceQuestion;
  if (questionItem === undefined || choice === undefined) return item;
  return {
    ...item,
    questionItem: {
      question: {
        ...questionItem.question,
        choiceQuestion: {
          ...choice,
          options: choice.options.map((option) => {
            const { goToSectionId: _target, ...rest } = option;
            return rest;
          }),
        },
      },
    },
  };
}

/** An item's own content, without the ids that name it rather than describe it. */
function contentOf(item: FormItem): Record<string, unknown> {
  const bare: Record<string, unknown> = { ...item };
  delete bare.id;
  delete bare.question_id;
  return bare;
}

function titleOf(item: FormItem | ItemRaw): string {
  return item.title ?? "";
}

/** How the refusal and the errors name an item a reader has to go find. */
function describe(title: string, id: string | undefined): string {
  const name = title === "" ? "an untitled item" : `"${title}"`;
  return id === undefined ? name : `${name} (${id})`;
}

interface PlanOptions {
  prune: boolean;
  /** Every item is new, whatever id it carries — what `forms create` needs. */
  ignoreIds?: boolean;
}

/** A document item that will hold a position in the form, and the id it matched. */
interface Placed {
  item: FormItem;
  id?: string;
}

function classify(
  form: FormRaw,
  document: FormDocument,
  options: PlanOptions,
): { placed: Placed[]; skipped: SkippedItem[]; matched: Set<string> } {
  const known = new Set<string>();
  for (const raw of form.items ?? []) if (raw.itemId) known.add(raw.itemId);

  const placed: Placed[] = [];
  const skipped: SkippedItem[] = [];
  const matched = new Set<string>();

  for (const [index, item] of document.items.entries()) {
    const id = options.ignoreIds === true ? undefined : item.id;
    if (id !== undefined) {
      // Creating it would half-apply a document written against another form.
      if (!known.has(id)) {
        throw new AppError(
          "INVALID_ARGS",
          `The form has no item with id "${id}" (document item ${index}). The document was written against a different form; drop the id to add ${describe(titleOf(item), undefined)} as a new item.`,
        );
      }
      if (matched.has(id)) {
        throw new AppError(
          "INVALID_ARGS",
          `The document names item "${id}" more than once, so it does not describe one form.`,
        );
      }
      matched.add(id);
      placed.push({ item, id });
      continue;
    }
    // Nothing can create it, so it never holds a position either — the items
    // after it land where the rest of the document puts them.
    if (!isWritableItem(item)) {
      skipped.push({ index, title: titleOf(item), kind: UNWRITABLE_KIND[item.type] ?? item.type });
      continue;
    }
    placed.push({ item });
  }

  return { placed, skipped, matched };
}

/**
 * The requests that bring the form's surviving items into the document's order.
 *
 * A selection pass rather than a diff: walk the target order, and whenever the
 * item in that position is not the one wanted, move the wanted one back to it.
 * Every move is therefore from a later index to an earlier one, which is the
 * only reading of `moveItem` that is unambiguous — remove, then insert.
 */
function reorder(
  survivors: string[],
  target: string[],
  titles: Map<string, string>,
): { entries: PlanEntry[]; requests: FormsRequest[] } {
  const order = [...survivors];
  const entries: PlanEntry[] = [];
  const requests: FormsRequest[] = [];

  for (const [index, wanted] of target.entries()) {
    if (order[index] === wanted) continue;
    const from = order.indexOf(wanted, index + 1);
    if (from === -1) continue;
    order.splice(from, 1);
    order.splice(index, 0, wanted);
    entries.push({ action: "move", id: wanted, title: titles.get(wanted) ?? "", from, index });
    requests.push({
      moveItem: { originalLocation: { index: from }, newLocation: { index } },
    });
  }
  return { entries, requests };
}

/**
 * The plan for applying `document` to `form` (decision 0028 §1).
 *
 * The requests are ordered so that every index one of them names is the index
 * the form has when it runs: the form's info first, then the deletions from the
 * last position backwards, then the moves that put the survivors in the
 * document's order, then the creates in ascending position — by which point
 * everything before each new item is already in place — and finally the updates,
 * at the positions the document itself gives.
 */
export function planFormWrite(
  form: FormRaw,
  document: FormDocument,
  options: PlanOptions,
): FormPlan {
  const current = form.items ?? [];
  const { placed, skipped, matched } = classify(form, document, options);

  const entries: PlanEntry[] = [];
  const requests: FormsRequest[] = [];

  // The form's own fields. `description` is named in the mask whether or not
  // the document has one — the document is the desired state for what it
  // models — and nothing about settings is sent at all: the document carries
  // none, so an `updateSettings` derived from it would say `isQuiz: false`,
  // which deletes every question's grading.
  const description = document.description ?? "";
  if (
    document.title !== (form.info?.title ?? "") ||
    description !== (form.info?.description ?? "")
  ) {
    entries.push({ action: "form_info", title: document.title });
    requests.push({
      updateFormInfo: {
        info: {
          title: document.title,
          ...(document.description !== undefined ? { description: document.description } : {}),
        },
        updateMask: "title,description",
      },
    });
  }

  // Deletions. An item the form has and the document does not — including one
  // the form gave no id, which no document could have named.
  const deletions = current
    .map((raw, index) => ({ raw, index }))
    .filter(
      ({ raw }) => !(raw.itemId !== undefined && raw.itemId !== null && matched.has(raw.itemId)),
    );

  const deletionEntries: PlanEntry[] = deletions.map(({ raw, index }) => ({
    action: "delete",
    ...(raw.itemId ? { id: raw.itemId } : {}),
    title: titleOf(raw),
    index,
  }));

  if (deletions.length > 0 && !options.prune) {
    const what = deletions
      .map(({ raw }) => describe(titleOf(raw), raw.itemId ?? undefined))
      .join(", ");
    const count = deletions.length === 1 ? "1 item" : `${deletions.length} items`;
    throw new AppError(
      "PRUNE_REQUIRED",
      `Applying this document would delete ${count} the form has and the document does not: ${what}. Deleting a question deletes its responses with it, and nothing has been changed. Re-run with --prune to delete them, or put them back in the document.`,
      { data: refusedPlan(form.formId, deletionEntries) },
    );
  }

  entries.push(...deletionEntries);
  // Backwards, so an earlier deletion never moves a later one's target.
  for (const { index } of [...deletions].reverse()) {
    requests.push({ deleteItem: { location: { index } } });
  }

  // Moves, over what the deletions left.
  const deleted = new Set(deletions.map(({ index }) => index));
  const survivors = current
    .filter((_, index) => !deleted.has(index))
    .map((raw) => raw.itemId ?? "");
  const titles = new Map(current.map((raw) => [raw.itemId ?? "", titleOf(raw)]));
  const target: string[] = [];
  for (const entry of placed) if (entry.id !== undefined) target.push(entry.id);

  const moves = reorder(survivors, target, titles);
  entries.push(...moves.entries);
  requests.push(...moves.requests);

  // Creates, in ascending position: by the time each one runs, every document
  // item before it is already there, so its position is its index.
  const byId = new Map<string, ItemRaw>();
  for (const raw of current) if (raw.itemId) byId.set(raw.itemId, raw);

  for (const [index, entry] of placed.entries()) {
    if (entry.id !== undefined) continue;
    const built = toApiItem(entry.item);
    // `classify` kept only what a request can carry, so this cannot be null.
    if (built === null) continue;

    let item = withoutIds(built);
    // On the create-everything path every section target is an id of the form
    // the document was read from, and names nothing in this one.
    if (options.ignoreIds === true && optionsOf(built).some((o) => o.goToSectionId !== undefined)) {
      skipped.push({ index, title: titleOf(entry.item), kind: "option.goToSectionId" });
      item = withoutSectionTargets(item);
    }
    entries.push({ action: "create", title: titleOf(entry.item), index });
    requests.push({ createItem: { item, location: { index } } });
  }

  // Updates, at the positions the document gives.
  for (const [index, entry] of placed.entries()) {
    const id = entry.id;
    if (id === undefined) continue;
    const existing = byId.get(id);
    if (existing === undefined) continue;

    const item = toApiItem(entry.item);
    // 0028 §2: no request at all for an item no request can carry. It keeps its
    // place, but an edit to it cannot be applied — so say so, rather than
    // reporting a success that changed nothing the caller asked for.
    if (item === null) {
      if (!deepEqual(contentOf(entry.item), contentOf(toDocumentItem(existing)))) {
        skipped.push({
          index,
          title: titleOf(entry.item),
          kind: UNWRITABLE_KIND[entry.item.type] ?? entry.item.type,
        });
      }
      continue;
    }

    const projected = toApiItem(toDocumentItem(existing));
    if (projected !== null && deepEqual(withoutIds(item), withoutIds(projected))) continue;
    entries.push({ action: "update", id, title: titleOf(entry.item), index });
    requests.push({
      updateItem: { item, location: { index }, updateMask: itemUpdateMask(entry.item, existing) },
    });
  }

  // In document order, whichever pass found them.
  skipped.sort((a, b) => a.index - b.index);
  return { entries, requests, skipped };
}

/**
 * The plan for filling a form that was just created (decision 0028 §7). The
 * form is empty, so every item is new and the ids the document came with are
 * read-only fields from wherever it was read (0028 §6) — which is what makes
 * `forms read A > f.yaml && forms create B --file f.yaml` a copy rather than an
 * error. `title` is the command's argument, and it wins over the document's.
 */
export function planFormCreate(document: FormDocument, title: string): FormPlan {
  return planFormWrite(
    { info: { title }, items: [] },
    { ...document, title },
    {
      prune: true,
      ignoreIds: true,
    },
  );
}
