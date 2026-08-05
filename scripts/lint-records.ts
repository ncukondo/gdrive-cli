#!/usr/bin/env bun
/**
 * Fails a commit that breaks one of the rules holding `decisions/` and `tasks/`
 * together (decisions 0032 and 0047).
 *
 * `decisions/0032` made every record frozen and dated, and paid for that with a
 * reader who walks the directory from the highest number down. Three small
 * obligations keep that walk possible, and each is invisible when it is missed:
 * a committed file that gets edited reads as current, a new record with no index
 * row is a relationship nobody can see, and a `Status` line that does not name
 * `revises` or `extends` breaks the only signal the walk has. §5 adds a fourth:
 * a task whose status says done while its file is still in `tasks/` is a second
 * answer to a question the code already settles.
 *
 * None of the four is hard to notice once it has gone wrong months later, and
 * that is exactly the problem `decisions/0047` §1 exists to end.
 *
 * Usage: `bun scripts/lint-records.ts` — reads the staged diff and exits 1 with
 * what to do about each finding.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** A record file: four digits, a slug, `.md`. `README.md` is not one. */
const DECISION_FILE = /^decisions\/(\d{4}-[^/]+\.md)$/;

/**
 * The verbs a `Status` line may use to name what a record does to an earlier
 * one. 0032 §3 glosses two of them — `revises` narrows or contradicts, `extends`
 * adds without contradicting — and says the wording is "already in use", which
 * makes the corpus the authority rather than that sentence. `corrects` entered
 * the corpus with 0046, for a record that fixes a factual claim in an earlier
 * one without changing the position it took.
 *
 * A verb added here is a verb some record already uses. That order matters: this
 * list follows the records, and a list that led them would be this file
 * legislating.
 */
export const RELATIONSHIPS = ["revises", "extends", "corrects"] as const;

/**
 * What a `Status` line has to look like, in one place so every caller teaches
 * the same thing. `.claude/hooks/guard-record-edit.ts` prints this at the moment
 * an edit is refused, which is the moment a new record gets written.
 */
export const STATUS_FORMAT =
  `A Status line reads "accepted", optionally followed by "— <verb>" and a link,\n` +
  `where <verb> is one of: ${RELATIONSHIPS.join(", ")}.\n` +
  `"revises" narrows or contradicts; "extends" adds without contradicting;\n` +
  `"corrects" fixes a factual claim without changing the position taken.\n` +
  `The new file carries the pointer; the old one gains nothing (0032 §3).`;

export interface StagedFile {
  /** The `git diff --cached --name-status` letter: `A`, `M`, `D`, `R`, … */
  status: string;
  path: string;
}

export interface RecordFinding {
  path: string;
  message: string;
}

/**
 * Whether `path` names a decision record, as opposed to the index or a
 * directory guide beside it. Repository-relative; a caller holding an absolute
 * path makes it relative first.
 *
 * `.claude/hooks/guard-record-edit.ts` uses this to refuse the edit before it
 * is written, which is the half of 0032 §3 a commit hook is too late for.
 */
export function isDecisionRecord(path: string): boolean {
  return DECISION_FILE.test(path);
}

/**
 * 0032 §3: a committed decision is not edited again — "not its `Decision`, not
 * its `Context`, not its `Status` line, and not a table or a list inside it".
 * A rename counts, because every link to the file is by name.
 */
export function checkDecisionEdits(staged: StagedFile[]): RecordFinding[] {
  return staged
    .filter((file) => DECISION_FILE.test(file.path) && file.status[0] !== "A")
    .map((file) => ({
      path: file.path,
      message:
        `${file.path} is a committed decision and 0032 §3 does not allow it to change.\n` +
        `    Write the new position as a new number, in full, with a Status line\n` +
        `    naming the relationship: "accepted — revises [NNNN](NNNN-slug.md)".\n` +
        `    A typo or a broken link is the only exception, and it is a person's\n` +
        `    call to make with "git commit --no-verify" (decision 0047 §2).`,
    }));
}

/**
 * 0032 §4: the index is "the map for that walk", and its Consequences make it
 * load-bearing — "a new decision is not finished until its row is there".
 */
export function checkIndexRow(addedDecisions: string[], indexSource: string): RecordFinding[] {
  return addedDecisions
    .map((path) => DECISION_FILE.exec(path))
    .filter((match) => match !== null)
    .filter((match) => !indexSource.includes(`(${match[1]})`))
    .map((match) => ({
      path: `decisions/${match[1]}`,
      message:
        `decisions/README.md has no row linking ${match[1]}.\n` +
        `    Reading down from the highest number is the only way to find the\n` +
        `    current position on a topic, and the index is where a "revises" or\n` +
        `    "extends" is visible without opening either file. Add the row in this\n` +
        `    commit (0032 §4).`,
    }));
}

/** The `Status:` line joined with any lines it wraps onto, or null when absent. */
function statusDeclaration(source: string): string | null {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.startsWith("Status:"));
  if (start === -1) return null;

  const parts = [lines[start] ?? ""];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") break;
    parts.push(line.trim());
  }
  return parts.join(" ");
}

