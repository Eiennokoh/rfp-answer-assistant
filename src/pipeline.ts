import type { Guardrail } from "./guardrail.js";
import type { LlmClient } from "./llm.js";
import { checkDraft } from "./postcheck.js";
import { buildUserMessage } from "./prompt.js";
import type { Retriever } from "./retriever.js";
import { isNumericQuestion } from "./rules.js";
import type { AnswerResult, RfpQuestion } from "./types.js";

export interface PipelineDeps {
  retriever: Retriever;
  llm: LlmClient;
  guardrail: Guardrail;
  /** これ未満の類似度の過去回答は根拠として使わない */
  threshold: number;
  /** AI に渡す根拠の最大件数（1〜3） */
  topK: number;
  /** 実際に AI へ送ったテキストを記録するコールバック（監査ログ用） */
  onSend?: (record: { questionId: string; sentText: string; findings: string[] }) => void;
}

const NO_COST = { inputTokens: 0, outputTokens: 0, estimated: false };

export async function answerQuestion(q: RfpQuestion, deps: PipelineDeps): Promise<AnswerResult> {
  const candidates = deps.retriever.search(q.question, deps.topK);
  const evidence = candidates.filter((c) => c.score >= deps.threshold);
  const base = { questionId: q.questionId, question: q.question, evidence };

  // ① 似た過去回答がない → AI を呼ばない（呼んでも根拠がないので作文になるだけ）
  if (evidence.length === 0) {
    const best = candidates[0];
    const hint = best ? `最高類似度 ${best.score.toFixed(2)}（${best.entry.id}）` : "候補なし";
    return {
      ...base,
      draft: "【要確認】過去の回答ライブラリに該当する記載がありません。担当部署に確認のうえ、回答を作成してください。",
      status: "要確認",
      reasons: [`類似する過去回答なし：${hint} < 閾値 ${deps.threshold}`],
      sentToAi: false,
      usage: NO_COST,
    };
  }

  const reasons: string[] = [];
  // ② 数字を問う質問は、根拠があっても人の確認を必須にする
  if (isNumericQuestion(q.question)) reasons.push("数値を問う質問のため、最新の数値で要確認");

  // ③ 送信前に必ずガードレールを通す。送るのは「この問の根拠 1〜3 件」だけで、ライブラリ全体は送らない
  const guarded = await deps.guardrail.protect(buildUserMessage(q.question, evidence));
  if (guarded.blocked) {
    return {
      ...base,
      draft: "【要確認】送信前チェックで機密情報らしき文字列が見つかったため、AIには送信していません。",
      status: "要確認",
      reasons: [...reasons, ...guarded.findings],
      sentToAi: false,
      usage: NO_COST,
    };
  }
  deps.onSend?.({ questionId: q.questionId, sentText: guarded.text, findings: guarded.findings });

  // ④ AI で回答案を作成
  const res = await deps.llm.complete(guarded.text, { questionId: q.questionId });

  // ⑤ プログラムで二次チェック（マスクを戻す前に実施）→ マスク記号を元の語に戻す
  const checked = checkDraft(res.text, evidence);
  if (res.incomplete) reasons.push(res.incomplete); // 途中で切れた・拒否された回答は、そのまま使わせない
  reasons.push(...checked.reasons);

  return {
    ...base,
    draft: guarded.restore(checked.text),
    status: reasons.length ? "要確認" : "下書き完了",
    reasons,
    sentToAi: true,
    usage: res.usage,
  };
}

export async function answerAll(questions: RfpQuestion[], deps: PipelineDeps): Promise<AnswerResult[]> {
  const results: AnswerResult[] = [];
  // API のレート制限と、ログの読みやすさを優先して 1 問ずつ順番に処理する
  for (const q of questions) results.push(await answerQuestion(q, deps));
  return results;
}
