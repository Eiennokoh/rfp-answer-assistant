import ExcelJS from "exceljs";
import type { CostSummary } from "./cost.js";
import type { AnswerResult } from "./types.js";

export interface RunInfo {
  llmName: string;
  model: string;
  guardrailName: string;
  threshold: number;
  questionsFile: string;
  libraryFile: string;
  libraryCount: number;
}

export function formatEvidence(r: AnswerResult): string {
  if (r.evidence.length === 0) return "（該当なし）";
  return r.evidence
    .map((e) => `${e.entry.id}（類似度 ${e.score.toFixed(2)}）${e.entry.category}：${e.entry.question}`)
    .join("\n");
}

export function formatStatus(r: AnswerResult): string {
  return r.status === "要確認" ? `要確認\n${r.reasons.map((x) => `・${x}`).join("\n")}` : "下書き完了";
}

export async function writeExcel(path: string, results: AnswerResult[], cost: CostSummary, info: RunInfo): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "rfp-answer-assistant";

  const ws = wb.addWorksheet("回答案", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "設問番号", key: "id", width: 10 },
    { header: "質問", key: "q", width: 40 },
    { header: "回答案", key: "draft", width: 70 },
    { header: "根拠", key: "ev", width: 45 },
    { header: "ステータス", key: "status", width: 34 },
  ];
  for (const r of results) {
    const row = ws.addRow({ id: r.questionId, q: r.question, draft: r.draft, ev: formatEvidence(r), status: formatStatus(r) });
    row.alignment = { wrapText: true, vertical: "top" };
    const statusCell = row.getCell("status");
    statusCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: r.status === "要確認" ? "FFFFE699" : "FFC6EFCE" },
    };
  }
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  ws.autoFilter = { from: "A1", to: "E1" };

  const s = wb.addWorksheet("サマリー");
  s.columns = [
    { header: "項目", key: "k", width: 30 },
    { header: "値", key: "v", width: 60 },
  ];
  const review = results.filter((r) => r.status === "要確認").length;
  const rows: [string, string | number][] = [
    ["設問数", results.length],
    ["下書き完了", results.length - review],
    ["要確認", review],
    ["AIに送った設問数",results.filter((r) => r.sentToAi).length],
    ["入力トークン合計", cost.inputTokens],
    ["出力トークン合計", cost.outputTokens],
    ["推定費用（USD）", Number(cost.usd.toFixed(4))],
    ["推定費用（円）", Number(cost.jpy.toFixed(2))],
    ["単価（USD/100万トークン）", `入力 ${cost.priceInput} / 出力 ${cost.priceOutput}`],
    ["為替レート（円/USD）", cost.usdJpy],
    ["トークン数の種類", cost.estimated ? "概算（モックモード：文字数から推定）" : "APIの実測値"],
    ["生成モード", `${info.llmName}（${info.model}）`],
    ["送信前チェック", info.guardrailName],
    ["類似度の閾値", info.threshold],
    ["質問票ファイル", info.questionsFile],
    ["回答ライブラリ", `${info.libraryFile}（${info.libraryCount}件）`],
    ["作成日時", new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })],
  ];
  rows.forEach(([k, v]) => s.addRow({ k, v }));
  s.getRow(1).font = { bold: true };

  await wb.xlsx.writeFile(path);
}
