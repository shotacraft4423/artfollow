import crypto from "node:crypto";
import OpenAI from "openai";
import { getDb } from "./db";
import { config } from "./config";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: config.openaiApiKey });
  return client;
}

export function hashQuery(queryText: string): string {
  return crypto
    .createHash("sha256")
    .update(queryText.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

const KEYWORD_SCHEMA = {
  type: "object",
  properties: {
    keywords: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["keywords"],
  additionalProperties: false
} as const;

async function generateKeywords(queryText: string): Promise<string[]> {
  const completion = await getClient().chat.completions.create({
    model: config.openaiModel,
    messages: [
      {
        role: "system",
        content:
          "あなたはX(Twitter)のプロフィール文(bio)を事前フィルタするためのキーワードを考えるアシスタントです。" +
          "与えられた「探したい人物像」に当てはまるアカウントのbioに書かれていそうな単語・フレーズを、" +
          "日本語・英語を織り交ぜて15〜30個、できるだけ多様な言い回しで列挙してください。" +
          "一般的すぎて関係ないアカウントにもヒットしてしまう単語(例:「です」「好き」など)は避け、" +
          "その人物像に特有の単語を優先してください。"
      },
      { role: "user", content: `探したい人物像: ${queryText}` }
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "keyword_list", schema: KEYWORD_SCHEMA, strict: true }
    }
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) return [];
  try {
    const parsed = JSON.parse(content) as { keywords: string[] };
    return parsed.keywords.filter((k) => k && k.trim().length > 0);
  } catch {
    return [];
  }
}

// 検索クエリ文からbio事前フィルタ用キーワードを取得する。
// 同じクエリ文であればDBにキャッシュされ、OpenAIの呼び出しは初回の1回だけで済む。
export async function getOrCreateQueryKeywords(queryText: string): Promise<{ hash: string; keywords: string[] }> {
  const hash = hashQuery(queryText);
  const db = getDb();

  const existing = db
    .prepare("SELECT keywords_json FROM search_queries WHERE query_hash = ?")
    .get(hash) as { keywords_json: string } | undefined;

  if (existing) {
    return { hash, keywords: JSON.parse(existing.keywords_json) as string[] };
  }

  const keywords = await generateKeywords(queryText);
  db.prepare(
    "INSERT INTO search_queries (query_hash, query_text, keywords_json, created_at) VALUES (@hash, @queryText, @keywordsJson, @now)"
  ).run({
    hash,
    queryText,
    keywordsJson: JSON.stringify(keywords),
    now: new Date().toISOString()
  });

  return { hash, keywords };
}
