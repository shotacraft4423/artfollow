// 検索クエリごとに動的生成されたキーワード群で、OpenAIに投げる前段のフィルタを行う。
// bio+nameにキーワードが1つもヒットしない場合、CLASSIFY_ONLY_HEURISTIC_MATCHES=true なら
// OpenAI APIを呼ばずに「対象外」と即判定してコストを抑える。
export function heuristicMatch(
  description: string | null | undefined,
  name: string | null | undefined,
  keywords: string[]
): boolean {
  const text = `${description ?? ""} ${name ?? ""}`.toLowerCase();
  if (!text.trim() || keywords.length === 0) return false;
  return keywords.some((kw) => kw.trim() && text.includes(kw.toLowerCase()));
}
