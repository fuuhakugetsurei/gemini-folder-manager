# 📂 Gemini Folder Manager (Gemini 對話工作區雲端管理助手)

[繁體中文](#繁體中文) | [English](#english)

---

## 繁體中文

這是一個基於 **Next.js 15 (App Router)**、**Supabase** 與 **Google Gemini API** 打造的現代化全端 AI 對話管理工具。它解決了官方網頁無法將對話進行「資料夾分類」的痛點，並透過雲端資料庫實現跨裝置（電腦、手機）的即時同步。

### ✨ 核心特色
* **資料夾分類管理**：自由建立資料夾，將不同的學術研究、程式除錯對話井然有序地歸類。
* **跨裝置雲端同步**：採用 Supabase 雲端資料庫，無論在電腦還是手機上登入，歷史紀錄完全同步。
* **個人隱私與防禦性設計**：
  * **自備金鑰 (Bring Your Own Key)**：使用者登入後需填入自己的 Google AI Studio API Key（儲存於本地 LocalStorage），安全不外洩。
  * **資料庫列級安全原則 (RLS)**：每位使用者的對話與資料夾皆受到加密隔離，即使數據存在同一個雲端，其他人也絕對無法窺探。

### 🎮 使用者使用方式
1. 打開部署完成的網站網址。
2. 點擊 **「使用 Google 帳號登入」**。
3. 在左側欄的 **Gemini API Key** 輸入框中，貼上您在 [Google AI Studio](https://aistudio.google.com/) 免費申請的 API 金鑰。
4. 在左側建立資料夾，並點擊 **「+ 新對話」**，即可在右側開始與 Gemini 進行流暢對話，所有對話標題與內容皆會全自動即時同步至雲端。

### 待實現
1. 匯入功能
2. 時間軸
3. 用戶引導:api金鑰便於匯入、大圖片上傳
4. 圖片上傳  
5. 適配手機版面
   
### 🚀 開發者部署指南

如果您想自己架設或進行二次開發，請遵循以下步驟：

#### 1. 克隆專案與安裝依賴
```bash
git clone [https://github.com/your-username/gemini-folder-manager.git](https://github.com/your-username/gemini-folder-manager.git)
cd gemini-folder-manager
npm install
```

#### 2. 設定環境變數

在專案根目錄建立 `.env.local` 檔案，並填入您的 Supabase 憑證：

```env
NEXT_PUBLIC_SUPABASE_URL=你的_SUPABASE_專案_網址
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的_SUPABASE_匿名_公鑰
```

#### 3. 本地開發偵錯

```bash
npm run dev
```

打開瀏覽器訪問 `http://localhost:3000` 即可開始開發。

---


## English

A modern, full-stack AI conversation management client built with **Next.js 15 (App Router)**, **Supabase**, and **Google Gemini API**. It solves the limitation of the official Gemini web interface by allowing users to organize chat histories into custom folders with real-time cloud synchronization across all devices.

### ✨ Key Features

* **Folder-Based Organization**: Create custom folders to categorize conversations for programming, research, or writing.
* **Cross-Device Sync**: Powered by Supabase cloud storage, making your data seamlessly accessible on both PC and mobile devices.
* **Privacy & Defensive Architecture**:
* **Bring Your Own Key (BYOK)**: Users provide their own Google AI Studio API Key (safely stored in LocalStorage).
* **Row-Level Security (RLS)**: Enforced database policies ensure each user's data is strictly isolated; no one else can access your folders or chats.



### 🎮 User Guide

1. Navigate to the deployed web URL.
2. Click **"Sign in with Google"**.
3. In the sidebar, paste your personal API Key generated from [Google AI Studio](https://aistudio.google.com/).
4. Create a folder in the sidebar, click **"+ New Chat"**, and enjoy talking with Gemini. Your history and chat titles will automatically sync to the cloud in real-time.

### 🚀 Developer Deployment Guide

Follow these steps to self-host or clone this repository for development:

#### 1. Clone the Repository & Install Dependencies

```bash
git clone [https://github.com/your-username/gemini-folder-manager.git](https://github.com/your-username/gemini-folder-manager.git)
cd gemini-folder-manager
npm install
```

#### 2. Setup Environment Variables

Create a `.env.local` file in the root directory and fill in your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

#### 3. Run Local Development Server

```bash
npm run dev
```

Open `http://localhost:3000` in your browser to view the application.



