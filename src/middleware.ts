import { NextRequest, NextResponse } from "next/server";
import { config as appConfig } from "@/lib/config";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};

const PUBLIC_PATHS = ["/login", "/api/auth/app-login"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("artfollow_session")?.value;
  // 署名検証は Node.js の crypto に依存するため、Edge Runtime の middleware では
  // Cookieの「存在」のみを確認し、実際の署名検証は各 API route / page 側 (Node runtime) で行う。
  if (!cookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const loginUrl = new URL("/login", appConfig.publicOrigin);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
