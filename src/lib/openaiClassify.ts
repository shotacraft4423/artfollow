import crypto from "node:crypto";
import OpenAI from "openai";
import { config } from "./config";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

export type ClassifyCandidate = {
  id: string;
  username: string;
  name: string;
  description: string;
  textSamples: string[];
  altTextSamples: string[];
  mediaCount: number;
  checkedCount: number;
};

export type ClassifyResult = {
  id: string;
  is_artist: boolean;
  confidence: number;
  reason: string;
};

// bio + 直近ポストの内容が変わらない限り再分類しないためのハッシュ。
export function computeContentHash(candidate: Pick<ClassifyCandidate, "description" | "textSamples">): string {
  const raw = candidate.description + "||" + candidate.textSamples.join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

const SYSTEM_PROMPT = `あなたはX(Twitter)のアカウントを分析し、「自分でイラスト・漫画・絵などのビジュアルアート作品を創作して投稿している人物(絵描きアカウント)」かどうかを判定するアシスタントです。

判定基準:
- プロフィール文(bio)に絵師・イラストレーター・お絵描き・pixiv・コミッション等の創作活動を示す記述があるか
- 直近の投稿本文のサンプルに創作活動を示す内容があるか
- 直近の投稿のうち画像/動画付き投稿の割合(media_count / checked_count)が高いか。ただし写真(コスプレ・風景・生活写真など)だけを投稿しているアカウントは絵描きではない可能性が高いので、alt_textサンプルやテキストサンプルの内容も踏まえて判断すること
- 他人の作品を紹介・引用しているだけ、いわゆる「絵を見るのが好きな人」は絵描きアカウントに含めない。あくまで自作イラストを投稿している本人を対象とする

各アカウントについて is_artist (真偽)、confidence (0.0〜1.0の確信度)、reason (日本語で1文の簡潔な根拠) を返してください。情報が不十分な場合は confidence を低めにしてください。`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          is_artist: { type: "boolean" },
          confidence: { type: "number" },
          reason: { type: "string" }
        },
        required: ["id", "is_artist", "confidence", "reason"],
        additionalProperties: false
      }
    }
  },
  required: ["results"],
  additionalProperties: false
} as const;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 複数アカウントを1回のAPIコールにまとめて分類する(バッチ化によりリクエスト数を削減)。
export async function classifyBatch(candidates: ClassifyCandidate[]): Promise<Map<string, ClassifyResult>> {
  const results = new Map<string, ClassifyResult>();
  if (candidates.length === 0) return results;

  const batches = chunk(candidates, config.openaiBatchSize);

  for (const batch of batches) {
    const payload = batch.map((c) => ({
      id: c.id,
      username: c.username,
      name: c.name,
      bio: c.description,
      recent_post_text_samples: c.textSamples,
      recent_post_alt_text_samples: c.altTextSamples,
      recent_posts_checked: c.checkedCount,
      recent_posts_with_media: c.mediaCount
    }));

    const completion = await getClient().chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `以下はX(Twitter)アカウントのbioと直近投稿の要約データです。それぞれについて判定してください。\n\n${JSON.stringify(
            payload
          )}`
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "classification_batch",
          schema: RESPONSE_SCHEMA,
          strict: true
        }
      }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) continue;

    try {
      const parsed = JSON.parse(content) as { results: ClassifyResult[] };
      for (const r of parsed.results) {
        results.set(r.id, r);
      }
    } catch {
      // パース失敗時はこのバッチをスキップし、次回スキャン時に再試行させる
      continue;
    }
  }

  return results;
}
