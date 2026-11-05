import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/**
 * AI に送る直前のテキストを必ず通す「関所」。
 *
 * - 環境変数 AI_USAGE_GUARDRAIL_MODULE に ai-usage-guardrail（別リポジトリ）の
 *   アダプターのパスがあれば、そちらを使う。
 * - なければ、このリポジトリ内の簡易マスキング（BuiltinMasker）を使う。
 *
 * どちらの場合も pipeline 側からは Guardrail インターフェースしか見えないので、
 * 差し替えても他のコードは変わらない。
 */
export interface GuardResult {
  /** 実際に AI へ送るテキスト */
  text: string;
  /** true のとき送信を中止する（例：API キーやパスワードらしき文字列を検出） */
  blocked: boolean;
  /** 何を検出・マスクしたか（ログ用。元の値は含めない） */
  findings: string[];
  /** AI の返答に含まれるマスク記号を元の語に戻す */
  restore: (s: string) => string;
}

export interface Guardrail {
  readonly name: string;
  protect(text: string): Promise<GuardResult>;
}

/** 外部ガードレールのアダプターが export すべき関数の形 */
export interface ExternalGuardModule {
  guard(text: string): Promise<{ text: string; blocked?: boolean; findings?: string[] }> | {
    text: string;
    blocked?: boolean;
    findings?: string[];
  };
  restore?(text: string): string;
}

interface Pattern {
  label: string;
  re: RegExp;
}

const MASK_PATTERNS: Pattern[] = [
  { label: "メールアドレス", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { label: "電話番号", re: /(?<!\d)0\d{1,4}-\d{1,4}-\d{3,4}(?!\d)/g },
  { label: "口座番号", re: /口座番号[:：]?\s*\d{6,8}/g },
];

const BLOCK_PATTERNS: Pattern[] = [
  { label: "APIキーらしき文字列", re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { label: "パスワードらしき記述", re: /(パスワード|password)\s*[:：=]\s*\S+/i },
];

/** 簡易マスキング：正規表現＋固有名詞リスト。対応表は手元にだけ残し、AI には記号だけを送る。 */
export class BuiltinMasker implements Guardrail {
  readonly name = "builtin-masker";

  constructor(private readonly sensitiveTerms: string[] = []) {}

  async protect(input: string): Promise<GuardResult> {
    const findings: string[] = [];
    for (const p of BLOCK_PATTERNS) {
      if (p.re.test(input)) findings.push(`送信停止: ${p.label}`);
    }
    if (findings.length) return { text: "", blocked: true, findings, restore: (s) => s };

    const table = new Map<string, string>(); // 記号 -> 元の語
    const reverse = new Map<string, string>(); // 元の語 -> 記号（同じ語は同じ記号に）
    const counters = new Map<string, number>();
    const tokenFor = (label: string, original: string) => {
      const existing = reverse.get(original);
      if (existing) return existing;
      const n = (counters.get(label) ?? 0) + 1;
      counters.set(label, n);
      const token = `[${label}_${n}]`;
      table.set(token, original);
      reverse.set(original, token);
      return token;
    };

    let text = input;
    // 長い語から順に置換（「山本 健一」が「山本」より先に当たるように）
    const terms = [...this.sensitiveTerms].sort((a, b) => b.length - a.length);
    for (const term of terms) {
      if (text.includes(term)) {
        text = text.split(term).join(tokenFor("機密語", term));
        findings.push("機密語");
      }
    }
    for (const p of MASK_PATTERNS) {
      text = text.replace(p.re, (m) => {
        findings.push(p.label);
        return tokenFor(p.label, m);
      });
    }

    const restore = (s: string) => {
      let out = s;
      for (const [token, original] of table) out = out.split(token).join(original);
      return out;
    };
    return { text, blocked: false, findings: [...new Set(findings)], restore };
  }
}

/** 外部の ai-usage-guardrail をアダプター経由で呼ぶ */
export class ExternalGuardrail implements Guardrail {
  constructor(
    readonly name: string,
    private readonly mod: ExternalGuardModule,
  ) {}

  async protect(input: string): Promise<GuardResult> {
    const r = await this.mod.guard(input);
    return {
      text: r.text,
      blocked: Boolean(r.blocked),
      findings: r.findings ?? [],
      restore: this.mod.restore ? this.mod.restore.bind(this.mod) : (s) => s,
    };
  }
}

export async function loadGuardrail(sensitiveTerms: string[]): Promise<Guardrail> {
  const modPath = process.env.AI_USAGE_GUARDRAIL_MODULE;
  if (!modPath) return new BuiltinMasker(sensitiveTerms);
  const mod = (await import(pathToFileURL(resolve(modPath)).href)) as Partial<ExternalGuardModule>;
  if (typeof mod.guard !== "function") {
    throw new Error(`${modPath} に guard(text) 関数が export されていません`);
  }
  return new ExternalGuardrail(`ai-usage-guardrail (${modPath})`, mod as ExternalGuardModule);
}
