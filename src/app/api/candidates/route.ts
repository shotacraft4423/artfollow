import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hashQuery } from "@/lib/searchQuery";
import { config } from "@/lib/config";

export const runtime = "nodejs";

const SORT_COLUMNS: Record<string, string> = {
  confidence: "c.confidence",
  followers_count: "f.followers_count",
  mutual_follow_count: "f.mutual_follow_count",
  fetched_at: "f.fetched_at",
  tweet_count: "f.tweet_count"
};

export async function GET(req: NextRequest) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const url = new URL(req.url);
  const queryText = (url.searchParams.get("query") ?? "").trim();
  if (!queryText) {
    return NextResponse.json({ error: "検索クエリが指定されていません" }, { status: 400 });
  }
  const queryHash = hashQuery(queryText);

  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const minConfidence = Number(
    url.searchParams.get("minConfidence") ?? String(config.artistConfidenceThreshold)
  );

  const isFollowing = url.searchParams.get("isFollowing") ?? "any"; // any | following | not_following
  const minFollowers = url.searchParams.get("minFollowers");
  const maxFollowers = url.searchParams.get("maxFollowers");
  const minMutual = url.searchParams.get("minMutual");

  const sortByParam = url.searchParams.get("sortBy") ?? "confidence";
  const sortColumn = SORT_COLUMNS[sortByParam] ?? SORT_COLUMNS.confidence;
  const sortDir = url.searchParams.get("sortDir") === "asc" ? "ASC" : "DESC";

  const conditions: string[] = ["c.query_hash = @queryHash", "c.is_match = 1", "c.confidence >= @minConfidence"];
  const params: Record<string, unknown> = { queryHash, minConfidence, limit, offset };

  if (isFollowing === "following") {
    conditions.push("f.is_following = 1");
  } else if (isFollowing === "not_following") {
    conditions.push("f.is_following = 0");
  }

  if (minFollowers !== null && minFollowers !== "") {
    conditions.push("f.followers_count >= @minFollowers");
    params.minFollowers = Number(minFollowers);
  }
  if (maxFollowers !== null && maxFollowers !== "") {
    conditions.push("f.followers_count <= @maxFollowers");
    params.maxFollowers = Number(maxFollowers);
  }
  if (minMutual !== null && minMutual !== "") {
    conditions.push("f.mutual_follow_count IS NOT NULL AND f.mutual_follow_count >= @minMutual");
    params.minMutual = Number(minMutual);
  }

  const whereClause = conditions.join(" AND ");

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT f.id, f.username, f.name, f.description, f.profile_image_url,
              f.followers_count, f.following_count, f.tweet_count, f.is_following,
              f.mutual_follow_count, f.mutual_follow_checked_at,
              f.tweets_checked_count, f.tweets_media_count,
              f.followed_back,
              c.confidence, c.reason, c.classified_at
       FROM followers f
       JOIN classifications c ON c.follower_id = f.id
       WHERE ${whereClause}
       ORDER BY ${sortColumn} ${sortDir}
       LIMIT @limit OFFSET @offset`
    )
    .all(params);

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM followers f
         JOIN classifications c ON c.follower_id = f.id
         WHERE ${whereClause}`
      )
      .get(params) as { c: number }
  ).c;

  return NextResponse.json({ rows, total, limit, offset, queryHash });
}
