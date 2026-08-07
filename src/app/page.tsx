"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

type Status = {
  connected: boolean;
  username: string | null;
  totalFollowers: number;
  notFollowingBack: number;
  followedBack: number;
  pendingClassification: number;
  classified: number;
  matchCount: number;
  followersScanHasMore: boolean;
};

type Candidate = {
  id: string;
  username: string;
  name: string;
  description: string;
  profile_image_url: string | null;
  followers_count: number;
  following_count: number;
  tweet_count: number;
  is_following: number;
  mutual_follow_count: number | null;
  mutual_follow_checked_at: string | null;
  tweets_checked_count: number | null;
  tweets_media_count: number | null;
  followed_back: number;
  confidence: number;
  reason: string;
};

const PRESET_QUERIES = [
  "オリジナルのイラストや漫画を描いている絵師・アーティスト",
  "コスプレイヤー",
  "VTuberが好き・応援している人",
  "猫や犬などペットの写真をよく投稿している人",
  "ゲーム実況・ゲームプレイ動画を投稿している人"
];

type IsFollowingFilter = "any" | "following" | "not_following";
type SortBy = "confidence" | "followers_count" | "mutual_follow_count" | "fetched_at" | "tweet_count";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs text-white/50">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mutualLoading, setMutualLoading] = useState<Set<string>>(new Set());

  const [queryInput, setQueryInput] = useState("オリジナルのイラストや漫画を描いている絵師・アーティスト");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<"tile" | "detail">("detail");
  const [showReason, setShowReason] = useState(true);
  const [showConfidence, setShowConfidence] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const [isFollowing, setIsFollowing] = useState<IsFollowingFilter>("not_following");
  const [minFollowers, setMinFollowers] = useState("");
  const [maxFollowers, setMaxFollowers] = useState("");
  const [minMutual, setMinMutual] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("confidence");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const loadStatus = useCallback(async (query: string | null) => {
    const url = query ? `/api/status?query=${encodeURIComponent(query)}` : "/api/status";
    const res = await fetch(url);
    if (res.ok) setStatus(await res.json());
  }, []);

  const loadCandidates = useCallback(
    async (query: string | null) => {
      if (!query) {
        setCandidates([]);
        return;
      }
      const params = new URLSearchParams({
        query,
        limit: "100",
        isFollowing,
        sortBy,
        sortDir
      });
      if (minFollowers) params.set("minFollowers", minFollowers);
      if (maxFollowers) params.set("maxFollowers", maxFollowers);
      if (minMutual) params.set("minMutual", minMutual);

      const res = await fetch(`/api/candidates?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.rows);
      }
    },
    [isFollowing, sortBy, sortDir, minFollowers, maxFollowers, minMutual]
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const xError = url.searchParams.get("x_error");
    if (xError) setMessage(`X連携エラー: ${xError}`);
    loadStatus(null);
  }, [loadStatus]);

  // フィルタ・ソート変更時、既に検索済みのクエリがあれば自動的に再取得する
  useEffect(() => {
    if (activeQuery) loadCandidates(activeQuery);
  }, [activeQuery, loadCandidates]);

  async function runFollowerScan() {
    setBusy("フォロワーを取得しています...");
    setMessage(null);
    try {
      for (let i = 0; i < 20; i++) {
        const res = await fetch("/api/scan/followers", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          setMessage(data.error ?? "フォロワー取得でエラーが発生しました");
          break;
        }
        await loadStatus(activeQuery);
        if (!data.hasMore) break;
      }
    } finally {
      setBusy(null);
      await loadStatus(activeQuery);
    }
  }

  async function runSearch() {
    const query = queryInput.trim();
    if (!query) {
      setMessage("検索したい人物像を入力してください");
      return;
    }
    setActiveQuery(query);
    setBusy("AIでプロフィール・直近投稿を分析しています...");
    setMessage(null);
    try {
      for (let i = 0; i < 30; i++) {
        const res = await fetch("/api/scan/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query })
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage(data.error ?? "分類処理でエラーが発生しました");
          break;
        }
        await loadStatus(query);
        if (data.rateLimited) {
          setMessage("Xのレート制限に達したため、続きは時間を置いて再実行してください");
          break;
        }
        if (data.remaining === 0) break;
      }
    } finally {
      setBusy(null);
      await loadStatus(query);
      await loadCandidates(query);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(candidates.map((c) => c.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function followSelected() {
    if (selected.size === 0) return;
    setBusy(`${selected.size}件をフォローバックしています...`);
    setMessage(null);
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) })
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "フォロー処理でエラーが発生しました");
      } else {
        setMessage(
          `フォロー成功: ${data.succeeded.length}件${data.failed.length > 0 ? ` / 失敗: ${data.failed.length}件` : ""}`
        );
      }
      clearSelection();
      await loadCandidates(activeQuery);
      await loadStatus(activeQuery);
    } finally {
      setBusy(null);
    }
  }

  async function checkMutual(id: string) {
    setMutualLoading((prev) => new Set(prev).add(id));
    try {
      const res = await fetch("/api/mutual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] })
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "知り合い数の取得でエラーが発生しました");
        return;
      }
      const result = data.results?.[id];
      if (typeof result === "string") {
        setMessage(`知り合い数の取得に失敗: ${result}`);
      }
      await loadCandidates(activeQuery);
    } finally {
      setMutualLoading((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function checkMutualSelected() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setBusy(`選択した${ids.length}件の知り合い数を調べています...`);
    try {
      const res = await fetch("/api/mutual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });
      const data = await res.json();
      if (!res.ok) setMessage(data.error ?? "知り合い数の取得でエラーが発生しました");
      else if (data.rateLimited) setMessage("Xのレート制限に達しました。時間を置いて再試行してください");
      await loadCandidates(activeQuery);
    } finally {
      setBusy(null);
    }
  }

  if (!status) {
    return <main className="p-6 text-white/60">読み込み中...</main>;
  }

  if (!status.connected) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">ArtFollow</h1>
        <p className="max-w-xs text-sm text-white/60">
          Xアカウントを連携すると、フォロワーの中から条件に合うアカウントをAIで検索できます。
        </p>
        {message && <p className="text-sm text-red-400">{message}</p>}
        <a
          href="/api/auth/x/login"
          className="rounded-lg bg-brand-600 px-6 py-3 font-medium hover:bg-brand-700"
        >
          Xアカウントを連携する
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-32 pt-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">ArtFollow</h1>
          <p className="text-xs text-white/50">@{status.username} として連携中</p>
        </div>
        <button
          onClick={async () => {
            await fetch("/api/auth/app-logout", { method: "POST" });
            window.location.href = "/login";
          }}
          className="text-xs text-white/40 underline"
        >
          ログアウト
        </button>
      </header>

      <section className="mb-4 grid grid-cols-3 gap-2">
        <StatCard label="フォロワー総数" value={status.totalFollowers} />
        <StatCard label="未フォローバック" value={status.notFollowingBack} />
        <StatCard label="フォロー済み" value={status.followedBack} />
        <StatCard label="分類済み(この検索)" value={status.classified} />
        <StatCard label="分類待ち(この検索)" value={status.pendingClassification} />
        <StatCard label="該当候補(この検索)" value={status.matchCount} />
      </section>

      <button
        onClick={runFollowerScan}
        disabled={!!busy}
        className="mb-4 w-full rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
      >
        {status.followersScanHasMore ? "フォロワーを取得(続き)" : "フォロワーを再取得"}
      </button>

      <section className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3">
        <label className="mb-1 block text-xs text-white/50">どんな人を探したいか(自由入力)</label>
        <textarea
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          rows={2}
          className="mb-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-brand-500"
          placeholder="例: 猫の写真をよく投稿している人"
        />
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESET_QUERIES.map((q) => (
            <button
              key={q}
              onClick={() => setQueryInput(q)}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/10"
            >
              {q}
            </button>
          ))}
        </div>
        <button
          onClick={runSearch}
          disabled={!!busy}
          className="w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          この条件でAI検索する
        </button>
      </section>

      {busy && (
        <div className="mb-4 rounded-lg bg-brand-500/20 px-4 py-2 text-sm text-brand-100">{busy}</div>
      )}
      {message && (
        <div className="mb-4 rounded-lg bg-white/10 px-4 py-2 text-sm text-white/80">{message}</div>
      )}

      {activeQuery && (
        <>
          <section className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <button
              onClick={() => setShowFilters((v) => !v)}
              className="rounded-full border border-white/15 px-3 py-1.5 text-white/70 hover:bg-white/10"
            >
              絞り込み {showFilters ? "▲" : "▼"}
            </button>
            <div className="ml-auto flex gap-1">
              <button
                onClick={() => setViewMode("tile")}
                className={`rounded-full px-3 py-1.5 ${viewMode === "tile" ? "bg-brand-600" : "border border-white/15 text-white/60"}`}
              >
                タイル表示
              </button>
              <button
                onClick={() => setViewMode("detail")}
                className={`rounded-full px-3 py-1.5 ${viewMode === "detail" ? "bg-brand-600" : "border border-white/15 text-white/60"}`}
              >
                詳細表示
              </button>
            </div>
          </section>

          {showFilters && (
            <section className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-white/50">フォロー状況</label>
                <select
                  value={isFollowing}
                  onChange={(e) => setIsFollowing(e.target.value as IsFollowingFilter)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2"
                >
                  <option value="any">すべて</option>
                  <option value="not_following">未フォローのみ</option>
                  <option value="following">フォロー中のみ</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/50">フォロワー数(最小)</label>
                <input
                  type="number"
                  value={minFollowers}
                  onChange={(e) => setMinFollowers(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/50">フォロワー数(最大)</label>
                <input
                  type="number"
                  value={maxFollowers}
                  onChange={(e) => setMaxFollowers(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2"
                />
              </div>

              <div className="col-span-2">
                <label className="mb-1 block text-xs text-white/50">
                  知り合いのフォロワー数(最小) ※未計測の候補は対象外になります
                </label>
                <input
                  type="number"
                  value={minMutual}
                  onChange={(e) => setMinMutual(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/50">並び替え</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2"
                >
                  <option value="confidence">確信度</option>
                  <option value="followers_count">フォロワー数</option>
                  <option value="mutual_follow_count">知り合いの数</option>
                  <option value="tweet_count">投稿数</option>
                  <option value="fetched_at">取得日時</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/50">順序</label>
                <select
                  value={sortDir}
                  onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2"
                >
                  <option value="desc">降順</option>
                  <option value="asc">昇順</option>
                </select>
              </div>

              <div className="col-span-2 flex gap-4 pt-1 text-xs text-white/60">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={showConfidence} onChange={(e) => setShowConfidence(e.target.checked)} />
                  信頼度を表示
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={showReason} onChange={(e) => setShowReason(e.target.checked)} />
                  AIコメントを表示
                </label>
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white/70">検索結果({candidates.length}件表示中)</h2>
              <div className="flex gap-3 text-xs text-white/50">
                <button onClick={selectAll} className="underline">
                  全選択
                </button>
                <button onClick={clearSelection} className="underline">
                  解除
                </button>
              </div>
            </div>

            {candidates.length === 0 && (
              <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/50">
                該当する候補がありません。検索条件やフィルタを見直すか、フォロワーを追加取得してみてください。
              </p>
            )}

            {viewMode === "tile" ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {candidates.map((c) => (
                  <li
                    key={c.id}
                    onClick={() => toggleSelect(c.id)}
                    className={`relative flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-2 text-center ${
                      selected.has(c.id) ? "border-brand-500 bg-brand-500/10" : "border-white/10 bg-white/5"
                    }`}
                  >
                    {c.profile_image_url ? (
                      <Image
                        src={c.profile_image_url}
                        alt=""
                        width={56}
                        height={56}
                        className="h-14 w-14 rounded-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="h-14 w-14 rounded-full bg-white/10" />
                    )}
                    <span className="w-full truncate text-[11px] font-medium">{c.name}</span>
                    <span className="w-full truncate text-[10px] text-white/40">@{c.username}</span>
                    {showConfidence && (
                      <span className="rounded-full bg-brand-500/30 px-1.5 py-0.5 text-[9px] text-brand-100">
                        {Math.round(c.confidence * 100)}%
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="flex flex-col gap-3">
                {candidates.map((c) => (
                  <li
                    key={c.id}
                    className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
                    onClick={() => toggleSelect(c.id)}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 h-5 w-5 shrink-0"
                    />
                    {c.profile_image_url ? (
                      <Image
                        src={c.profile_image_url}
                        alt=""
                        width={48}
                        height={48}
                        className="h-12 w-12 shrink-0 rounded-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="h-12 w-12 shrink-0 rounded-full bg-white/10" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{c.name}</span>
                        {c.is_following === 1 && (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/50">
                            フォロー中
                          </span>
                        )}
                        {showConfidence && (
                          <span className="shrink-0 rounded-full bg-brand-500/30 px-2 py-0.5 text-[10px] text-brand-100">
                            確信度 {Math.round(c.confidence * 100)}%
                          </span>
                        )}
                      </div>
                      <a
                        href={`https://x.com/${c.username}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-brand-300"
                      >
                        @{c.username}
                      </a>
                      <p className="mt-1 line-clamp-2 text-xs text-white/60">{c.description}</p>
                      {showReason && <p className="mt-1 text-[11px] text-white/40">{c.reason}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/30">
                        <span>フォロワー {c.followers_count.toLocaleString()}人</span>
                        {c.tweets_checked_count != null && (
                          <span>
                            直近{c.tweets_checked_count}投稿中 {c.tweets_media_count}件に画像/動画あり
                          </span>
                        )}
                        {c.mutual_follow_count != null ? (
                          <span>知り合い {c.mutual_follow_count}人</span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              checkMutual(c.id);
                            }}
                            disabled={mutualLoading.has(c.id)}
                            className="rounded-full border border-white/15 px-2 py-0.5 text-brand-300 disabled:opacity-50"
                          >
                            {mutualLoading.has(c.id) ? "計測中..." : "知り合いを調べる"}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#0f0f14]/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-3xl gap-2">
            <button
              onClick={checkMutualSelected}
              disabled={!!busy}
              className="flex-1 rounded-lg border border-white/15 px-4 py-3 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
            >
              選択{selected.size}件の知り合いを調べる
            </button>
            <button
              onClick={followSelected}
              disabled={!!busy}
              className="flex-1 rounded-lg bg-brand-600 px-4 py-3 text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              選択{selected.size}件をフォローバック
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
