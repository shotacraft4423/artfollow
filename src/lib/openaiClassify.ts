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
  is_match: boolean;
  confidence: number;
  reason: string;
};

// bio + 直近ポストの内容が変わらない限り再分類しないためのハッシュ。
export function computeContentHash(candidate: Pick<ClassifyCandidate, "description" | "textSamples">): string {
  const raw = candidate.description + "||" + candidate.textSamples.join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function buildSystemPrompt(queryText: string): string {
  return `あなたはX(Twitter)のアカウントを分析し、次の条件に当てはまる人物かどうかを判定するアシスタントです。

条件: 「${queryText}」

判定材料:
- プロフィール文(bio)の内容
- 直近の投稿本文のサンプル(recent_post_text_samples)
- 直近の投稿のうち画像/動画付き投稿の割合(recent_posts_with_media / recent_posts_checked)。ただし画像を投稿していること自体は条件と無関係な場合もあるので、条件文の内容に照らして関連性を判断すること
- 画像のalt textサンプル(recent_post_alt_text_samples)

条件と無関係な情報(単にその話題が好き、他人の投稿を紹介・言及しているだけ等)だけでは条件に当てはまるとは判定しないこと。条件文が「〜している人」のように本人の行動を指す場合は、本人がそれを行っている根拠があるかを重視してください。

各アカウントについて is_match (真偽)、confidence (0.0〜1.0の確信度)、reason (日本語で1文の簡潔な根拠) を返してください。情報が不十分な場合は confidence を低めにしてください。`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          is_match: { type: "boolean" },
          confidence: { type: "number" },
          reason: { type: "string" }
        },
        required: ["id", "is_match", "confidence", "reason"],
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
export async function classifyBatch(
  candidates: ClassifyCandidate[],
  queryText: string
): Promise<Map<string, ClassifyResult>> {
  const results = new Map<string, ClassifyResult>();
  if (candidates.length === 0) return results;

  const systemPrompt = buildSystemPrompt(queryText);
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
        { role: "system", content: systemPrompt },
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
