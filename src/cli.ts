#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { summarizeCost } from "./cost.js";
import { writeExcel } from "./excel.js";
import { loadGuardrail } from "./guardrail.js";
import { AnthropicClient, type LlmClient, MockClient } from "./llm.js";
import { loadLibrary, loadQuestions, loadSensitiveTerms } from "./loaders.js";
import { answerAll } from "./pipeline.js";
import { BigramTfIdfRetriever } from "./retriever.js";

// .env があれば読み込む（Node 20.12 以降の標準機能。外部ライブラリ不要）
if (existsSync(".env")) process.loadEnvFile(".env");

const { values: opt } = parseArgs({
  options: {
    questions: { type: "string", default: "data/new_rfp.csv" },
    library: { type: "string", default: "data/answer_library.csv" },
    terms: { type: "string", default: "data/sensitive_terms.txt" },
    out: { type: "string", default: "output/rfp_answers.xlsx" },
    threshold: { type: "string", default: process.env.SIMILARITY_THRESHOLD ?? "0.30" },
    "top-k": { type: "string", default: "3" },
    mock: { type: "boolean", default: false },
    "inject-hallucination": { type: "string", default: "" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (opt.help) {
  console.log(`使い方: npm start -- [オプション]
  --questions <csv>    新しい質問票（列: question_id, question）
  --library <csv>      過去回答ライブラリ（列: id, category, question, answer, last_updated）
  --terms <txt>        AIに送る前にマスクする固有名詞のリスト
  --out <xlsx>         出力先 Excel
  --threshold <0-1>    類似度の閾値（既定 0.30）
  --top-k <1-3>        AIに渡す根拠の最大件数（既定 3）
  --mock               API キーがあってもモックで動かす
  --inject-hallucination <問番号,...>  モック時、指定の問にわざと根拠にない数字を混ぜる（デモ用）`);
  process.exit(0);
}

const C = {
  ok: (s: string) => `\x1b[32m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

async function main() {
  const threshold = Number(opt.threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(`--threshold は 0〜1 の数値で指定してください（指定値: ${opt.threshold}）`);
  }
  const topKRaw = Number(opt["top-k"]);
  if (!Number.isInteger(topKRaw) || topKRaw < 1) {
    throw new Error(`--top-k は 1 以上の整数で指定してください（指定値: ${opt["top-k"]}）`);
  }
  const topK = Math.min(3, topKRaw);
  const library = loadLibrary(opt.library!);
  const questions = loadQuestions(opt.questions!);
  const guardrail = await loadGuardrail(loadSensitiveTerms(opt.terms));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const useMock = opt.mock || !apiKey;
  const llm: LlmClient = useMock
    ? new MockClient(new Set(opt["inject-hallucination"]!.split(",").map((s) => s.trim()).filter(Boolean)))
    : new AnthropicClient(apiKey!, process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5");

  console.log(C.bold("\nRFP回答アシスタント"));
  console.log(
    C.dim(
      `質問票 ${questions.length}問 / 回答ライブラリ ${library.length}件 / 生成: ${useMock ? "モック（APIキー不要）" : llm.model} / 送信前チェック: ${guardrail.name} / 閾値 ${threshold}\n`,
    ),
  );

  const sendLog: string[] = [];
  const results = await answerAll(questions, {
    retriever: new BigramTfIdfRetriever(library),
    llm,
    guardrail,
    threshold,
    topK,
    onSend: (r) => sendLog.push(JSON.stringify({ ...r, at: new Date().toISOString() })),
  });

  for (const r of results) {
    const ev = r.evidence.length
      ? r.evidence.map((e) => `${e.entry.id}（類似度 ${e.score.toFixed(2)}）`).join(" ")
      : "-";
    const mark = r.status === "下書き完了" ? C.ok("✔ 下書き完了") : C.warn("⚠ 要確認  ");
    console.log(`${r.questionId}  ${mark}  根拠: ${ev}`);
    for (const reason of r.reasons) console.log(C.dim(`      └ ${reason}`));
    // 二次チェックで文を削除した問は、修正後の回答案もその場で見せる（Excel を開かなくても分かるように）
    if (r.draft.includes("【要確認：")) console.log(`      └ 修正後の回答案: ${r.draft}`);
  }

  const cost = summarizeCost(
    results.map((r) => r.usage),
    llm.model,
  );
  const outDir = dirname(opt.out!);
  mkdirSync(outDir, { recursive: true });
  await writeExcel(opt.out!, results, cost, {
    llmName: llm.name,
    model: llm.model,
    guardrailName: guardrail.name,
    threshold,
    questionsFile: opt.questions!,
    libraryFile: opt.library!,
    libraryCount: library.length,
  });
  const logPath = `${outDir}/sent_log.jsonl`;
  writeFileSync(logPath, sendLog.join("\n") + "\n");

  const review = results.filter((r) => r.status === "要確認").length;
  const sent = results.filter((r) => r.sentToAi).length;
  console.log(
    `\n${C.bold("結果")}  下書き完了 ${results.length - review} / 要確認 ${review}（AIに送信 ${sent}問、ライブラリ全体は送信していません）`,
  );
  console.log(
    `${C.bold("トークン")}  入力 ${cost.inputTokens.toLocaleString()} / 出力 ${cost.outputTokens.toLocaleString()}${cost.estimated ? "（概算）" : ""}` +
      `  ${C.bold("推定費用")}  $${cost.usd.toFixed(4)}（約${cost.jpy.toFixed(1)}円）`,
  );
  console.log(`${C.bold("出力")}  ${opt.out}\n${C.dim(`送信内容の記録: ${logPath}`)}\n`);
}

main().catch((e) => {
  console.error(`エラー: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
