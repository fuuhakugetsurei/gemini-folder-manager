import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 找到這個 metadata 物件
export const metadata: Metadata = {
  title: "Gemini 工作區管理助手",
  description: "基於 Next.js 與 Supabase 打造的雲端對話與資料夾管理平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html 
      lang="en" 
      suppressHydrationWarning // 加上這行，叫 React 忽略瀏覽器外掛造成的屬性不一致
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* 🧮 完美渲染 LaTeX 數學算式必須引入的 KaTeX 樣式表 */}
        <link 
          rel="stylesheet" 
          href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" 
        />
      </head>
      <body className="h-full bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}