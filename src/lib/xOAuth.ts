import crypto from "node:crypto";
import { config } from "./config";
import { getSetting, setSetting, deleteSetting } from "./db";
import { encrypt, decrypt } from "./crypto";

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const REVOKE_URL = "https://api.x.com/2/oauth2/revoke";

// フォロワー閲覧・フォロー実行に必要な最小スコープ。offline.access はリフレッシュトークン取得に必要。
export const X_SCOPES = [
  "tweet.read",
  "users.read",
  "follows.read",
  "follows.write",
  "offline.access"
].join(" ");

export function generateCodeVerifier(): string {
  return crypto.randomBytes(48).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function generateState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.xClientId);
  url.searchParams.set("redirect_uri", config.xRedirectUri);
  url.searchParams.set("scope", X_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function basicAuthHeader(): string {
  return "Basic " + Buffer.from(`${config.xClientId}:${config.xClientSecret}`).toString("base64");
}

type TokenResponse = {
  token_type: string;
  expires_in: number;
  access_token: string;
  scope: string;
  refresh_token?: string;
};

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader()
    },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X token endpoint error (${res.status}): ${text}`);
  }

  return (await res.json()) as TokenResponse;
}

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.xRedirectUri,
    code_verifier: codeVerifier
  });
  return requestToken(body);
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  return requestToken(body);
}

export function storeTokens(tokens: TokenResponse): void {
  setSetting("x_access_token", encrypt(tokens.access_token));
  if (tokens.refresh_token) {
    setSetting("x_refresh_token", encrypt(tokens.refresh_token));
  }
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  setSetting("x_token_expires_at", String(expiresAt));
}

export function isConnected(): boolean {
  return getSetting("x_access_token") !== null;
}

export function disconnectX(): void {
  for (const key of [
    "x_access_token",
    "x_refresh_token",
    "x_token_expires_at",
    "x_user_id",
    "x_username",
    "following_synced_at",
    "followers_pagination_token",
    "followers_scan_done"
  ]) {
    deleteSetting(key);
  }
}

// 有効なアクセストークンを返す。期限切れなら自動でリフレッシュしてDBを更新する。
export async function getValidAccessToken(): Promise<string> {
  const accessTokenEnc = getSetting("x_access_token");
  if (!accessTokenEnc) {
    throw new Error("X未連携です。先にXアカウントを連携してください。");
  }

  const expiresAt = Number(getSetting("x_token_expires_at") ?? "0");
  const bufferMs = 60_000; // 期限の1分前には更新しておく
  if (Date.now() < expiresAt - bufferMs) {
    return decrypt(accessTokenEnc);
  }

  const refreshTokenEnc = getSetting("x_refresh_token");
  if (!refreshTokenEnc) {
    throw new Error("Xのリフレッシュトークンがありません。再連携してください。");
  }

  const tokens = await refreshAccessToken(decrypt(refreshTokenEnc));
  storeTokens(tokens);
  return tokens.access_token;
}

export async function revokeCurrentToken(): Promise<void> {
  const accessTokenEnc = getSetting("x_access_token");
  if (!accessTokenEnc) return;
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader()
      },
      body: new URLSearchParams({
        token: decrypt(accessTokenEnc),
        token_type_hint: "access_token"
      })
    });
  } catch {
    // ベストエフォート。失敗してもローカルの連携解除は継続する。
  }
}
