import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { getDb, getSetting } from "@/lib/db";
import { isConnected } from "@/lib/xOAuth";
import { hashQuery } from "@/lib/searchQuery";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const url = new URL(req.url);
  const queryText = (url.searchParams.get("query") ?? "").trim();

  const db = getDb();
  const totalFollowers = (db.prepare("SELECT COUNT(*) as c FROM followers").get() as { c: number }).c;
  const notFollowingBack = (
    db.prepare("SELECT COUNT(*) as c FROM followers WHERE is_following = 0").get() as { c: number }
  ).c;
  const followedBack = (
    db.prepare("SELECT COUNT(*) as c FROM followers WHERE followed_back = 1").get() as { c: number }
  ).c;

  let pendingClassification = 0;
  let classified = 0;
  let matchCount = 0;

  if (queryText) {
    const queryHash = hashQuery(queryText);
    pendingClassification = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM followers f
           LEFT JOIN classifications c ON c.follower_id = f.id AND c.query_hash = ?
           WHERE c.follower_id IS NULL`
        )
        .get(queryHash) as { c: number }
    ).c;
    classified = (
      db
        .prepare("SELECT COUNT(*) as c FROM classifications WHERE query_hash = ?")
        .get(queryHash) as { c: number }
    ).c;
    matchCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM classifications WHERE query_hash = ? AND is_match = 1")
        .get(queryHash) as { c: number }
    ).c;
  }

  return NextResponse.json({
    connected: isConnected(),
    username: getSetting("x_username"),
    totalFollowers,
    notFollowingBack,
    followedBack,
    pendingClassification,
    classified,
    matchCount,
    followersScanHasMore: getSetting("followers_scan_done") !== "1"
  });
}
