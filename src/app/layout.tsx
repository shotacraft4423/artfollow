import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArtFollow",
  description: "Xのフォロワーから絵描きアカウントをAIで判定し、確認のうえフォローバックするツール"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-[#0f0f14] text-[#f2f2f5]">{children}</body>
    </html>
  );
}
