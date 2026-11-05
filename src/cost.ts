import type { TokenUsage } from "./types.js";

/**
 * 料金表（USD / 100万トークン、2026年11月時点の公式価格ページより）。
 * 価格は変わるため、環境変数 PRICE_INPUT_PER_MTOK / PRICE_OUTPUT_PER_MTOK で上書きできる。
 * https://platform.claude.com/docs/en/about-claude/pricing
 */
export const PRICE_TABLE: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  // モックは「Sonnet で動かしたらいくらか」の試算として表示する
  "mock-model": { input: 2, output: 10 },
};

export interface CostSummary {
  inputTokens: number;
  outputTokens: number;
  usd: number;
  jpy: number;
  usdJpy: number;
  priceInput: number;
  priceOutput: number;
  estimated: boolean;
}

export function priceFor(model: string): { input: number; output: number } {
  const envIn = Number(process.env.PRICE_INPUT_PER_MTOK);
  const envOut = Number(process.env.PRICE_OUTPUT_PER_MTOK);
  const base = PRICE_TABLE[model] ?? PRICE_TABLE["claude-sonnet-5-5"];
  return {
    input: envIn > 0 ? envIn : base.input,
    output: envOut > 0 ? envOut : base.output,
  };
}

export function summarizeCost(usages: TokenUsage[], model: string): CostSummary {
  const inputTokens = usages.reduce((s, u) => s + u.inputTokens, 0);
  const outputTokens = usages.reduce((s, u) => s + u.outputTokens, 0);
  const p = priceFor(model);
  const usd = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  const usdJpy = Number(process.env.USD_JPY) > 0 ? Number(process.env.USD_JPY) : 150;
  return {
    inputTokens,
    outputTokens,
    usd,
    jpy: usd * usdJpy,
    usdJpy,
    priceInput: p.input,
    priceOutput: p.output,
    estimated: usages.some((u) => u.estimated),
  };
}
