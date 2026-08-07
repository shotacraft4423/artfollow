import { NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { isConnected } from "@/lib/xOAuth";
import { getSetting } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const connected = isConnected();
  return NextResponse.json({
    connected,
    username: connected ? getSetting("x_username") : null,
    followingSyncedAt: getSetting("following_synced_at")
  });
}
