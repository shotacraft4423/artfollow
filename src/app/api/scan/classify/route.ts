import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { fetchRecentTweetSignal, RateLimitError } from "@/lib/xClient";
import { heuristicMatch } from "@/lib/heuristic";
import { classifyBatch, computeContentHash, ClassifyCandidate } from "@/lib/openaiClassify";
import { getOrCreateQueryKeywords } from "@/lib/searchQuery";
import { config } from "@/lib/config";

export const runtime = "nodejs";

type FollowerRow = {
  id: string;
  username: string;
  name: string;
  description: string;
  tweets_checked_at: string | null;
  tweets_checked_count: number | null;
  tweets_media_count: number | null;
  tweets_sample: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTweetCacheFresh(checkedAt: string | null): boolean {
  if (!checkedAt) return false;
  const ageMs = Date.now() - new Date(checkedAt).getTime();
  return ageMs < config.tweetsCacheMaxAgeDays * 24 * 60 * 60 * 1000;
}

function upsertSkippedClassification(followerId: string, queryHash: string, reason: string) {
  getDb()
    .prepare(
      `INSERT INTO classifications (follower_id, query_hash, is_match, confidence, reason, skip_reason, classified_at, classifier_model)
       VALUES (@followerId, @queryHash, 0, 0, @reason, @reason, @now, NULL)
       ON CONFLICT(follower_id, query_hash) DO UPDATE SET
         is_match = 0, confidence = 0, reason = excluded.reason, skip_reason = excluded.skip_reason,
         classified_at = excluded.classified_at, classifier_model = NULL`
    )
    .run({ followerId, queryHash, reason, now: new Date().toISOString() });
}

export async function POST(req: NextRequest) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  let queryText = "";
  try {
    const body = await req.json();
    queryText = typeof body?.query === "string" ? body.query.trim() : "";
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  if (!queryText) {
    return NextResponse.json({ error: "検索したい人物像を入力してください" }, { status: 400 });
  }

  const { hash: queryHash, keywords } = await getOrCreateQueryKeywords(queryText);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT f.id, f.username, f.name, f.description,
              f.tweets_checked_at, f.tweets_checked_count, f.tweets_media_count, f.tweets_sample
       FROM followers f
       LEFT JOIN classifications c ON c.follower_id = f.id AND c.query_hash = @queryHash
       WHERE c.follower_id IS NULL
       ORDER BY f.fetched_at ASC
       LIMIT @limit`
    )
    .all({ queryHash, limit: config.maxCandidatesPerClassifyRun }) as FollowerRow[];

  let skippedNoBio = 0;
  let skippedHeuristic = 0;
  let checkedViaTweets = 0;
  let reusedTweetCache = 0;
  let rateLimited = false;

  const toClassify: ClassifyCandidate[] = [];

  for (const row of rows) {
    const bio = (row.description ?? "").trim();
    if (bio.length < 2) {
      upsertSkippedClassification(row.id, queryHash, "bioが空のため対象外と判定");
      skippedNoBio++;
      continue;
    }

    const matched = heuristicMatch(row.description, row.name, keywords);

    if (!matched && config.classifyOnlyHeuristicMatches) {
      upsertSkippedClassification(row.id, queryHash, "bioに関連キーワードが見つからなかったため対象外");
      skippedHeuristic++;
      continue;
    }

    if (rateLimited) {
      // 既にレート制限に達した場合、以降はツイート取得をスキップして次回スキャンに回す
      continue;
    }

    let textSamples: string[];
    let altTextSamples: string[];
    let mediaCount: number;
    let checkedCount: number;

    if (isTweetCacheFresh(row.tweets_checked_at) && row.tweets_sample != null) {
      // 直近投稿のキャッシュは検索クエリに依存しないため、他クエリでの取得結果を再利用してAPI呼び出しを節約する
      textSamples = JSON.parse(row.tweets_sample) as string[];
      altTextSamples = [];
      mediaCount = row.tweets_media_count ?? 0;
      checkedCount = row.tweets_checked_count ?? 0;
      reusedTweetCache++;
    } else {
      try {
        const signal = await fetchRecentTweetSignal(row.id);
        checkedViaTweets++;

        db.prepare(
          `UPDATE followers SET tweets_checked_at = @now, tweets_checked_count = @count,
           tweets_media_count = @media, tweets_sample = @sample WHERE id = @id`
        ).run({
          id: row.id,
          now: new Date().toISOString(),
          count: signal.checkedCount,
          media: signal.mediaCount,
          sample: JSON.stringify(signal.textSamples)
        });

        textSamples = signal.textSamples;
        altTextSamples = signal.altTextSamples;
        mediaCount = signal.mediaCount;
        checkedCount = signal.checkedCount;

        if (config.tweetsFetchDelayMs > 0) await sleep(config.tweetsFetchDelayMs);
      } catch (e) {
        if (e instanceof RateLimitError) {
          rateLimited = true;
          continue;
        }
        upsertSkippedClassification(row.id, queryHash, "投稿取得中にエラーが発生したため対象外");
        continue;
      }
    }

    const candidate: ClassifyCandidate = {
      id: row.id,
      username: row.username,
      name: row.name ?? "",
      description: bio,
      textSamples,
      altTextSamples,
      mediaCount,
      checkedCount
    };
    toClassify.push(candidate);
  }

  let classifiedCount = 0;
  if (toClassify.length > 0) {
    const results = await classifyBatch(toClassify, queryText);
    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO classifications (follower_id, query_hash, is_match, confidence, reason, skip_reason, classified_at, classifier_model, content_hash)
       VALUES (@followerId, @queryHash, @isMatch, @confidence, @reason, NULL, @now, @model, @contentHash)
       ON CONFLICT(follower_id, query_hash) DO UPDATE SET
         is_match = excluded.is_match, confidence = excluded.confidence, reason = excluded.reason,
         skip_reason = NULL, classified_at = excluded.classified_at,
         classifier_model = excluded.classifier_model, content_hash = excluded.content_hash`
    );
    for (const c of toClassify) {
      const r = results.get(c.id);
      if (!r) continue;
      upsert.run({
        followerId: c.id,
        queryHash,
        isMatch: r.is_match ? 1 : 0,
        confidence: r.confidence,
        reason: r.reason,
        now,
        model: config.openaiModel,
        contentHash: computeContentHash(c)
      });
      classifiedCount++;
    }
  }

  const remaining = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM followers f
         LEFT JOIN classifications c ON c.follower_id = f.id AND c.query_hash = ?
         WHERE c.follower_id IS NULL`
      )
      .get(queryHash) as { c: number }
  ).c;

  return NextResponse.json({
    ok: true,
    queryHash,
    processed: rows.length,
    skippedNoBio,
    skippedHeuristic,
    checkedViaTweets,
    reusedTweetCache,
    classifiedCount,
    rateLimited,
    remaining
  });
}
