"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

type Status = {
  connected: boolean;
  username: string | null;
  totalFollowers: number;
  notFollowingBack: number;
  classified: number;
  pendingClassification: number;
  artistCandidates: number;
  followedBack: number;
  followersScanHasMore: boolean;
};

type Candidate = {
  id: string;
  username: string;
  name: string;
  description: string;
  profile_image_url: string | null;
  followers_count: number;
  confidence: number;
  reason: string;
  tweets_checked_count: number | null;
  tweets_media_count: number | null;
};

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

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/status");
    if (res.ok) setStatus(await res.json());
  }, []);

  const loadCandidates = useCallback(async () => {
    const res = await fetch("/api/candidates?limit=100");
    if (res.ok) {
      const data = await res.json();
      setCandidates(data.rows);
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const xError = url.searchParams.get("x_error");
    if (xError) setMessage(`X連携エラー: ${xError}`);
    loadStatus();
    loadCandidates();
  }, [loadStatus, loadCandidates]);

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
        await loadStatus();
        if (!data.hasMore) break;
      }
    } finally {
      setBusy(null);
      await loadStatus();
    }
  }

  async function runClassify() {
    setBusy("AIでプロフィール・直近投稿を分析しています...");
    setMessage(null);
    try {
      for (let i = 0; i < 30; i++) {
        const res = await fetch("/api/scan/classify", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          setMessage(data.error ?? "分類処理でエラーが発生しました");
          break;
        }
        await loadStatus();
        if (data.rateLimited) {
          setMessage("Xのレート制限に達したため、続きは時間を置いて再実行してください");
          break;
        }
        if (data.remaining === 0) break;
      }
    } finally {
      setBusy(null);
      await loadStatus();
      await loadCandidates();
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
      await loadCandidates();
      await loadStatus();
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
          Xアカウントを連携すると、フォロワーの中から絵描きアカウントをAIで判定できます。
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
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-6">
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

      <section className="mb-6 grid grid-cols-3 gap-2">
        <StatCard label="フォロワー総数" value={status.totalFollowers} />
        <StatCard label="未フォローバック" value={status.notFollowingBack} />
        <StatCard label="分類待ち" value={status.pendingClassification} />
        <StatCard label="絵描き候補" value={status.artistCandidates} />
        <StatCard label="分類済み" value={status.classified} />
        <StatCard label="フォロー済み" value={status.followedBack} />
      </section>

      <section className="mb-6 flex flex-col gap-2">
        <button
          onClick={runFollowerScan}
          disabled={!!busy}
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
        >
          {status.followersScanHasMore ? "フォロワーを取得(続き)" : "フォロワーを再取得"}
        </button>
        <button
          onClick={runClassify}
          disabled={!!busy || status.pendingClassification === 0}
          className="rounded-lg bg-brand-600 px-4 py-3 text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          AIで絵描きアカウントを判定する({status.pendingClassification}件待ち)
        </button>
      </section>

      {busy && (
        <div className="mb-4 rounded-lg bg-brand-500/20 px-4 py-2 text-sm text-brand-100">{busy}</div>
      )}
      {message && (
        <div className="mb-4 rounded-lg bg-white/10 px-4 py-2 text-sm text-white/80">{message}</div>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/70">
            絵描き候補({candidates.length}件表示中)
          </h2>
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
            候補がありません。「フォロワーを取得」「AIで判定する」を実行してください。
          </p>
        )}

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
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="shrink-0 rounded-full bg-brand-500/30 px-2 py-0.5 text-[10px] text-brand-100">
                    確信度 {Math.round(c.confidence * 100)}%
                  </span>
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
                <p className="mt-1 text-[11px] text-white/40">{c.reason}</p>
                {c.tweets_checked_count != null && (
                  <p className="mt-1 text-[11px] text-white/30">
                    直近{c.tweets_checked_count}投稿中 {c.tweets_media_count}件に画像/動画あり
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#0f0f14]/95 p-4 backdrop-blur">
          <button
            onClick={followSelected}
            disabled={!!busy}
            className="mx-auto block w-full max-w-2xl rounded-lg bg-brand-600 px-4 py-3 font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            選択した{selected.size}件をフォローバックする
          </button>
        </div>
      )}
    </main>
  );
}
