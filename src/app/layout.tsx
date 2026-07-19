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
  title: "Gemini 工作區管理助手", // 👈 把原本的 "Create Next App" 狠狠改成這個！
  description: "基於 Next.js 與 Supabase 打造的雲端對話與資料夾管理平台", // 👈 這裡也可以順便改掉
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
    <body className="h-full">
      {children}
    </body>
  </html>
);
}
