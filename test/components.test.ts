import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { summarizeCost } from "../src/cost.js";
import { parseCsv, readCsvRecords } from "../src/csv.js";
import { BuiltinMasker } from "../src/guardrail.js";
import { loadLibrary } from "../src/loaders.js";
import { BigramTfIdfRetriever } from "../src/retriever.js";

describe("CSV", () => {
  it("クォート内のカンマと改行を扱える", () => {
    assert.deepEqual(parseCsv('a,b\n1,"3,150億円\n改行"\n'), [
      ["a", "b"],
      ["1", "3,150億円\n改行"],
    ]);
  });
  it("クォートし忘れで列がずれたらエラーにする", () => {
    const dir = mkdtempSync(join(tmpdir(), "rfp-"));
    const p = join(dir, "bad.csv");
    writeFileSync(p, "id,answer\nA-1,残高は3,150億円\n");
    assert.throws(() => readCsvRecords(p), /列数が多すぎます/);
  });
});

describe("検索", () => {
  const r = new BigramTfIdfRetriever(loadLibrary("data/answer_library.csv"));
  it("言い回しが違っても該当する過去回答が1位に来る", () => {
    assert.equal(r.search("運用責任者が退職した場合、運用はどのように引き継がれますか。", 3)[0].entry.id, "A-007");
    assert.equal(r.search("災害時の事業継続体制（BCP）について教えてください。", 3)[0].entry.id, "A-028");
  });
  it("ライブラリにない話題は閾値 0.30 を下回る", () => {
    for (const q of ["暗号資産（仮想通貨）に投資する可能性はありますか。", "生成AIを業務で利用していますか。"]) {
      assert.ok(r.search(q, 1)[0].score < 0.3, q);
    }
  });
});

describe("簡易マスキング", () => {
  const m = new BuiltinMasker(["みどり企業年金基金"]);
  it("メール・電話番号・固有名詞をマスクし、元に戻せる", async () => {
    const src = "みどり企業年金基金の田中様（tanaka@midori.example.jp、03-1234-5678）";
    const g = await m.protect(src);
    assert.ok(!g.text.includes("tanaka@"));
    assert.ok(!g.text.includes("03-1234-5678"));
    assert.ok(!g.text.includes("みどり"));
    assert.equal(g.restore(g.text), src);
  });
  it("日付（2026-04-01）は電話番号として誤検出しない", async () => {
    const g = await m.protect("2026-04-01更新");
    assert.equal(g.text, "2026-04-01更新");
  });
  it("APIキーらしき文字列があれば送信を止める", async () => {
    const g = await m.protect("設定は sk-ant-abcdefghijklmnopqrstu です");
    assert.equal(g.blocked, true);
  });
});

describe("費用の計算", () => {
  it("トークン数と単価から費用を出す", () => {
    process.env.PRICE_INPUT_PER_MTOK = "2";
    process.env.PRICE_OUTPUT_PER_MTOK = "10";
    process.env.USD_JPY = "150";
    const c = summarizeCost(
      [
        { inputTokens: 1_000_000, outputTokens: 100_000, estimated: false },
        { inputTokens: 0, outputTokens: 0, estimated: false },
      ],
      "claude-sonnet-5-5",
    );
    assert.equal(c.usd, 3);
    assert.equal(c.jpy, 450);
    delete process.env.PRICE_INPUT_PER_MTOK;
    delete process.env.PRICE_OUTPUT_PER_MTOK;
    delete process.env.USD_JPY;
  });
});
