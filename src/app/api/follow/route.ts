import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { getDb, getSetting } from "@/lib/db";
import { followUser, RateLimitError } from "@/lib/xClient";
import { config } from "@/lib/config";

export const runtime = "nodejs";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const myId = getSetting("x_user_id");
  if (!myId) {
    return NextResponse.json({ error: "X未連携です" }, { status: 400 });
  }

  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  if (ids.length === 0) {
    return NextResponse.json({ error: "フォロー対象が指定されていません" }, { status: 400 });
  }

  const db = getDb();
  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let rateLimited = false;

  for (const id of ids) {
    if (rateLimited) {
      failed.push({ id, error: "レート制限のためスキップ" });
      continue;
    }
    try {
      await followUser(myId, id);
      db.prepare(
        "UPDATE followers SET followed_back = 1, followed_back_at = ?, follow_error = NULL WHERE id = ?"
      ).run(new Date().toISOString(), id);
      succeeded.push(id);
    } catch (e) {
      if (e instanceof RateLimitError) {
        rateLimited = true;
        failed.push({ id, error: "レート制限に達しました" });
        continue;
      }
      const message = e instanceof Error ? e.message : "不明なエラー";
      db.prepare("UPDATE followers SET follow_error = ? WHERE id = ?").run(message, id);
      failed.push({ id, error: message });
    }
    if (config.followDelayMs > 0 && !rateLimited) await sleep(config.followDelayMs);
  }

  return NextResponse.json({ ok: true, succeeded, failed, rateLimited });
}
