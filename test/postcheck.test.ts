import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkDraft, extractNumbers, splitSentences } from "../src/postcheck.js";
import type { Evidence } from "../src/types.js";

const ev = (id: string, answer: string): Evidence => ({
  entry: { id, category: "テスト", question: "テスト", answer, lastUpdated: "2026-01-01" },
  score: 0.9,
});

const EVIDENCE = [
  ev("A-017", "2026年9月末時点の運用残高は3,150億円、顧客数は27です。"),
  ev("A-028", "重要業務は災害発生から24時間以内に再開することを目標としています。"),
];

describe("数値の取り出し", () => {
  it("桁区切りのカンマと全角数字を正規化する", () => {
    assert.deepEqual(extractNumbers("残高は３，１５０億円、利回りは１８．２％"), ["3150", "18.2"]);
  });
  it("出典IDとマスク記号の中の数字は数えない", () => {
    assert.deepEqual(extractNumbers("[機密語_1]向けに提案します。[A-036]"), []);
  });
});

describe("文の分割", () => {
  it("出典IDが句点の前でも後でも1文として扱う", () => {
    assert.deepEqual(splitSentences("文Aです。[A-001]文Bです[A-002]。"), ["文Aです。[A-001]", "文Bです[A-002]。"]);
  });
});

describe("数値チェック", () => {
  it("根拠にある数字だけなら合格（カンマの有無は問わない）", () => {
    const r = checkDraft("運用残高は3150億円、顧客数は27です。[A-017]", EVIDENCE);
    assert.deepEqual(r.reasons, []);
    assert.equal(r.text, "運用残高は3150億円、顧客数は27です。[A-017]");
  });

  it("根拠にない数字を含む文は削除して要確認にする", () => {
    const r = checkDraft(
      "重要業務は24時間以内に再開します。[A-028]切替は12時間で完了します。[A-028]",
      EVIDENCE,
    );
    assert.equal(r.reasons.length, 1);
    assert.match(r.reasons[0], /根拠にない数値（12）/);
    assert.ok(r.text.startsWith("重要業務は24時間以内に再開します。[A-028]"), "正しい文は残る");
    assert.ok(!r.text.includes("切替は12時間"), "誤った文は消える");
    assert.match(r.text, /【要確認：根拠にない数値「12」/);
  });

  it("数字は「その文が引用した根拠」の中で照合する（別の根拠の数字は使えない）", () => {
    // 27 は A-017 にはあるが、この文が引用しているのは A-028
    const r = checkDraft("顧客数は27です。[A-028]", EVIDENCE);
    assert.match(r.reasons.join(), /根拠にない数値（27）/);
  });
});

describe("出典チェック", () => {
  it("出典IDのない文は削除して要確認にする", () => {
    const r = checkDraft("当社は業界トップクラスです。", EVIDENCE);
    assert.deepEqual(r.reasons, ["出典IDのない文を削除"]);
    assert.ok(!r.text.includes("トップクラス"));
  });

  it("渡していない出典IDを書いた文は削除する", () => {
    const r = checkDraft("ISO認証を取得しています。[A-026]", EVIDENCE);
    assert.match(r.reasons[0], /渡していない出典ID（A-026）/);
  });

  it("AIが自分で【要確認】と書いた箇所は残し、要確認として扱う", () => {
    const r = checkDraft("残高は3,150億円です。[A-017]手数料は【要確認】です。", EVIDENCE);
    assert.deepEqual(r.reasons, ["AIが根拠不足と判断した箇所あり"]);
    assert.match(r.text, /【要確認】/);
  });

  it("【要確認】を付けても、根拠にない数字の検査は免除しない", () => {
    const r = checkDraft("運用残高は9,999億円です【要確認】。[A-017]", EVIDENCE);
    assert.match(r.reasons.join(), /根拠にない数値（9999）/);
    assert.ok(!r.text.includes("9,999"), "根拠にない数字は回答案に残らない");
  });

  it("【要確認】だけで出典のない文でも、数字があれば削除する", () => {
    const r = checkDraft("残高は5,000億円【要確認】です。", EVIDENCE);
    assert.match(r.reasons.join(), /根拠にない数値（5000）/);
    assert.ok(!r.text.includes("5,000"));
  });
});
