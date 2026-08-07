import crypto from "node:crypto";
import { config } from "./config";

const COOKIE_NAME = "artfollow_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type SessionPayload = {
  authenticated: true;
  issuedAt: number;
};

function sign(data: string): string {
  return crypto.createHmac("sha256", config.appSecret).update(data).digest("base64url");
}

export function createSessionCookieValue(): string {
  const payload: SessionPayload = { authenticated: true, issuedAt: Date.now() };
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(json);
  return `${json}.${sig}`;
}

export function verifySessionCookieValue(value: string | undefined | null): boolean {
  if (!value) return false;
  const [json, sig] = value.split(".");
  if (!json || !sig) return false;

  const expectedSig = sign(json);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  try {
    const payload = JSON.parse(Buffer.from(json, "base64url").toString()) as SessionPayload;
    if (!payload.authenticated) return false;
    if (Date.now() - payload.issuedAt > SESSION_TTL_MS) return false;
    return true;
  } catch {
    return false;
  }
}

export function verifyAppPassword(password: string): boolean {
  const expected = Buffer.from(config.appPassword);
  const actual = Buffer.from(password);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
