import { NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { buildAuthorizeUrl, generateCodeChallenge, generateCodeVerifier, generateState } from "@/lib/xOAuth";

export const runtime = "nodejs";

export async function GET() {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  const res = NextResponse.redirect(buildAuthorizeUrl(state, challenge));
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600
  };
  res.cookies.set("x_oauth_state", state, cookieOpts);
  res.cookies.set("x_oauth_verifier", verifier, cookieOpts);
  return res;
}
