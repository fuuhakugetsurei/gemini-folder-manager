'use client';

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
      }
    };
    checkUser();

    // 讀取本地快取的 Gemini API Key
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) setApiKey(savedKey);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        fetchFolders();
        fetchConversations();
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

  // 4. 核心：呼叫 Gemini API 並且雲端同步存檔
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !currentChat || !apiKey || isSending) return;

    const userMessage = { role: 'user', content: inputMessage.trim() };
    const updatedMessages = [...currentChat.messages, userMessage];
    
    // 先在前端即時更新顯示使用者的話
    setCurrentChat({ ...currentChat, messages: updatedMessages });
    setInputMessage('');
    setIsSending(true);

    try {
      // 初始化 Google Gen AI SDK
      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      // 轉換成 Gemini 要求的對話格式
      const contents = updatedMessages.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      // 呼叫最新的 gemini-2.5-flash 模型
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: contents,
      });

      const modelResponseText = response.text || '（未能取得回應）';
      const finalMessages = [...updatedMessages, { role: 'model', content: modelResponseText }];

      // 自動將更新後的完整對話歷史同步回 Supabase 雲端
      const { data, error } = await supabase
        .from('conversations')
        .update({ 
          messages: finalMessages,
          title: currentChat.title === '新對話' ? userMessage.content.slice(0, 15) : currentChat.title,
          updated_at: new Date().toISOString()
        })
        .eq('id', currentChat.id)
        .select();

      if (data) {
        setCurrentChat(data[0]);
        // 更新左側清單中的對話標題與排序
        setConversations(conversations.map(c => c.id === currentChat.id ? data[0] : c));
      }
    } catch (err: any) {
      alert(`Gemini API 錯誤: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-slate-900 text-white"><p className="text-lg animate-pulse">載入中...</p></div>;

  if (!user) {
    return (
      <main className="flex h-screen flex-col items-center justify-center bg-slate-900 text-white p-4">
        <div className="w-full max-w-md rounded-2xl bg-slate-800 p-8 text-center shadow-xl border border-slate-700">
          <h1 className="mb-2 text-2xl font-bold tracking-tight">Gemini 對話管理助手</h1>
          <p className="mb-8 text-sm text-slate-400">登入後即可開始將對話分類並同步至雲端</p>
          <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'http://localhost:3000' } })} className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 font-semibold text-slate-900 transition-all hover:bg-slate-100">
            使用 Google 帳號登入
          </button>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* 側邊欄 Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between flex-shrink-0">
        <div className="p-4 overflow-y-auto flex-1">
          <h2 className="text-xl font-bold mb-4 text-indigo-400 tracking-wide">對話工作區</h2>
          
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
                  <button key={f.id} onClick={() => { setSelectedFolderId(f.id); setCurrentChat(null); }} className={`flex w-full items-center gap-2 px-2 py-1.5 rounded text-xs font-medium transition-colors ${selectedFolderId === f.id ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:bg-slate-800'}`}>
                    <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                    <span className="truncate">{f.name}</span>
                  </button>
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
                    <button key={c.id} onClick={() => setCurrentChat(c)} className={`flex w-full items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${currentChat?.id === c.id ? 'bg-slate-800 text-white font-medium border border-slate-700' : 'text-slate-400 hover:bg-slate-800/60'}`}>
                      <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                      <span className="truncate flex-1">{c.title}</span>
                    </button>
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
              <h3 className="font-semibold text-sm text-slate-200">{currentChat.title}</h3>
              <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">雲端同步中</span>
            </header>

            {/* 訊息渲染區 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {currentChat.messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">這是一場全新的對話，輸入訊息開始跟 Gemini 聊天吧。</div>
              ) : (
                currentChat.messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-xl px-3.5 py-2 text-sm leading-relaxed ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-900 text-slate-200 rounded-bl-none border border-slate-800'}`}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))
              )}
              {isSending && (
                <div className="flex justify-start">
                  <div className="bg-slate-900 text-slate-400 border border-slate-800 rounded-xl rounded-bl-none px-3.5 py-2 text-sm animate-pulse">Gemini 思考中...</div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 訊息輸入欄 */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-900 bg-slate-950">
              <div className="flex gap-2 max-w-3xl mx-auto">
                <input type="text" placeholder={apiKey ? "輸入訊息..." : "請先在左側填入 Gemini API Key 才能開始對話！"} value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} disabled={!apiKey || isSending} className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-40" />
                <button type="submit" disabled={!inputMessage.trim() || isSending || !apiKey} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-40">發送</button>
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
            <p className="text-xs text-slate-600 mt-1">所有在此建立的對話都會自動依附在資料夾下，並上傳雲端保存。</p>
          </div>
        )}
      </main>
    </div>
  );
}