import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BuiltinMasker } from "../src/guardrail.js";
import { type LlmClient, MockClient } from "../src/llm.js";
import { loadLibrary } from "../src/loaders.js";
import { answerQuestion, type PipelineDeps } from "../src/pipeline.js";
import { BigramTfIdfRetriever } from "../src/retriever.js";
import { isNumericQuestion } from "../src/rules.js";

const library = loadLibrary("data/answer_library.csv");
const retriever = new BigramTfIdfRetriever(library);

/** 呼び出し回数と送信内容を記録するモック */
function spyLlm(inner: LlmClient = new MockClient()) {
  const sent: string[] = [];
  const llm: LlmClient = {
    name: "spy",
    model: "mock-model",
    complete: (msg, ctx) => {
      sent.push(msg);
      return inner.complete(msg, ctx);
    },
  };
  return { llm, sent };
}

function deps(llm: LlmClient, extra: Partial<PipelineDeps> = {}): PipelineDeps {
  return { retriever, llm, guardrail: new BuiltinMasker(["みどり企業年金基金"]), threshold: 0.3, topK: 3, ...extra };
}

describe("要確認の判定", () => {
  it("ライブラリにない質問は要確認にし、AIを呼ばない", async () => {
    const { llm, sent } = spyLlm();
    const r = await answerQuestion({ questionId: "Q10", question: "暗号資産（仮想通貨）に投資する可能性はありますか。" }, deps(llm));
    assert.equal(r.status, "要確認");
    assert.equal(r.sentToAi, false);
    assert.equal(sent.length, 0, "根拠がないのでAIには一切送らない");
    assert.equal(r.usage.inputTokens, 0);
    assert.match(r.reasons[0], /類似する過去回答なし/);
  });

  it("数字を問う質問は、根拠があっても要確認にする", async () => {
    const { llm } = spyLlm();
    const r = await answerQuestion({ questionId: "Q05", question: "当該戦略の運用残高と顧客数を教えてください。" }, deps(llm));
    assert.equal(r.evidence[0].entry.id, "A-017");
    assert.equal(r.status, "要確認");
    assert.ok(r.reasons.some((x) => x.includes("数値を問う質問")));
  });

  it("根拠があり数字も問わない質問は下書き完了になる", async () => {
    const { llm } = spyLlm();
    const r = await answerQuestion({ questionId: "Q08", question: "議決権行使の方針と、行使結果の開示方法を教えてください。" }, deps(llm));
    assert.equal(r.status, "下書き完了");
    assert.match(r.draft, /\[A-033\]/);
  });

  it("AIが根拠にない数字を書くと、二次チェックで要確認に変わる", async () => {
    const { llm } = spyLlm(new MockClient(new Set(["Q07"])));
    const r = await answerQuestion({ questionId: "Q07", question: "災害時の事業継続体制（BCP）について教えてください。" }, deps(llm));
    assert.equal(r.status, "要確認");
    assert.ok(r.reasons.some((x) => x.includes("根拠にない数値（12）")));
    assert.ok(!r.draft.includes("12時間"));
    assert.ok(r.draft.includes("24時間"), "根拠どおりの数字は残る");
  });

  it("AIの回答が途中で切れたら、要確認にする", async () => {
    const truncated: LlmClient = {
      name: "truncated",
      model: "mock-model",
      complete: async () => ({
        text: "議決権行使ガイドラインを毎年見直し、",
        usage: { inputTokens: 10, outputTokens: 10, estimated: false },
        incomplete: "回答が上限トークン数で途中で切れました",
      }),
    };
    const r = await answerQuestion({ questionId: "Q08", question: "議決権行使の方針と、行使結果の開示方法を教えてください。" }, deps(truncated));
    assert.equal(r.status, "要確認");
    assert.ok(r.reasons.some((x) => x.includes("途中で切れました")));
  });

  it("数字を問う質問かどうかのキーワード判定", () => {
    assert.equal(isNumericQuestion("直近3年の運用実績をご提示ください。"), true);
    assert.equal(isNumericQuestion("標準的な運用報酬率を教えてください。"), true);
    assert.equal(isNumericQuestion("議決権行使の方針を教えてください。"), false);
  });
});

describe("送信内容とセキュリティ", () => {
  it("AIに送るのは検索でヒットした根拠だけで、ライブラリ全体は送らない", async () => {
    const { llm, sent } = spyLlm();
    await answerQuestion({ questionId: "Q08", question: "議決権行使の方針と、行使結果の開示方法を教えてください。" }, deps(llm));
    const ids = [...sent[0].matchAll(/\[(A-\d+)\]/g)].map((m) => m[1]);
    assert.ok(ids.length >= 1 && ids.length <= 3);
    assert.ok(!sent[0].includes("ISO/IEC 27001"), "無関係な回答（A-026）は送られていない");
  });

  it("顧客名はマスクして送り、回答案では元に戻す", async () => {
    const { llm, sent } = spyLlm();
    const r = await answerQuestion(
      { questionId: "Q11", question: "みどり企業年金基金向けに、成功報酬型の報酬体系をご提案いただくことは可能ですか。" },
      deps(llm),
    );
    assert.ok(!sent[0].includes("みどり企業年金基金"));
    assert.ok(sent[0].includes("[機密語_1]"));
    assert.equal(r.status, "下書き完了");
  });

  it("送信前チェックで止められたら、AIには送らない", async () => {
    const { llm, sent } = spyLlm();
    const blocker = { name: "always-block", protect: async () => ({ text: "", blocked: true, findings: ["テスト用の停止"], restore: (s: string) => s }) };
    const r = await answerQuestion({ questionId: "Q08", question: "議決権行使の方針を教えてください。" }, deps(llm, { guardrail: blocker }));
    assert.equal(sent.length, 0);
    assert.equal(r.status, "要確認");
    assert.equal(r.sentToAi, false);
  });
});
