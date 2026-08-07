import { NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { disconnectX, revokeCurrentToken } from "@/lib/xOAuth";

export const runtime = "nodejs";

export async function POST() {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  await revokeCurrentToken();
  disconnectX();
  return NextResponse.json({ ok: true });
}
