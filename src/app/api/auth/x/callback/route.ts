import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { exchangeCodeForToken, storeTokens } from "@/lib/xOAuth";
import { getMe } from "@/lib/xClient";
import { setSetting } from "@/lib/db";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!hasValidSession()) {
    return NextResponse.redirect(new URL("/login", config.publicOrigin));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const expectedState = req.cookies.get("x_oauth_state")?.value;
  const verifier = req.cookies.get("x_oauth_verifier")?.value;

  const fail = (message: string) => {
    const dest = new URL("/", config.publicOrigin);
    dest.searchParams.set("x_error", message);
    return NextResponse.redirect(dest);
  };

  if (error) return fail(`X側で認可が拒否されました: ${error}`);
  if (!code || !state || !verifier) return fail("認可レスポンスが不正です");
  if (state !== expectedState) return fail("state不一致のため認可を中断しました");

  try {
    const tokens = await exchangeCodeForToken(code, verifier);
    storeTokens(tokens);

    const me = await getMe();
    setSetting("x_user_id", me.id);
    setSetting("x_username", me.username);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "トークン交換に失敗しました");
  }

  const res = NextResponse.redirect(new URL("/", config.publicOrigin));
  res.cookies.set("x_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("x_oauth_verifier", "", { path: "/", maxAge: 0 });
  return res;
}
