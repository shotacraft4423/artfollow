// OpenAI に投げる前段のキーワードフィルタ。
// bioに絵描き関連のキーワードが一切ない場合、CLASSIFY_ONLY_HEURISTIC_MATCHES=true なら
// OpenAI APIを呼ばずに「対象外」と即判定してコストを抑える。
const ART_KEYWORDS = [
  // 日本語
  "イラスト",
  "絵師",
  "お絵描き",
  "お絵かき",
  "落書き",
  "創作",
  "漫画家",
  "同人",
  "pixiv",
  "ファンアート",
  "fanart",
  "版権",
  "オリジナル",
  "模写",
  "デジタル絵",
  "アナログ絵",
  "水彩",
  "油絵",
  "線画",
  "彩色",
  "依頼",
  "コミッション",
  "commission",
  "commissions",
  "絵描き",
  "描いてます",
  "描いています",
  // 英語
  "illustration",
  "illustrator",
  "artist",
  "art account",
  "drawing",
  "sketch",
  "sketchbook",
  "digital art",
  "digital painting",
  "concept art",
  "character design",
  "oc ",
  " oc",
  "manga artist",
  "doodle",
  "painter",
  "painting"
];

export function heuristicMatch(description: string | null | undefined, name: string | null | undefined): boolean {
  const text = `${description ?? ""} ${name ?? ""}`.toLowerCase();
  if (!text.trim()) return false;
  return ART_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}
