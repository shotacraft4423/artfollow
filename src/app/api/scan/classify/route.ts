import { NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { fetchRecentTweetSignal, RateLimitError } from "@/lib/xClient";
import { heuristicMatch } from "@/lib/heuristic";
import { classifyBatch, computeContentHash, ClassifyCandidate } from "@/lib/openaiClassify";
import { config } from "@/lib/config";

export const runtime = "nodejs";

type FollowerRow = {
  id: string;
  username: string;
  name: string;
  description: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markSkipped(id: string, reason: string) {
  getDb()
    .prepare(
      `UPDATE followers SET classified = 1, is_artist = 0, confidence = 0, reason = @reason,
       classify_skip_reason = @reason, classified_at = @now WHERE id = @id`
    )
    .run({ id, reason, now: new Date().toISOString() });
}

export async function POST() {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, username, name, description FROM followers
       WHERE is_following = 0 AND classified = 0
       ORDER BY fetched_at ASC LIMIT ?`
    )
    .all(config.maxCandidatesPerClassifyRun) as FollowerRow[];

  let skippedNoBio = 0;
  let skippedHeuristic = 0;
  let checkedViaTweets = 0;
  let rateLimited = false;

  const toClassify: ClassifyCandidate[] = [];

  for (const row of rows) {
    const bio = (row.description ?? "").trim();
    if (bio.length < 2) {
      markSkipped(row.id, "bioが空のため対象外と判定");
      skippedNoBio++;
      continue;
    }

    const matched = heuristicMatch(row.description, row.name);
    db.prepare("UPDATE followers SET heuristic_match = ? WHERE id = ?").run(matched ? 1 : 0, row.id);

    if (!matched && config.classifyOnlyHeuristicMatches) {
      markSkipped(row.id, "bioに絵描き関連キーワードが見つからなかったため対象外");
      skippedHeuristic++;
      continue;
    }

    if (rateLimited) {
      // 既にレート制限に達した場合、以降はツイート取得をスキップして次回スキャンに回す
      continue;
    }

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

      const candidate: ClassifyCandidate = {
        id: row.id,
        username: row.username,
        name: row.name ?? "",
        description: bio,
        textSamples: signal.textSamples,
        altTextSamples: signal.altTextSamples,
        mediaCount: signal.mediaCount,
        checkedCount: signal.checkedCount
      };
      const hash = computeContentHash(candidate);
      db.prepare("UPDATE followers SET content_hash = ? WHERE id = ?").run(hash, row.id);
      toClassify.push(candidate);

      if (config.tweetsFetchDelayMs > 0) await sleep(config.tweetsFetchDelayMs);
    } catch (e) {
      if (e instanceof RateLimitError) {
        rateLimited = true;
        continue;
      }
      markSkipped(row.id, "投稿取得中にエラーが発生したため対象外");
    }
  }

  let classifiedCount = 0;
  if (toClassify.length > 0) {
    const results = await classifyBatch(toClassify);
    const now = new Date().toISOString();
    const update = db.prepare(
      `UPDATE followers SET classified = 1, is_artist = @is_artist, confidence = @confidence,
       reason = @reason, classified_at = @now, classifier_model = @model WHERE id = @id`
    );
    for (const c of toClassify) {
      const r = results.get(c.id);
      if (!r) continue;
      update.run({
        id: c.id,
        is_artist: r.is_artist ? 1 : 0,
        confidence: r.confidence,
        reason: r.reason,
        now,
        model: config.openaiModel
      });
      classifiedCount++;
    }
  }

  const remaining = (
    db
      .prepare("SELECT COUNT(*) as c FROM followers WHERE is_following = 0 AND classified = 0")
      .get() as { c: number }
  ).c;

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    skippedNoBio,
    skippedHeuristic,
    checkedViaTweets,
    classifiedCount,
    rateLimited,
    remaining
  });
}
