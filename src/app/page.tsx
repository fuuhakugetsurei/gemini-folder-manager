'use client';

import ReactMarkdown from 'react-markdown';
import { useState, useEffect, useRef } from 'react';
import { supabase, Folder, Conversation } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // 核心資料狀態
  const [folders, setFolders] = useState<Folder[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [currentChat, setCurrentChat] = useState<Conversation | null>(null);

  // 輸入與控制狀態
  const [newFolderName, setNewFolderName] = useState('');
  const [inputMessage, setInputMessage] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  // 🤖 Gemini 三系列模型切換狀態
  const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash');

  // 🔐 邀請密鑰專用防禦狀態
  const [isVerified, setIsVerified] = useState<boolean | null>(null); 
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [verifying, setVerifying] = useState(false);

  // 🖼️ 圖片主動轉 Base64 暫存狀態
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. 初始化與狀態監聽
  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
      if (user) {
        fetchFolders();
        fetchConversations();
        checkUserVerification(user.id);
      }
    };
    checkUser();

    // 讀取本地快取的 Gemini API Key
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) setApiKey(savedKey);

    // 讀取本地快取的模型設定
    const savedModel = localStorage.getItem('gemini_selected_model');
    if (savedModel) setSelectedModel(savedModel);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        fetchFolders();
        fetchConversations();
        checkUserVerification(currentUser.id);
      } else {
        setIsVerified(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // 自動捲動到對話最底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChat?.messages]);

  // 儲存 API Key 到本地
  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  // 儲存模型設定到本地
  const saveSelectedModel = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem('gemini_selected_model', model);
  };

  // 🔐 檢查當前登入使用者是否已經成功綁定密鑰
  const checkUserVerification = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('invite_codes')
        .select('code')
        .eq('assigned_to_user_id', userId);

      if (data && data.length > 0) {
        setIsVerified(true); // 已通過，放行
      } else {
        setIsVerified(false); // 未通過，攔截
      }
    } catch (err) {
      setIsVerified(false);
    }
  };

  // 🔐 提交驗證密鑰邏輯
  const handleVerifyInviteCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCodeInput.trim() || !user || verifying) return;
    setVerifying(true);

    try {
      // 1. 查詢該密鑰是否存在且尚未被佔用
      const { data: codeData, error: fetchError } = await supabase
        .from('invite_codes')
        .select('*')
        .eq('code', inviteCodeInput.trim())
        .eq('is_used', false)
        .single();

      if (fetchError || !codeData) {
        alert('無效的存取密鑰，或者該密鑰已被其他人佔用了！');
        setVerifying(false);
        return;
      }

      // 2. 將此密鑰標記為已使用，並一對一綁定當前使用者的 UID
      const { error: updateError } = await supabase
        .from('invite_codes')
        .update({ 
          is_used: true, 
          assigned_to_user_id: user.id 
        })
        .eq('code', inviteCodeInput.trim());

      if (updateError) throw updateError;

      alert('驗證成功！歡迎加入私有工作區。');
      setIsVerified(true);
    } catch (err: any) {
      alert(`密鑰鎖定失敗: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  };

  // 🖼️ 處理圖片主動轉成 Base64
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 🛡️ 限制 1MB，防止過大的 Base64 檔案塞爆純文字資料庫容量
    if (file.size > 1 * 1024 * 1024) {
      alert('圖片大小超過 1MB 限制！為了幫您的雲端資料庫省空間，請選擇較小的圖片。');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setAttachedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // 2. 資料庫撈取邏輯
  const fetchFolders = async () => {
    const { data } = await supabase.from('folders').select('*').order('created_at', { ascending: true });
    setFolders(data || []);
  };

  const fetchConversations = async () => {
    const { data } = await supabase.from('conversations').select('*').order('updated_at', { ascending: false });
    setConversations(data || []);
  };

  // 3. 資料夾與對話操作
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || !user) return;
    const { data } = await supabase.from('folders').insert([{ name: newFolderName.trim(), user_id: user.id }]).select();
    if (data) setFolders([...folders, data[0]]);
    setNewFolderName('');
  };

  const handleCreateChat = async () => {
    if (!user || !selectedFolderId) return alert('請先選擇一個資料夾！');
    
    const { data, error } = await supabase
      .from('conversations')
      .insert([{
        user_id: user.id,
        folder_id: selectedFolderId,
        title: '新對話',
        messages: []
      }])
      .select();

    if (data) {
      setConversations([data[0], ...conversations]);
      setCurrentChat(data[0]);
    }
  };

  // 🗑️ 刪除資料夾邏輯
  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 防止觸發點擊資料夾的切換事件
    if (!confirm('確定要刪除此資料夾嗎？裡面的所有對話也會一併消失喔！')) return;

    const { error } = await supabase.from('folders').delete().eq('id', folderId);
    if (!error) {
      setFolders(folders.filter(f => f.id !== folderId));
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
        setCurrentChat(null);
      }
      setConversations(conversations.filter(c => c.folder_id !== folderId));
    } else {
      alert(`刪除資料夾失敗: ${error.message}`);
    }
  };

  // 🗑️ 刪除單一對話邏輯
  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 防止觸發切換到該對話的事件
    if (!confirm('確定要刪除這場對話紀錄嗎？')) return;

    const { error = null } = await supabase.from('conversations').delete().eq('id', chatId);
    if (!error) {
      setConversations(conversations.filter(c => c.id !== chatId));
      if (currentChat?.id === chatId) {
        setCurrentChat(null);
      }
    } else {
      alert(`刪除對話失敗: ${error.message}`);
    }
  };

  // 4. 核心：呼叫 Gemini API 並且雲端同步存檔
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputMessage.trim() && !attachedImage) || !currentChat || !apiKey || isSending) return;

    // 1. 如果有附帶圖片，我們把 Base64 用隱藏標記跟文字黏在一起，這樣 Supabase 就能整串文字存下來
    let finalContent = inputMessage.trim();
    if (attachedImage) {
      finalContent = `${inputMessage.trim()}\n\n[IMAGE_DATA:${attachedImage}]`;
    }

    const userMessage = { role: 'user', content: finalContent };
    const updatedMessages = [...currentChat.messages, userMessage];
    
    // 先在前端即時更新顯示使用者的話
    setCurrentChat({ ...currentChat, messages: updatedMessages });
    const originalInput = inputMessage.trim();
    setInputMessage('');
    setAttachedImage(null); // 立即清空選取的圖片暫存
    setIsSending(true);

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      // 2. 解析歷史紀錄，並把隱藏的 [IMAGE_DATA:...] 還原成 Gemini SDK 的多模態 Parts 物件
      const contents = updatedMessages.map(msg => {
        if (msg.role === 'model') {
          return { role: 'model', parts: [{ text: msg.content }] };
        }

        const text = msg.content;
        const imageRegex = /\[IMAGE_DATA:(data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+))\]/;
        const match = text.match(imageRegex);

        const parts: any[] = [];
        
        if (match) {
          const cleanText = text.replace(imageRegex, '').trim();
          if (cleanText) parts.push({ text: cleanText });
          
          const rawBase64 = match[2];
          const mimeType = match[1].match(/[^:]\w+\/[\w-+\.]+(?=;|,)/)?.[0] || "image/jpeg";
          
          parts.push({
            inlineData: {
              data: rawBase64,
              mimeType: mimeType
            }
          });
        } else {
          parts.push({ text: text });
        }

        return { role: 'user', parts: parts };
      });

      // 動態調用使用者在左側選取的 Gemini 三系列核心模型
      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: contents,
      });

      const modelResponseText = response.text || '（未能取得回應）';
      const finalMessages = [...updatedMessages, { role: 'model', content: modelResponseText }];

      // 自動將更新後的完整對話歷史同步回 Supabase 雲端
      const { data, error } = await supabase
        .from('conversations')
        .update({ 
          messages: finalMessages,
          title: currentChat.title === '新對話' ? (originalInput || '圖片對話') : currentChat.title,
          updated_at: new Date().toISOString()
        })
        .eq('id', currentChat.id)
        .select();

      if (data) {
        setCurrentChat(data[0]);
        setConversations(conversations.map(c => c.id === currentChat.id ? data[0] : c));
      }
    } catch (err: any) {
      alert(`Gemini API 錯誤: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-slate-900 text-white"><p className="text-lg animate-pulse">載入中...</p></div>;

  // 第一關：未登入者，強制攔截顯示登入
  if (!user) {
    return (
      <main className="flex h-screen flex-col items-center justify-center bg-slate-900 text-white p-4">
        <div className="w-full max-w-md rounded-2xl bg-slate-800 p-8 text-center shadow-xl border border-slate-700">
          <h1 className="mb-2 text-2xl font-bold tracking-tight">Gemini 對話管理助手</h1>
          <p className="mb-8 text-sm text-slate-400">登入後即可開始將對話分類並同步至雲端</p>
          <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })} className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 font-semibold text-slate-900 transition-all hover:bg-slate-100">
            使用 Google 帳號登入
          </button>
        </div>
      </main>
    );
  }

  // 第二關：登入了但沒有密鑰資質，顯示密鑰鎖定彈窗
  if (isVerified === false) {
    return (
      <main className="flex h-screen flex-col items-center justify-center bg-slate-950 text-white p-4">
        <div className="w-full max-w-md rounded-2xl bg-slate-900 p-8 shadow-xl border border-slate-800">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🔐</span>
            <h2 className="text-xl font-bold text-slate-100">請輸入邀請密鑰</h2>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed mb-6">
            本工作區目前處於不公開內測階段，為保障系統資源，您必須輸入由開發者分發的專屬密鑰才可解鎖核心面板。
          </p>
          <form onSubmit={handleVerifyInviteCode} className="space-y-4">
            <input 
              type="text" 
              placeholder="請貼上您的專屬密鑰..." 
              value={inviteCodeInput} 
              onChange={(e) => setInviteCodeInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
            <div className="flex gap-2">
              <button 
                type="submit" 
                disabled={verifying || !inviteCodeInput.trim()}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors disabled:opacity-40"
              >
                {verifying ? '安全校驗中...' : '確認驗證並綁定'}
              </button>
              <button 
                type="button" 
                onClick={() => supabase.auth.signOut()}
                className="bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs px-3 rounded-lg transition-colors border border-slate-700"
              >
                登出
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  // 第三關：通過驗證 (isVerified === true)，渲染完整對話工作區 UI
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* 側邊欄 Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between flex-shrink-0">
        <div className="p-4 overflow-y-auto flex-1">
          <h2 className="text-xl font-bold mb-4 text-indigo-400 tracking-wide">對話工作區</h2>
          
          {/* 🤖 三系列核心模型切換設定區 */}
          <div className="mb-4 bg-slate-800/50 p-2 rounded border border-slate-700/60 space-y-1.5">
            <div>
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">AI 三系列核心</label>
              <select 
                value={selectedModel} 
                onChange={(e) => saveSelectedModel(e.target.value)}
                className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="gemini-3.5-flash">Gemini 3.5 Flash (全能·速度快)</option>
                <option value="gemini-3.1-pro">Gemini 3.1 Pro (深度·寫程式)</option>
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (預覽版)</option>
              </select>
            </div>
            <div className="text-[10px] text-slate-500 leading-tight px-1">
              {selectedModel === 'gemini-3.5-flash' && "⚡ 提示：Flash 模型限每分鐘 15 次，日常聊天首選。"}
              {selectedModel === 'gemini-3.1-pro' && "⚠️ 提示：Pro 模型每分鐘限 5 次，深度推理專用。"}
              {selectedModel === 'gemini-3.1-pro-preview' && "🧪 提示：預覽版功能最新，高負載時可能稍有延遲。"}
            </div>
          </div>

          {/* API Key 設定區 */}
          <div className="mb-4 bg-slate-800/50 p-2 rounded border border-slate-700/60">
            <label className="text-[11px] font-semibold text-slate-400 uppercase">Gemini API Key</label>
            <input type="password" placeholder="貼上 AI Studio 金鑰..." value={apiKey} onChange={(e) => saveApiKey(e.target.value)} className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500" />
          </div>

          {/* 新增資料夾 */}
          <form onSubmit={handleCreateFolder} className="mb-4 flex gap-1">
            <input type="text" placeholder="新建資料夾..." value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none" />
            <button type="submit" disabled={!newFolderName.trim()} className="bg-indigo-600 px-2 py-1 rounded text-xs">+</button>
          </form>

          {/* 資料夾清單 */}
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">我的資料夾</p>
              <div className="space-y-1">
                {folders.map(f => (
                  <div key={f.id} className="group flex items-center justify-between rounded text-xs font-medium transition-colors border border-transparent">
                    <button onClick={() => { setSelectedFolderId(f.id); setCurrentChat(null); }} className={`flex flex-1 items-center gap-2 px-2 py-1.5 rounded-l text-left transition-colors ${selectedFolderId === f.id ? 'bg-indigo-600/30 text-indigo-300 border-l border-y border-indigo-500/30' : 'text-slate-400 hover:bg-slate-800'}`}>
                      <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                      <span className="truncate max-w-[130px]">{f.name}</span>
                    </button>
                    {/* 🗑️ 資料夾刪除按鈕 */}
                    <button onClick={(e) => handleDeleteFolder(f.id, e)} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-2 py-1.5 rounded-r bg-transparent hover:bg-slate-800 transition-all" title="刪除資料夾">
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 目前選中資料夾內的對話列表 */}
            {selectedFolderId && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">對話歷史</p>
                  <button onClick={handleCreateChat} className="text-[10px] text-indigo-400 hover:underline">+ 新對話</button>
                </div>
                <div className="space-y-1">
                  {conversations.filter(c => c.folder_id === selectedFolderId).map(c => (
                    <div key={c.id} className="group flex items-center justify-between rounded text-xs transition-colors border border-transparent">
                      <button onClick={() => setCurrentChat(c)} className={`flex flex-1 items-center gap-2 px-2 py-1.5 rounded-l text-left transition-colors ${currentChat?.id === c.id ? 'bg-slate-800 text-white font-medium border-l border-y border-slate-700' : 'text-slate-400 hover:bg-slate-800/60'}`}>
                        <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                        <span className="truncate flex-1 max-w-[130px]">
                          {c.title.includes('[IMAGE_DATA:') ? c.title.split('[IMAGE_DATA:')[0].trim() || '圖片對話' : c.title}
                        </span>
                      </button>
                      {/* 🗑️ 對話單一刪除按鈕 */}
                      <button onClick={(e) => handleDeleteChat(c.id, e)} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-2 py-1.5 rounded-r bg-transparent hover:bg-slate-800 transition-all" title="刪除對話">
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 帳號底欄 */}
        <div className="p-3 bg-slate-900/80 border-t border-slate-800 flex items-center justify-between">
          <span className="text-[11px] text-emerald-400 truncate max-w-[120px]">{user.email}</span>
          <button onClick={() => supabase.auth.signOut()} className="text-[10px] text-rose-400 hover:bg-rose-950/30 px-1.5 py-0.5 rounded border border-rose-950">登出</button>
        </div>
      </aside>

      {/* 右側 主對話區域 */}
      <main className="flex-1 flex flex-col bg-slate-950 h-full overflow-hidden">
        {currentChat ? (
          <>
            {/* 對話頂欄 */}
            <header className="p-4 border-b border-slate-900 bg-slate-900/30 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-slate-200">
                {currentChat.title.includes('[IMAGE_DATA:') ? currentChat.title.split('[IMAGE_DATA:')[0].trim() || '圖片對話' : currentChat.title}
              </h3>
              <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">雲端同步中</span>
            </header>

            {/* 💡 包含訊息區與右側時間軸的複合彈性格局 */}
            <div className="flex-1 flex flex-row overflow-hidden h-full">
              
              {/* 💬 核心訊息渲染區 */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {currentChat.messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">這是一場全新的對話，選取圖片或輸入訊息開始聊吧。</div>
                ) : (
                  currentChat.messages.map((msg, i) => {
                    const imageRegex = /\[IMAGE_DATA:(data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+)\]/;
                    const match = msg.content.match(imageRegex);
                    const cleanText = msg.content.replace(imageRegex, '').trim();

                    return (
                      <div key={i} id={`message-node-${i}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] rounded-xl px-3.5 py-2 text-sm leading-relaxed space-y-2 ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-900 text-slate-200 rounded-bl-none border border-slate-800'}`}>
                          
                          {/* 歷史紀錄解包圖片縮圖 */}
                          {match && (
                            <div className="mb-2 max-w-xs overflow-hidden rounded border border-slate-700/50 bg-slate-950/40 p-1">
                              <img src={match[1]} alt="對話夾帶圖片" className="max-h-48 w-auto object-contain rounded" />
                            </div>
                          )}

                          {msg.role === 'user' ? (
                            cleanText && <p className="whitespace-pre-wrap">{cleanText}</p>
                          ) : (
                            cleanText && (
                              <div className="prose prose-invert max-w-none text-slate-200 text-sm leading-relaxed space-y-2
                                prose-headings:font-bold prose-headings:text-slate-100 prose-h1:text-base prose-h2:text-sm prose-h3:text-xs
                                prose-p:leading-relaxed
                                prose-code:bg-slate-950 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-amber-400 prose-code:text-xs
                                prose-pre:bg-slate-950 prose-pre:p-3 prose-pre:rounded-lg prose-pre:border prose-pre:border-slate-800 prose-pre:overflow-x-auto
                                prose-ul:list-disc prose-ul:pl-4 prose-ol:list-decimal prose-ol:pl-4
                                prose-strong:text-white font-normal">
                                <ReactMarkdown>{cleanText}</ReactMarkdown>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                {isSending && (
                  <div className="flex justify-start">
                    <div className="bg-slate-900 text-slate-400 border border-slate-800 rounded-xl rounded-bl-none px-3.5 py-2 text-sm animate-pulse">Gemini 思考中...</div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* ⏱️ 全新右側雙色跳躍時間軸導覽列 */}
              <aside className="w-14 bg-slate-900/30 border-l border-slate-900/60 flex flex-col items-center py-4 overflow-y-auto space-y-2.5 flex-shrink-0 scrollbar-none">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">⏱️ 軸</p>
                {currentChat.messages.map((msg, i) => {
                  const previewText = msg.content.replace(/\[IMAGE_DATA:.*\]/g, '').slice(0, 15) || (msg.role === 'user' ? '圖片' : '智慧回應');
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        const element = document.getElementById(`message-node-${i}`);
                        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                      title={`[${msg.role === 'user' ? '您' : 'AI'}] ${previewText}...`}
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold transition-all border
                        ${msg.role === 'user' 
                          ? 'bg-indigo-600/15 text-indigo-400 border-indigo-500/20 hover:bg-indigo-600 hover:text-white' 
                          : 'bg-emerald-600/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-600 hover:text-white'
                        }`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </aside>

            </div>

            {/* 訊息輸入欄 */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-900 bg-slate-950">
              <div className="max-w-3xl mx-auto space-y-2">
                
                {/* 圖片預覽小卡片 */}
                {attachedImage && (
                  <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-800 w-fit animate-fade-in">
                    <img src={attachedImage} alt="預覽" className="w-10 h-10 object-cover rounded border border-slate-700" />
                    <span className="text-[11px] text-slate-400">圖片已壓縮為 Base64 (限 1MB 內)</span>
                    <button type="button" onClick={() => setAttachedImage(null)} className="text-xs text-rose-400 hover:underline ml-2">取消</button>
                  </div>
                )}

                <div className="flex gap-2 items-center">
                  {/* 📎 隱藏式圖片檔案選取鈕 */}
                  <label className="cursor-pointer bg-slate-900 hover:bg-slate-800 border border-slate-800 p-2 rounded-lg flex items-center justify-center transition-colors flex-shrink-0" title="夾帶圖片 (限 1MB，主動轉 Base64)">
                    <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" disabled={!apiKey || isSending} />
                  </label>

                  <input type="text" placeholder={apiKey ? "輸入訊息或夾帶圖片..." : "請先在左側填入 Gemini API Key 才能開始對話！"} value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} disabled={!apiKey || isSending} className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-40" />
                  <button type="submit" disabled={(!inputMessage.trim() && !attachedImage) || isSending || !apiKey} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-40 flex-shrink-0">發送</button>
                </div>
              </div>
            </form>
          </>
        ) : (
          // 尚未選擇對話的空白狀態
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            </div>
            <h3 className="text-sm font-medium text-slate-400">請從左側點選資料夾並「+ 新對話」</h3>
            <p className="text-xs text-slate-600 mt-1">所有在此建立的對話與夾帶的圖片，都會完美加密保存於雲端。</p>
          </div>
        )}
      </main>
    </div>
  );
}