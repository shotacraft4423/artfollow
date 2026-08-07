import { NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { getDb, getSetting } from "@/lib/db";
import { isConnected } from "@/lib/xOAuth";

export const runtime = "nodejs";

export async function GET() {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const db = getDb();
  const totalFollowers = (db.prepare("SELECT COUNT(*) as c FROM followers").get() as { c: number }).c;
  const notFollowingBack = (
    db.prepare("SELECT COUNT(*) as c FROM followers WHERE is_following = 0").get() as { c: number }
  ).c;
  const classified = (
    db.prepare("SELECT COUNT(*) as c FROM followers WHERE classified = 1").get() as { c: number }
  ).c;
  const pendingClassification = (
    db
      .prepare("SELECT COUNT(*) as c FROM followers WHERE is_following = 0 AND classified = 0")
      .get() as { c: number }
  ).c;
  const artistCandidates = (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM followers WHERE is_following = 0 AND followed_back = 0 AND classified = 1 AND is_artist = 1"
      )
      .get() as { c: number }
  ).c;
  const followedBack = (
    db.prepare("SELECT COUNT(*) as c FROM followers WHERE followed_back = 1").get() as { c: number }
  ).c;

  return NextResponse.json({
    connected: isConnected(),
    username: getSetting("x_username"),
    totalFollowers,
    notFollowingBack,
    classified,
    pendingClassification,
    artistCandidates,
    followedBack,
    followersScanHasMore: getSetting("followers_scan_done") !== "1"
  });
}
