/** 過去回答ライブラリの1件 */
export interface LibraryEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  lastUpdated: string;
}

/** 新しく届いた質問票の1問 */
export interface RfpQuestion {
  questionId: string;
  question: string;
}

/** 検索でヒットした根拠 */
export interface Evidence {
  entry: LibraryEntry;
  score: number;
}

export type Status = "下書き完了" | "要確認";

/** 1問ごとの処理結果（Excel の1行に対応） */
export interface AnswerResult {
  questionId: string;
  question: string;
  draft: string;
  evidence: Evidence[];
  status: Status;
  reasons: string[];
  /** AI に送ったかどうか（送らなかった問はコスト 0） */
  sentToAi: boolean;
  usage: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** モック時など、実測ではなく概算のとき true */
  estimated: boolean;
}
