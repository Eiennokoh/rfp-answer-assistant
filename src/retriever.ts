import type { Evidence, LibraryEntry } from "./types.js";

/**
 * 文字バイグラム × TF-IDF × コサイン類似度による簡易検索。
 *
 * 日本語は単語の区切りがないため、形態素解析の辞書を入れずに済む
 * 「2文字ずつ区切る」方式を採用した。ひらがなだけのバイグラム（「して」「ます」等）は
 * 意味が薄く類似度を押し上げてしまうので除外する。
 * 将来ベクトル検索（埋め込み）に差し替えられるよう、Retriever インターフェースを切ってある。
 */
export interface Retriever {
  search(query: string, topK: number): Evidence[];
}

const HIRAGANA_ONLY = /^[぀-ゟ]+$/;
const DROP = /[\s、。，．,.！？!?（）()「」『』【】［］\[\]・:：;；"'～〜\-ー]/g;

export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/**
 * どの文書にも出てくる言い回し・自社名・戦略名は、検索の手がかりにならず
 * 無関係な文書の類似度を押し上げるだけなので、バイグラム化の前に取り除く。
 */
export const STOP_PHRASES = [
  "日本株式バリュー戦略",
  "当該戦略",
  "当社",
  "貴社",
  "教えてください",
  "説明してください",
  "ご提示ください",
];

export function bigrams(text: string): string[] {
  let t = normalize(text);
  for (const p of STOP_PHRASES) t = t.split(normalize(p)).join(" ");
  t = t.replace(DROP, " ");
  const out: string[] = [];
  // 句読点・除去語をまたいだバイグラムは作らない
  for (const chunk of t.split(/\s+/)) {
    for (let i = 0; i < chunk.length - 1; i++) {
      const g = chunk.slice(i, i + 2);
      if (!HIRAGANA_ONLY.test(g)) out.push(g);
    }
  }
  return out;
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

export class BigramTfIdfRetriever implements Retriever {
  private idf = new Map<string, number>();
  private vectors: { entry: LibraryEntry; vec: Map<string, number>; norm: number }[] = [];

  constructor(private readonly entries: LibraryEntry[]) {
    // 質問文は回答文より短いが検索の手がかりとして重要なので 2 回数える
    const docs = entries.map((e) => bigrams(`${e.category} ${e.question} ${e.question} ${e.answer}`));
    const df = new Map<string, number>();
    for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
    const n = docs.length;
    for (const [t, c] of df) this.idf.set(t, Math.log((n + 1) / (c + 1)) + 1);

    this.vectors = docs.map((d, i) => {
      const vec = this.weigh(termFreq(d));
      return { entry: entries[i], vec, norm: vecNorm(vec) };
    });
  }

  private weigh(tf: Map<string, number>): Map<string, number> {
    const v = new Map<string, number>();
    for (const [t, c] of tf) {
      const idf = this.idf.get(t);
      if (idf !== undefined) v.set(t, (1 + Math.log(c)) * idf); // 語彙外の語は無視
    }
    return v;
  }

  search(query: string, topK: number): Evidence[] {
    const q = this.weigh(termFreq(bigrams(query)));
    const qn = vecNorm(q);
    if (qn === 0) return [];
    return this.vectors
      .map(({ entry, vec, norm }) => {
        let dot = 0;
        for (const [t, w] of q) dot += w * (vec.get(t) ?? 0);
        return { entry, score: norm === 0 ? 0 : dot / (qn * norm) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

function vecNorm(v: Map<string, number>): number {
  let s = 0;
  for (const w of v.values()) s += w * w;
  return Math.sqrt(s);
}