/**
 * 0032 §3 fixes the wording a new record uses to state its relationship, and
 * §4 makes that wording the thing a reader navigates by. `superseded by` is
 * named because it is the form 0032 removed: it can only be written by editing
 * the file being superseded, which is the edit §3 forbids.
 */
export function checkStatusLine(path: string, source: string): RecordFinding[] {
  const declaration = statusDeclaration(source);
  const wanted = STATUS_FORMAT.split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

  if (declaration === null) {
    return [{ path, message: `${path} has no Status line.\n${wanted}` }];
  }
  if (declaration.includes("superseded")) {
    return [
      {
        path,
        message:
          `${path} uses a superseded status, which 0032 §3 removed.\n` +
          `    It can only be written by editing the file being superseded, and a\n` +
          `    reader walking down from the top never needs an old file to announce\n` +
          `    its own obsolescence (0032 §4).\n${wanted}`,
      },
    ];
  }

  const rest = declaration.replace(/^Status:\s*accepted/, "");
  if (declaration === rest) {
    return [{ path, message: `${path}'s Status line does not begin "accepted".\n${wanted}` }];
  }
  if (rest.trim() === "") return [];

  const names = new RegExp(String.raw`—\s*(${RELATIONSHIPS.join("|")})\b`).test(rest);
  const links = /\[\d{4}\]\(\d{4}-[^)]+\.md\)/.test(rest);
  if (names && links) return [];

  return [
    {
      path,
      message:
        `${path}'s Status line says more than "accepted" but does not name a\n` +
        `    relationship and link it.\n${wanted}`,
    },
  ];
}

/** A plan-table row: the link target in the first cell, the status in the fourth. */
const PLAN_ROW = /^\|\s*\[[^\]]*\]\(([^)]+)\)\s*\|[^|]*\|[^|]*\|([^|]*)\|/;

/**
 * 0032 §5: "a merged task is archived at once, in the commit that follows its
 * merge … not at the end of a batch and not at the next release". The failure
 * this catches is the halfway one — the row's status flips and the file does not
 * move — which leaves a task that reads as current sitting where a fresh reader
 * picks work from.
 */
export function checkArchivedTasks(planSource: string): RecordFinding[] {
  const findings: RecordFinding[] = [];

  for (const line of planSource.split("\n")) {
    const row = PLAN_ROW.exec(line);
    if (row === null) continue;

    const [, target = "", rawStatus = ""] = row;
    const status = rawStatus.trim();
    if (status === "todo" || status === "in-progress") continue;
    if (target.startsWith("archive/")) continue;

    findings.push({
      path: `tasks/${target}`,
      message:
        `tasks/README.md marks ${target} "${status}" while it still links outside\n` +
        `    archive/. A task decides what to build while there is no code to read,\n` +
        `    so it expires the moment the code lands; every day it stays in tasks/ it\n` +
        `    is a second answer to a question the code answers better (0032 §5).\n` +
        `    Move the file to tasks/archive/, keeping the filename, and point the row\n` +
        `    at it in the same commit.`,
    });
  }

  return findings;
}

/** `git diff --cached --name-status`, with a rename reported at its new path. */
function stagedFiles(): StagedFile[] {
  const out = execFileSync("git", ["diff", "--cached", "--name-status", "-z"], {
    encoding: "utf8",
  });
  const fields = out.split("\0").filter((field) => field !== "");
  const staged: StagedFile[] = [];

  for (let i = 0; i < fields.length; i++) {
    const status = fields[i] ?? "";
    // A rename or a copy is followed by two paths; everything else by one.
    const takesTwo = status.startsWith("R") || status.startsWith("C");
    const path = fields[i + (takesTwo ? 2 : 1)] ?? "";
    i += takesTwo ? 2 : 1;
    staged.push({ status, path });
  }
  return staged;
}

/** The staged content of `path`, or the working tree's when it is not staged. */
function stagedContent(path: string): string {
  try {
    return execFileSync("git", ["show", `:${path}`], { encoding: "utf8" });
  } catch {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  }
}

if (import.meta.main) {
  const staged = stagedFiles();
  const added = staged
    .filter((file) => file.status.startsWith("A") && DECISION_FILE.test(file.path))
    .map((file) => file.path);

  const findings = [
    ...checkDecisionEdits(staged),
    ...(added.length > 0 ? checkIndexRow(added, stagedContent("decisions/README.md")) : []),
    ...added.flatMap((path) => checkStatusLine(path, stagedContent(path))),
    ...(staged.some((file) => file.path === "tasks/README.md")
      ? checkArchivedTasks(stagedContent("tasks/README.md"))
      : []),
  ];

  if (findings.length > 0) {
    process.stderr.write(
      `${findings.length} record problem(s) in the staged commit — see\n` +
        `decisions/0032-decisions-are-append-only.md.\n\n`,
    );
    for (const finding of findings) process.stderr.write(`  ${finding.message}\n\n`);
    process.exit(1);
  }
}
