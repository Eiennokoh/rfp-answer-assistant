import { existsSync, readFileSync } from "node:fs";
import { readCsvRecords, requireColumns } from "./csv.js";
import type { LibraryEntry, RfpQuestion } from "./types.js";

export function loadLibrary(path: string): LibraryEntry[] {
  const recs = readCsvRecords(path);
  requireColumns(recs, ["id", "category", "question", "answer"], path);
  return recs.map((r) => ({
    id: r.id,
    category: r.category,
    question: r.question,
    answer: r.answer,
    lastUpdated: r.last_updated ?? "",
  }));
}

export function loadQuestions(path: string): RfpQuestion[] {
  const recs = readCsvRecords(path);
  requireColumns(recs, ["question_id", "question"], path);
  return recs.map((r) => ({ questionId: r.question_id, question: r.question }));
}

export function loadSensitiveTerms(path: string | undefined): string[] {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}
