import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { fetchFollowingPage, RateLimitError } from "@/lib/xClient";
import { config } from "@/lib/config";

export const runtime = "nodejs";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 候補者のフォロー中一覧を取得し、自分のフォロー中(followingテーブル)と突き合わせて
// 「知り合い(自分がフォローしている人)のうち、この候補者もフォローしている人数」を算出する。
// 候補者ごとに追加のX API呼び出しが発生するため、オンデマンド(個別/選択分のみ)実行とする。
async function computeMutualFollowCount(candidateId: string): Promise<number | null> {
  const db = getDb();
  let token: string | undefined;
  let pages = 0;
  let mutualCount = 0;
  const seen = new Set<string>();

  while (pages < config.mutualFollowMaxPages) {
    const { ids, nextToken } = await fetchFollowingPage(candidateId, token);
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    pages++;
    token = nextToken;
    if (!nextToken) break;
    if (config.mutualFollowDelayMs > 0) await sleep(config.mutualFollowDelayMs);
  }

  if (seen.size === 0) return 0;

  const placeholders = Array.from(seen)
    .map(() => "?")
    .join(",");
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM following WHERE id IN (${placeholders})`)
    .get(...Array.from(seen)) as { c: number };
  mutualCount = row.c;
  return mutualCount;
}

export async function POST(req: NextRequest) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  if (ids.length === 0) {
    return NextResponse.json({ error: "対象が指定されていません" }, { status: 400 });
  }

  const db = getDb();
  const results: Record<string, number | string> = {};
  let rateLimited = false;

  for (const id of ids) {
    if (rateLimited) {
      results[id] = "レート制限のためスキップ";
      continue;
    }
    try {
      const count = await computeMutualFollowCount(id);
      db.prepare(
        "UPDATE followers SET mutual_follow_count = ?, mutual_follow_checked_at = ?, mutual_follow_error = NULL WHERE id = ?"
      ).run(count, new Date().toISOString(), id);
      results[id] = count ?? 0;
    } catch (e) {
      if (e instanceof RateLimitError) {
        rateLimited = true;
        results[id] = "レート制限に達しました";
        continue;
      }
      const message = e instanceof Error ? e.message : "不明なエラー";
      db.prepare("UPDATE followers SET mutual_follow_error = ? WHERE id = ?").run(message, id);
      results[id] = message;
    }
  }

  return NextResponse.json({ ok: true, results, rateLimited });
}
