import { NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { getDb, getSetting, setSetting } from "@/lib/db";
import { fetchFollowersPage, fetchFollowingPage, RateLimitError, XUser } from "@/lib/xClient";
import { config } from "@/lib/config";

export const runtime = "nodejs";

const FOLLOWING_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function syncFollowingIfStale(myId: string): Promise<{ synced: boolean; error?: string }> {
  const syncedAt = getSetting("following_synced_at");
  const isStale = !syncedAt || Date.now() - Number(syncedAt) > FOLLOWING_SYNC_MAX_AGE_MS;
  if (!isStale) return { synced: false };

  const db = getDb();
  let token = getSetting("following_sync_token") ?? undefined;
  const collected: string[] = [];
  // 既に途中まで集めた分があれば温存するため一時テーブルは使わず、完了時にまとめて置き換える
  const alreadyCollectedRaw = getSetting("following_sync_partial");
  if (alreadyCollectedRaw) collected.push(...(JSON.parse(alreadyCollectedRaw) as string[]));

  let pages = 0;
  try {
    while (pages < config.maxFollowerPagesPerScan) {
      const { ids, nextToken } = await fetchFollowingPage(myId, token);
      collected.push(...ids);
      pages++;
      token = nextToken;
      if (!nextToken) break;
    }
  } catch (e) {
    if (e instanceof RateLimitError) {
      setSetting("following_sync_token", token ?? "");
      setSetting("following_sync_partial", JSON.stringify(collected));
      return { synced: false, error: "フォロー中一覧の取得中にレート制限に達しました。時間を置いて再試行してください。" };
    }
    throw e;
  }

  if (token) {
    // まだ続きがある場合は次回に持ち越し
    setSetting("following_sync_token", token);
    setSetting("following_sync_partial", JSON.stringify(collected));
    return { synced: false };
  }

  const insert = db.prepare("INSERT OR REPLACE INTO following (id, synced_at) VALUES (?, ?)");
  const now = new Date().toISOString();
  const tx = db.transaction((ids: string[]) => {
    db.prepare("DELETE FROM following").run();
    for (const id of ids) insert.run(id, now);
    db.prepare(
      `UPDATE followers SET is_following = EXISTS(SELECT 1 FROM following WHERE following.id = followers.id)`
    ).run();
  });
  tx(collected);

  setSetting("following_synced_at", String(Date.now()));
  setSetting("following_sync_token", "");
  setSetting("following_sync_partial", "");
  return { synced: true };
}

function upsertFollowers(users: XUser[], followingIds: Set<string>) {
  const db = getDb();
  const now = new Date().toISOString();

  const selectExisting = db.prepare("SELECT description, classified FROM followers WHERE id = ?");
  const insertNew = db.prepare(`
    INSERT INTO followers (
      id, username, name, description, profile_image_url,
      followers_count, following_count, tweet_count,
      is_following, fetched_at, classified
    ) VALUES (@id, @username, @name, @description, @profile_image_url,
      @followers_count, @following_count, @tweet_count,
      @is_following, @fetched_at, 0)
  `);
  const updateUnchanged = db.prepare(`
    UPDATE followers SET
      username = @username, name = @name, description = @description,
      profile_image_url = @profile_image_url, followers_count = @followers_count,
      following_count = @following_count, tweet_count = @tweet_count,
      is_following = @is_following, fetched_at = @fetched_at
    WHERE id = @id
  `);
  const updateChanged = db.prepare(`
    UPDATE followers SET
      username = @username, name = @name, description = @description,
      profile_image_url = @profile_image_url, followers_count = @followers_count,
      following_count = @following_count, tweet_count = @tweet_count,
      is_following = @is_following, fetched_at = @fetched_at,
      classified = 0, is_artist = NULL, confidence = NULL, reason = NULL,
      classified_at = NULL, classify_skip_reason = NULL
    WHERE id = @id
  `);

  let newCount = 0;
  const tx = db.transaction((rows: XUser[]) => {
    for (const u of rows) {
      const params = {
        id: u.id,
        username: u.username,
        name: u.name ?? "",
        description: u.description ?? "",
        profile_image_url: u.profile_image_url ?? "",
        followers_count: u.public_metrics?.followers_count ?? 0,
        following_count: u.public_metrics?.following_count ?? 0,
        tweet_count: u.public_metrics?.tweet_count ?? 0,
        is_following: followingIds.has(u.id) ? 1 : 0,
        fetched_at: now
      };

      const existing = selectExisting.get(u.id) as { description: string; classified: number } | undefined;
      if (!existing) {
        insertNew.run(params);
        newCount++;
      } else if (existing.description !== params.description) {
        updateChanged.run(params);
      } else {
        updateUnchanged.run(params);
      }
    }
  });
  tx(users);
  return newCount;
}

export async function POST() {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const myId = getSetting("x_user_id");
  if (!myId) {
    return NextResponse.json({ error: "X未連携です" }, { status: 400 });
  }

  try {
    const followingResult = await syncFollowingIfStale(myId);

    const followingIds = new Set(
      (getDb().prepare("SELECT id FROM following").all() as { id: string }[]).map((r) => r.id)
    );

    let token = getSetting("followers_pagination_token") ?? undefined;
    const alreadyDone = getSetting("followers_scan_done") === "1";

    let pages = 0;
    let totalFetched = 0;
    let newCount = 0;
    let hasMore = !alreadyDone;

    if (!alreadyDone) {
      while (pages < config.maxFollowerPagesPerScan) {
        const { users, nextToken } = await fetchFollowersPage(myId, token);
        newCount += upsertFollowers(users, followingIds);
        totalFetched += users.length;
        pages++;
        token = nextToken;
        if (!nextToken) {
          hasMore = false;
          break;
        }
      }
      setSetting("followers_pagination_token", token ?? "");
      setSetting("followers_scan_done", hasMore ? "0" : "1");
    }

    const totalInDb = (
      getDb().prepare("SELECT COUNT(*) as c FROM followers").get() as { c: number }
    ).c;

    return NextResponse.json({
      ok: true,
      fetchedThisRun: totalFetched,
      newThisRun: newCount,
      totalInDb,
      hasMore,
      followingSync: followingResult
    });
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json(
        { error: e.message, rateLimited: true, resetAt: e.resetAt },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "不明なエラー" }, { status: 500 });
  }
}

export async function GET() {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }
  const db = getDb();
  const totalInDb = (db.prepare("SELECT COUNT(*) as c FROM followers").get() as { c: number }).c;
  const hasMore = getSetting("followers_scan_done") !== "1";
  return NextResponse.json({ totalInDb, hasMore });
}
