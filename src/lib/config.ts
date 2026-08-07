function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `環境変数 ${name} が設定されていません。.env.example を参考に .env.local を作成してください。`
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export const config = {
  get appPassword() {
    return required("APP_PASSWORD");
  },
  get appSecret() {
    return required("APP_SECRET");
  },
  get xClientId() {
    return required("X_CLIENT_ID");
  },
  get xClientSecret() {
    return required("X_CLIENT_SECRET");
  },
  get xRedirectUri() {
    return required("X_REDIRECT_URI");
  },
  get openaiApiKey() {
    return required("OPENAI_API_KEY");
  },
  get openaiModel() {
    return optional("OPENAI_MODEL", "gpt-4o-mini");
  },
  get dbPath() {
    return optional("DB_PATH", "./data/app.db");
  },
  get artistConfidenceThreshold() {
    return parseFloat(optional("ARTIST_CONFIDENCE_THRESHOLD", "0.6"));
  },
  get classifyOnlyHeuristicMatches() {
    return optional("CLASSIFY_ONLY_HEURISTIC_MATCHES", "true") !== "false";
  },
  get recentPostsToCheck() {
    return parseInt(optional("RECENT_POSTS_TO_CHECK", "50"), 10);
  },
  get excludeReplies() {
    return optional("EXCLUDE_REPLIES", "false") === "true";
  },
  get followDelayMs() {
    return parseInt(optional("FOLLOW_DELAY_MS", "1500"), 10);
  },
  get tweetsFetchDelayMs() {
    return parseInt(optional("TWEETS_FETCH_DELAY_MS", "300"), 10);
  },
  get maxFollowerPagesPerScan() {
    return parseInt(optional("MAX_FOLLOWER_PAGES_PER_SCAN", "5"), 10);
  },
  get maxCandidatesPerClassifyRun() {
    return parseInt(optional("MAX_CANDIDATES_PER_CLASSIFY_RUN", "30"), 10);
  },
  get openaiBatchSize() {
    return parseInt(optional("OPENAI_BATCH_SIZE", "10"), 10);
  }
};
