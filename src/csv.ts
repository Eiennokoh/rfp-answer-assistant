import { readFileSync } from "node:fs";

/**
 * 依存ライブラリを増やさないための最小限の CSV パーサー。
 * ダブルクォート囲み・クォート内のカンマ／改行・"" エスケープに対応。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, ""); // BOM 付き（Excel 保存）でも読めるように

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** 1行目をヘッダーとしてオブジェクト配列に変換する */
export function readCsvRecords(path: string): Record<string, string>[] {
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r, i) => {
    if (r.length > header.length) {
      // 「3,150億円」のようにカンマを含む値をクォートし忘れると列がずれる。黙って読まずに止める
      throw new Error(`${path} の ${i + 2} 行目の列数が多すぎます。カンマを含む値は "..." で囲んでください`);
    }
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = (r[i] ?? "").trim()));
    return rec;
  });
}

export function requireColumns(records: Record<string, string>[], cols: string[], file: string): void {
  if (records.length === 0) throw new Error(`${file} にデータ行がありません`);
  const missing = cols.filter((c) => !(c in records[0]));
  if (missing.length) throw new Error(`${file} に必要な列がありません: ${missing.join(", ")}`);
}
