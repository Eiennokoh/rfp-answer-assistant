import type { Evidence } from "./types.js";

/**
 * AI への指示。「根拠にないことは書かない」をプロンプトで縛ったうえで、
 * 返ってきた文章をプログラム側（postcheck.ts）でもう一度検査する二重構えにしている。
 */
export const SYSTEM_PROMPT = `あなたは資産運用会社の営業担当を補佐するアシスタントです。
機関投資家から届いた審査質問票（RFP/DDQ）への回答案を作ります。

必ず守るルール:
1. 下の「根拠」に書かれている内容だけを使って回答する。一般知識や推測で補わない。
2. 文ごとに、使った根拠のIDを文末に [A-001] の形で付ける。複数なら [A-001][A-005]。
3. 数字（年、金額、率、人数など）は根拠にあるものをそのまま使い、計算・換算・丸めをしない。
4. 根拠だけでは答えきれない部分は、推測せずに「【要確認】」とだけ書く。
5. [機密語_1] のような角かっこの記号はそのまま残す。
6. 回答本文だけを、です・ます調の日本語で出力する。前置きや説明は書かない。`;

export function buildUserMessage(question: string, evidence: Evidence[]): string {
  const ev = evidence
    .map((e) => `[${e.entry.id}]（${e.entry.category}／${e.entry.lastUpdated}更新）\n想定質問: ${e.entry.question}\n回答: ${e.entry.answer}`)
    .join("\n\n");
  return `# 根拠\n${ev}\n\n# 今回の質問\n${question}`;
}
