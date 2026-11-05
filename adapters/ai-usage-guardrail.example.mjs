// ai-usage-guardrail（別リポジトリ）とつなぐためのアダプターのサンプルです。
//
// 使い方:
//   1. このファイルを adapters/ai-usage-guardrail.mjs にコピーする
//   2. 下の import を ai-usage-guardrail の実際の公開関数に合わせて書き換える
//   3. .env に AI_USAGE_GUARDRAIL_MODULE=adapters/ai-usage-guardrail.mjs を追加する
//
// rfp-answer-assistant が求める約束は次の2つだけです。
//   guard(text)   -> { text: 送信するテキスト, blocked?: boolean, findings?: string[] }
//   restore(text) -> マスク記号を元に戻したテキスト（任意。なければそのまま返す）

// import { check } from "../../ai-usage-guardrail/dist/index.js";

export async function guard(text) {
  // 例: const r = await check(text);
  //     return { text: r.sanitizedText, blocked: !r.allowed, findings: r.violations.map((v) => v.rule) };
  return { text, blocked: false, findings: ["(サンプル) 何もチェックしていません"] };
}

export function restore(text) {
  return text;
}
