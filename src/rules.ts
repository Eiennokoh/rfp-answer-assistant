/**
 * 「具体的な数字を問う質問」かどうかの判定。
 * 運用実績・残高・人数・報酬率などは、ライブラリの値が古い可能性があり、
 * 誤った数字を出すと契約上の問題にもなるため、根拠があっても必ず人が確認する。
 */
export const NUMERIC_KEYWORDS = [
  "実績",
  "リターン",
  "利回り",
  "残高",
  "運用資産",
  "金額",
  "人数",
  "何名",
  "何人",
  "件数",
  "顧客数",
  "報酬率",
  "料率",
  "比率",
  "シェア",
  "数値",
  "%",
  "％",
];

export function isNumericQuestion(question: string): boolean {
  const q = question.normalize("NFKC");
  return NUMERIC_KEYWORDS.some((k) => q.includes(k.normalize("NFKC")));
}
