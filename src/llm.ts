import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompt.js";
import type { TokenUsage } from "./types.js";

export interface LlmResponse {
  text: string;
  usage: TokenUsage;
  /** 生成が最後まで終わらなかった理由（途中で切れた・拒否された等）。正常終了なら undefined */
  incomplete?: string;
}

export interface LlmClient {
  readonly name: string;
  readonly model: string;
  complete(userMessage: string, ctx: { questionId: string }): Promise<LlmResponse>;
}

/** 本番：Anthropic Claude API。モデル名と API キーは環境変数から読む。 */
export class AnthropicClient implements LlmClient {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly maxTokens = 4000,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * 根拠を並べ直すだけの作業なので、深い推論（thinking）は不要。
   * 推論のトークンも max_tokens に含まれるため、放っておくと本文が途中で切れることがある。
   * Sonnet 5.5 は thinking を止められる（between_tools）。止められないモデルは effort を下げて抑える。
   */
  private reasoningParams(): Partial<Anthropic.MessageCreateParamsNonStreaming> {
    return this.model.startsWith("claude-sonnet-5-5")
      ? { thinking: { type: "between_tools" } }
      : { output_config: { effort: "low" } };
  }

  async complete(userMessage: string): Promise<LlmResponse> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      ...this.reasoningParams(),
    });
    const text = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const incomplete =
      res.stop_reason === "end_turn"
        ? undefined
        : res.stop_reason === "max_tokens"
          ? "回答が上限トークン数で途中で切れました"
          : res.stop_reason === "refusal"
            ? "AIが回答を拒否しました"
            : `AIの生成が想定外の理由で終了しました（${res.stop_reason}）`;
    return {
      text,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, estimated: false },
      incomplete,
    };
  }
}

/** 日本語は概ね 1 トークン ≒ 1〜1.5 文字。モック用のざっくりした概算。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.2);
}

/**
 * モック：API キーなしでデモを通すための偽の AI。
 * 送られてきた根拠の回答文を、出典 ID 付きの文に並べ直して返すだけ。
 *
 * injectFor に問番号を指定すると、その問だけわざと「根拠にない数字」を1文混ぜる。
 * 数値チェックの動作をデモで確認するための仕掛け。
 */
export class MockClient implements LlmClient {
  readonly name = "mock";
  readonly model = "mock-model";

  constructor(private readonly injectFor: Set<string> = new Set()) {}

  async complete(userMessage: string, ctx: { questionId: string }): Promise<LlmResponse> {
    const blocks = [...userMessage.matchAll(/\[(A-\d+)\][^\n]*\n想定質問: [^\n]*\n回答: ([^\n]+)/g)];
    const sentences: string[] = [];
    // 一番似ている根拠を主に使い、2 番目以降からは 1 文ずつだけ補う
    blocks.forEach(([, id, answer], i) => {
      const parts = answer.split(/(?<=。)/).filter((s) => s.trim());
      const take = i === 0 ? parts : parts.slice(0, 1);
      for (const p of take) sentences.push(p.replace(/。$/, `。[${id}]`));
    });
    if (this.injectFor.has(ctx.questionId) && blocks.length) {
      sentences.push(`なお、一連の対応は通常12時間以内に完了します。[${blocks[0][1]}]`);
    }
    const text = sentences.join("") || "【要確認】";
    return {
      text,
      usage: {
        inputTokens: estimateTokens(SYSTEM_PROMPT + userMessage),
        outputTokens: estimateTokens(text),
        estimated: true,
      },
    };
  }
}
