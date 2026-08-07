import { getValidAccessToken } from "./xOAuth";
import { config } from "./config";

const API_BASE = "https://api.x.com/2";

export class RateLimitError extends Error {
  resetAt: number;
  constructor(resetAt: number) {
    super(`X APIのレート制限に達しました。リセット時刻: ${new Date(resetAt).toISOString()}`);
    this.name = "RateLimitError";
    this.resetAt = resetAt;
  }
}

async function xFetch(path: string, params?: Record<string, string>): Promise<any> {
  const accessToken = await getValidAccessToken();
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });

  if (res.status === 429) {
    const resetHeader = res.headers.get("x-rate-limit-reset");
    const resetAt = resetHeader ? Number(resetHeader) * 1000 : Date.now() + 15 * 60_000;
    throw new RateLimitError(resetAt);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X API エラー (${res.status}) ${path}: ${text}`);
  }

  return res.json();
}

async function xPost(path: string, body: unknown): Promise<any> {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (res.status === 429) {
    const resetHeader = res.headers.get("x-rate-limit-reset");
    const resetAt = resetHeader ? Number(resetHeader) * 1000 : Date.now() + 15 * 60_000;
    throw new RateLimitError(resetAt);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X API エラー (${res.status}) ${path}: ${text}`);
  }

  return res.json();
}

export type XUser = {
  id: string;
  username: string;
  name: string;
  description?: string;
  profile_image_url?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
};

export async function getMe(): Promise<{ id: string; username: string; name: string }> {
  const data = await xFetch("/users/me", { "user.fields": "id,username,name" });
  return data.data;
}

export async function fetchFollowingPage(
  userId: string,
  paginationToken?: string
): Promise<{ ids: string[]; nextToken?: string }> {
  const data = await xFetch(`/users/${userId}/following`, {
    max_results: "1000",
    "user.fields": "id",
    pagination_token: paginationToken ?? ""
  });
  const ids: string[] = (data.data ?? []).map((u: { id: string }) => u.id);
  return { ids, nextToken: data.meta?.next_token };
}

export async function fetchFollowersPage(
  userId: string,
  paginationToken?: string
): Promise<{ users: XUser[]; nextToken?: string }> {
  const data = await xFetch(`/users/${userId}/followers`, {
    max_results: "1000",
    "user.fields": "id,username,name,description,profile_image_url,public_metrics",
    pagination_token: paginationToken ?? ""
  });
  return { users: data.data ?? [], nextToken: data.meta?.next_token };
}

export type TweetSignal = {
  checkedCount: number;
  mediaCount: number;
  textSamples: string[];
  altTextSamples: string[];
};

// 直近のポスト(最大 RECENT_POSTS_TO_CHECK 件)を取得し、画像投稿の割合とテキストサンプルを抽出する。
// 全文・全画像をそのままOpenAIに渡すとコストが跳ね上がるため、ここで要約的な信号に圧縮する。
export async function fetchRecentTweetSignal(userId: string): Promise<TweetSignal> {
  const exclude = config.excludeReplies ? "retweets,replies" : "retweets";
  const data = await xFetch(`/users/${userId}/tweets`, {
    max_results: String(Math.min(Math.max(config.recentPostsToCheck, 5), 100)),
    exclude,
    "tweet.fields": "text,attachments",
    expansions: "attachments.media_keys",
    "media.fields": "type,alt_text"
  });

  const tweets: Array<{ text: string; attachments?: { media_keys?: string[] } }> = data.data ?? [];
  const mediaMap = new Map<string, { type: string; alt_text?: string }>();
  for (const m of data.includes?.media ?? []) {
    mediaMap.set(m.media_key, m);
  }

  let mediaCount = 0;
  const textSamples: string[] = [];
  const altTextSamples: string[] = [];

  for (const tweet of tweets) {
    const keys = tweet.attachments?.media_keys ?? [];
    const mediaItems = keys.map((k) => mediaMap.get(k)).filter(Boolean) as Array<{
      type: string;
      alt_text?: string;
    }>;
    const hasVisualMedia = mediaItems.some((m) => m.type === "photo" || m.type === "video" || m.type === "animated_gif");
    if (hasVisualMedia) mediaCount += 1;

    for (const m of mediaItems) {
      if (m.alt_text) altTextSamples.push(m.alt_text.slice(0, 200));
    }

    if (textSamples.length < 12 && tweet.text) {
      textSamples.push(tweet.text.replace(/https?:\/\/\S+/g, "").trim().slice(0, 200));
    }
  }

  return {
    checkedCount: tweets.length,
    mediaCount,
    textSamples: textSamples.filter((t) => t.length > 0),
    altTextSamples: altTextSamples.slice(0, 10)
  };
}

export async function followUser(myUserId: string, targetUserId: string): Promise<void> {
  await xPost(`/users/${myUserId}/following`, { target_user_id: targetUserId });
}
