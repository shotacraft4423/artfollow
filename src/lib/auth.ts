import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "./session";

// middleware では Edge Runtime の制約上 Cookie の有無しか確認できないため、
// 実際の署名検証はここ(Node runtime で動く route handler / server component)で行う。
export function hasValidSession(): boolean {
  const value = cookies().get(SESSION_COOKIE_NAME)?.value;
  return verifySessionCookieValue(value);
}

export function requireSession(): void | never {
  if (!hasValidSession()) {
    throw new SessionError();
  }
}

export class SessionError extends Error {
  constructor() {
    super("認証が必要です");
    this.name = "SessionError";
  }
}
