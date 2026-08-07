import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const minConfidence = Number(
    url.searchParams.get("minConfidence") ?? String(config.artistConfidenceThreshold)
  );

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, username, name, description, profile_image_url,
              followers_count, confidence, reason, classified_at,
              tweets_checked_count, tweets_media_count
       FROM followers
       WHERE is_following = 0 AND followed_back = 0
         AND classified = 1 AND is_artist = 1 AND confidence >= @minConfidence
       ORDER BY confidence DESC, followers_count DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ minConfidence, limit, offset });

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM followers
         WHERE is_following = 0 AND followed_back = 0
           AND classified = 1 AND is_artist = 1 AND confidence >= ?`
      )
      .get(minConfidence) as { c: number }
  ).c;

  return NextResponse.json({ rows, total, limit, offset });
}
