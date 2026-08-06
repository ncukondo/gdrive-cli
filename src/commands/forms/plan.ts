import { AppError } from "../../types/index.ts";
import {
  itemUpdateMask,
  toApiItem,
  toDocumentItem,
  type FormDocument,
  type FormItem,
  type FormRaw,
  type ItemRaw,
  type ItemWrite,
} from "../../lib/form-document.ts";
import type { FormsRequest } from "../../lib/forms-api.ts";

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
 * An item the document asked to *add* that 0028 §2 forbids a request for. An
 * `unsupported` node carries the API's own resource under `raw`, not the
 * document's shape, so there is nothing to create from; one that is already in
 * the form keeps its place untouched, and only a new one is a request that
 * cannot be made. Reported through 0021 §3's channel rather than as a plan
 * entry, because nothing was planned.
 */
export interface SkippedItem {
  /** Its position in the document, which is the only thing that names it. */
  index: number;
  title: string;
}

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
    if (item.type === "unsupported") {
      skipped.push({ index, title: titleOf(item) });
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

  if (deletions.length > 0 && !options.prune) {
    const what = deletions
      .map(({ raw }) => describe(titleOf(raw), raw.itemId ?? undefined))
      .join(", ");
    const count = deletions.length === 1 ? "1 item" : `${deletions.length} items`;
    throw new AppError(
      "PRUNE_REQUIRED",
      `Applying this document would delete ${count} the form has and the document does not: ${what}. Deleting a question deletes its responses with it, and nothing has been changed. Re-run with --prune to delete them, or put them back in the document.`,
    );
  }

  for (const { raw, index } of deletions) {
    entries.push({
      action: "delete",
      ...(raw.itemId ? { id: raw.itemId } : {}),
      title: titleOf(raw),
      index,
    });
  }
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
    const item = toApiItem(entry.item);
    if (item === null) continue;
    entries.push({ action: "create", title: titleOf(entry.item), index });
    requests.push({ createItem: { item: withoutIds(item), location: { index } } });
  }

  // Updates, at the positions the document gives.
  for (const [index, entry] of placed.entries()) {
    const id = entry.id;
    if (id === undefined) continue;
    // 0028 §2: no request at all for an item the schema could not model.
    const item = toApiItem(entry.item);
    const existing = byId.get(id);
    if (item === null || existing === undefined) continue;
    const projected = toApiItem(toDocumentItem(existing));
    if (projected !== null && deepEqual(withoutIds(item), withoutIds(projected))) continue;
    entries.push({ action: "update", id, title: titleOf(entry.item), index });
    requests.push({
      updateItem: { item, location: { index }, updateMask: itemUpdateMask(entry.item, existing) },
    });
  }

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
