# 📂 Gemini & Multi-Model Folder Manager (多模型對話工作區雲端管理助手)
---
## 繁體中文

這是一個基於 **Next.js 15 (App Router)**、**Supabase** 打造的強大全端 AI 對話工作區。它徹底解決了官方 Web App 缺乏「資料夾分類」的痛點，並整合了 **多模型提供商 (Multi-Provider)**、**前端即時圖片壓縮**、**503 自動降級備援** 以及 **Bring Your Own Database (自訂私有雲端)** 等進階功能。


### 💬 邀請密鑰與社群支援 (Discord Support)

本工作區目前設有 **邀請密鑰（Invite Code）存取控制機制**。若您在登入 Google 帳號後遇到密鑰鎖定，請加入我們的 Discord 官方社群並前往開單區詢問：

* 💬 **Discord 社群連結**：[點此加入 Discord 群組並開單索取密鑰](你的_DISCORD_邀請連結)
* 📩 **索取方式**：進入群組後，請至 `#開單專區` (or Ticket 頻道) 建立工單，管理員將會盡快分發您的專屬驗證密鑰。

---

### 🎮 使用者快速上手

1. 進入網站後，點擊 **「使用 Google 帳號登入」**。
2. **輸入邀請密鑰**：跳出驗證鎖定時，貼上從 Discord 群組開單取得的專屬密鑰進行綁定。
3. 點擊右上角 **⚙️ 圖標** 開啟「擴充功能與核心設定艙」：
   * 選擇您喜好的模型提供商（Gemini / GitHub / Groq）並填入專屬 API Key 或 PAT。
   * (可選) 在 **Supabase 資料庫模式** 中切換為自訂個人雲端庫。
4. 在左側欄建立資料夾，點擊 **「+ 新對話」** 即可開始流暢對話！
### ✨ 核心亮點與功能特色

#### 1. 🗄️ 靈活的資料夾與對話管理
* **資料夾分類與重命名**：自由建立、刪除或原地重命名資料夾。
* **雙平台對話移動**：
  * **桌面端**：支援原生 HTML5 **Drag & Drop 拖曳**，將對話直接拖入目標資料夾。
  * **行動端**：提供三點選單 (`⋮`) 與獨立轉移視窗，支援觸控極速歸類。


* **對話二次編輯與分支**：
* **提問編輯**：可隨時修改過往發送的問題，系統將自動裁切後續對話並重新生成解答。
* **無條件重新生成**：對 AI 回應不滿意？點擊 `🔄 重新生成` 即可無縫重新呼叫 API。



#### 2. 🤖 多模型提供商支援 (Multi-Provider) & 高峰期 503 防禦

* **三強鼎立架構**：
  * **Google Gemini API**（預設核心）：支援 `gemini-3.5-flash` 與 `gemini-3.5-pro`。
  * **GitHub Models**：免費支援 OpenAI 次世代核心 `gpt-4.1-mini` (Coding 小鋼砲)、`gpt-4.1`、`gpt-4o` 與 `Llama 3.3 70B`。
  * **Groq Cloud**：搭載 LPU 極速推理引擎，支援 `llama-3.3-70b-versatile` 與 `llama-3.1-8b-instant`。


* **503 自動退避與全自動 Failover 備援**：
* 遇到 Gemini API 503/429 塞車時，自動啟動指數退避重試
* 若重試失敗且使用者配置了 GitHub 或 Groq 金鑰，系統將**全自動無縫降級切換至備援模型**，確保對話不中斷。



#### 3. 🚀 附件雙流分流與 HTML5 Canvas 自動壓圖

* **圖片流（自動壓縮）**：上傳圖片前，瀏覽器會在前端全自動以 Canvas 縮放至最大 1920px 並轉為高畫質 75% JPEG，體積暴降 80%~90%，直推 Supabase Storage CDN 僅需 0.5 秒。
* **代碼/文字檔（零空間消耗）**：`.py`, `.cpp`, `.txt` 等程式碼與文字檔走本地異步讀取，轉為 Markdown 代碼區塊內聯，完全不佔用雲端儲存空間。

#### 4. 🔒 隱私安全與 Bring Your Own Database (BYODB)

* **自訂個人雲端庫**：使用者可自由選擇使用預設共享庫，或是切換為 **「自訂 Supabase 雲端」**（填入個人 `Supabase URL` 與 `Anon Key`），實現資料完全私有化。
* **列級安全原則 (RLS)**：每位使用者的歷史紀錄與圖片皆透過 Supabase RLS 加密隔離。

#### 5. 💻 現代化 Code 渲染與複製體驗

* **獨立代碼區塊複製**：滑鼠移至任意代碼區塊，右上角即時浮現 `📋 複製程式碼` 按鈕。
* **全局 Markdown 回應複製**：每條 AI 訊息下方皆附有 `📋 複製全部回應` 按鈕。
* **LaTeX 數學算式**：完整注入 KaTeX 渲染，支援行內 `$ ... $` 與區塊 `$$ ... $$` 標準數學算式。

---

### 🎮 使用者快速上手

1. 進入網站後，點擊 **「使用 Google 帳號登入」**（如系統設有邀請密鑰，請輸入專屬密鑰解鎖）。
2. 點擊右上角 **⚙️ 圖標** 開啟「擴充功能與核心設定艙」：
* 選擇您喜好的模型提供商（Gemini / GitHub / Groq）並填入專屬 Key / PAT。
* (可選) 在 **Supabase 資料庫模式** 中切換為自訂個人雲端庫。


3. 在左側欄建立資料夾，點擊 **「+ 新對話」** 即可開始流暢體驗！

---

### 🚀 開發者部署指南

#### 1. 克隆專案與安裝依賴

```bash
git clone https://github.com/your-username/gemini-folder-manager.git
cd gemini-folder-manager
npm install

```

#### 2. 設定環境變數

在專案根目錄建立 `.env.local` 檔案：

```env
NEXT_PUBLIC_SUPABASE_URL=你的_SUPABASE_專案_網址
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的_SUPABASE_匿名_公鑰

```

#### 3. Supabase 資料庫與 Storage 初始化

請在您的 Supabase SQL Editor 執行以下建表指令：

```sql
CREATE TABLE folders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  folder_id UUID REFERENCES folders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  messages JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

```

並前往 **Storage** 手動建立名為 `images` 且開放 **Public** 權限的 Bucket，並設定 `INSERT` / `SELECT` RLS Policies。

#### 4. 啟動本地開發伺服器

```bash
npm run dev

```

打開瀏覽器訪問 `http://localhost:3000` 即可開始偵錯。

