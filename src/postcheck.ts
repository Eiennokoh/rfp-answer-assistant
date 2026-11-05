import type { Evidence } from "./types.js";

/**
 * AI が書いた回答案をプログラムで検査する（プロンプトの指示だけに頼らない）。
 *
 * 1. 出典チェック：すべての文に、今回渡した根拠の ID が付いているか
 * 2. 数値チェック：文中の数字が、その文が引用している根拠の中に実在するか
 *
 * 不合格の文は削除して「【要確認：理由】」に置き換え、問全体を要確認にする。
 */
export interface CheckResult {
  text: string;
  reasons: string[];
}

const CITATION = /\[(A-\d+)\]/g;
const MASK_TOKEN = /\[[^\]\s]+_\d+\]/g; // [機密語_1] などマスク記号（中の数字は数値扱いしない）

/** 「文。[A-001]」「文[A-001]。」のどちらの付け方でも1文として切り出す */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^。]*?。(?:\s*\[A-\d+\])*|[^。]+$/g;
  for (const m of text.match(re) ?? []) if (m.trim()) out.push(m.trim());
  return out;
}

/** 数字を取り出す。全角→半角、桁区切りのカンマを除去してから比べる */
export function extractNumbers(text: string): string[] {
  const t = text
    .normalize("NFKC")
    .replace(CITATION, "")
    .replace(MASK_TOKEN, "")
    .replace(/(\d),(?=\d{3})/g, "$1");
  return t.match(/\d+(?:\.\d+)?/g) ?? [];
}

export function checkDraft(draft: string, evidence: Evidence[]): CheckResult {
  const byId = new Map(evidence.map((e) => [e.entry.id, e.entry]));
  const reasons = new Set<string>();
  const kept: string[] = [];

  for (const sentence of splitSentences(draft)) {
    const ids = [...sentence.matchAll(CITATION)].map((m) => m[1]);
    const body = sentence.replace(CITATION, "").trim();

    // AI が「【要確認】」と書いた文は、出典IDがなくても残してよい（根拠がないと自分で申告しているため）。
    // ただし数値チェックと出典IDの検査は免除しない。【要確認】を付ければ検査をすり抜けられる、を防ぐ。
    const flagged = body.includes("【要確認】");
    if (flagged) reasons.add("AIが根拠不足と判断した箇所あり");
    if (ids.length === 0 && !flagged) {
      reasons.add("出典IDのない文を削除");
      kept.push("【要確認：出典のない文を削除しました】");
      continue;
    }
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) {
      reasons.add(`渡していない出典ID（${unknown.join(", ")}）を引用`);
      kept.push("【要確認：存在しない出典を引用した文を削除しました】");
      continue;
    }

    const allowed = new Set(ids.flatMap((id) => extractNumbers(byId.get(id)!.answer)));
    const missing = extractNumbers(body).filter((n) => !allowed.has(n));
    if (missing.length) {
      reasons.add(`根拠にない数値（${[...new Set(missing)].join(", ")}）を検出`);
      kept.push(`【要確認：根拠にない数値「${[...new Set(missing)].join("、")}」を含む文を削除しました】`);
      continue;
    }
    kept.push(sentence);
  }

  return { text: kept.join(""), reasons: [...reasons] };
}
