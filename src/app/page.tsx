'use client';

import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
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

  // 📱 行動端側邊欄收闔控制狀態
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // ⚙️ 新增：「其他功能」總中控艙狀態
  const [isFeaturesMenuOpen, setIsFeaturesMenuOpen] = useState(false);

  // 📥 匯入控制艙（Modal）狀態
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [parsedMessages, setParsedMessages] = useState<{ role: string; content: string }[]>([]);
  const [firstQuestionTitle, setFirstQuestionTitle] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  
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
        setIsVerified(true);
      } else {
        setIsVerified(false);
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
      setIsSidebarOpen(false); 
    }
  };

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
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

  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
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

  // 📥 主動上傳並讀取 Markdown 檔案邏輯
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportedFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const sectionRegex = /(# you asked|# gemini response)([\s\S]*?)(?=(?:# you asked|# gemini response|Powered by \[AI Exporter\]|$))/g;
      const messagesArray: { role: string; content: string }[] = [];
      let titleTemp = '';
      let match;

      while ((match = sectionRegex.exec(text)) !== null) {
        const marker = match[1];
        let content = match[2].trim();

        if (marker === '# you asked') {
          content = content.replace(/message time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, '').trim();
          if (content) {
            messagesArray.push({ role: 'user', content: content });
            if (!titleTemp) titleTemp = content.slice(0, 15);
          }
        } else if (marker === '# gemini response') {
          if (content) {
            messagesArray.push({ role: 'model', content: content });
          }
        }
      }

      if (messagesArray.length === 0) {
        alert('檔案解析失敗！請確保上傳的是由 AI Exporter 導出的標準 Markdown 檔案。');
        setImportedFileName(null);
        return;
      }

      setParsedMessages(messagesArray);
      setFirstQuestionTitle(titleTemp || '匯入的檔案對話');
    };
    reader.readAsText(file);
  };

  // 📥 檔案正式落盤至 Supabase 雲端
  const handleExecuteImport = async () => {
    if (parsedMessages.length === 0 || !user || isImporting) return;
    if (!selectedFolderId) return alert('請先在左側欄選取一個目的地資料夾，再執行匯入！');

    setIsImporting(true);
    try {
      const { data, error } = await supabase
        .from('conversations')
        .insert([{
          user_id: user.id,
          folder_id: selectedFolderId,
          title: firstQuestionTitle,
          messages: parsedMessages
        }])
        .select();

      if (error) throw error;

      if (data) {
        setConversations([data[0], ...conversations]);
        setCurrentChat(data[0]);
        alert(`成功導入！已建立新生命對話（共解析 ${parsedMessages.length} 則歷史訊息）。`);
        
        // 重置艙門狀態
        setImportedFileName(null);
        setParsedMessages([]);
        setFirstQuestionTitle('');
        setIsImportModalOpen(false);
      }
    } catch (err: any) {
      alert(`資料庫寫入失敗: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  // 4. 核心：呼叫 Gemini API 並且雲端同步存檔
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputMessage.trim() && !attachedImage) || !currentChat || !apiKey || isSending) return;

    let finalContent = inputMessage.trim();
    if (attachedImage) {
      finalContent = `${inputMessage.trim()}\n\n[IMAGE_DATA:${attachedImage}]`;
    }

    const userMessage = { role: 'user', content: finalContent };
    const updatedMessages = [...currentChat.messages, userMessage];
    
    setCurrentChat({ ...currentChat, messages: updatedMessages });
    const originalInput = inputMessage.trim();
    setInputMessage('');
    setAttachedImage(null); 
    setIsSending(true);

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      
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

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: contents,
        config: {
          systemInstruction: "你是一個專業、精準的學術與程式助手。當使用者使用中文與你對話時，你必須、且只能使用『繁體中文（台灣習慣用語）』進行回覆。如果回答中涉及數學公式、定理、階乘、算式或變數，你必須嚴格使用標準 LaTeX 語法包裹，行內公式使用 $...$ 包裹，獨立區塊公式使用 $$...$$ 包裹。嚴禁直接輸出純文字的數學運算符號（例如嚴禁直接寫 \\times 卻沒有包裹在 $ 裡面）。"
        }
      });

      const modelResponseText = response.text || '（未能取得回應）';
      const finalMessages = [...updatedMessages, { role: 'model', content: modelResponseText }];

      const { data } = await supabase
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

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden relative">
      
      {/* 行動端側邊欄黑底遮罩 */}
      {isSidebarOpen && (
        <div onClick={() => setIsSidebarOpen(false)} className="md:hidden fixed inset-0 bg-black/60 z-40 transition-opacity" />
      )}

      {/* ⚙️ 核心一級嵌套視窗：「其他功能總控制艙」 */}
      {isFeaturesMenuOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[90] flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚙️</span>
                <h3 className="font-bold text-sm md:text-base text-slate-200">擴充功能控制台</h3>
              </div>
              <button onClick={() => setIsFeaturesMenuOpen(false)} className="text-slate-400 hover:text-white text-xs bg-slate-800 px-2 py-1 rounded">
                關閉面板 ✕
              </button>
            </div>

            {/* 功能矩陣導覽區：未來所有的客製化新功能按鈕都放在這裡 */}
            <div className="grid grid-cols-1 gap-2 py-2">
              <button
                onClick={() => {
                  setIsImportModalOpen(true); // 開啟二級嵌套的匯入艙
                  setIsFeaturesMenuOpen(false); // 自動關閉一級選單，保持視覺專注
                }}
                className="w-full bg-slate-950 hover:bg-slate-800/60 border border-slate-800 rounded-xl p-3 text-left transition-all flex items-center gap-3 group"
              >
                <span className="text-xl bg-slate-900 p-2 rounded-lg group-hover:bg-indigo-600/20 group-hover:text-indigo-400 transition-colors">📥</span>
                <div>
                  <p className="text-xs font-semibold text-slate-200">歷史對話重組匯入</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">支援上傳 AI Exporter 的 .md 檔案無縫復活對話</p>
                </div>
              </button>

              {/* 💡 未來的新功能預留坑位範例： */}
              <div className="w-full bg-slate-950/40 border border-slate-800/40 rounded-xl p-3 text-left flex items-center gap-3 opacity-40 select-none">
                <span className="text-xl bg-slate-900/40 p-2 rounded-lg">🚀</span>
                <div>
                  <p className="text-xs font-semibold text-slate-400">研擬中新擴充組件</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">保持主介面極簡，新功能不霸佔側邊欄</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📥 核心二級嵌套視窗：Markdown 檔案上傳解構艙 */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📥</span>
                <h3 className="font-bold text-sm md:text-base text-slate-200">歷史對話重組控制艙</h3>
              </div>
              <button 
                onClick={() => { 
                  setIsImportModalOpen(false); 
                  setImportedFileName(null); 
                  setParsedMessages([]); 
                  setIsFeaturesMenuOpen(true); // 貼心設計：關閉匯入時，自動彈回一級控制台
                }} 
                className="text-slate-400 hover:text-white text-xs bg-slate-800 px-2 py-1 rounded"
              >
                返回上一層 ✕
              </button>
            </div>

            {!selectedFolderId ? (
              <div className="bg-amber-500/10 text-amber-400 text-xs p-3 rounded-xl border border-amber-500/20 leading-relaxed">
                ⚠️ **防禦警報：** 您目前尚未在左側側邊欄點選任何一個資料夾。請先關閉視窗，點選目的地資料夾後再來上傳，否則雲端匯入按鈕會維持鎖定狀態！
              </div>
            ) : (
              <div className="text-xs text-slate-400 bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
                💡 **極簡操作流：** 請直接點選下方區塊，上傳由 AI Exporter 導出的 `.md` 對話文檔。系統會全自動讀取解析，杜絕複製貼上錯誤！
              </div>
            )}

            <div className="w-full">
              <label className={`w-full h-40 bg-slate-950 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all p-4 text-center
                ${importedFileName ? 'border-emerald-500/50 bg-emerald-950/5' : 'border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900/40'}`}
              >
                <input type="file" accept=".md" onChange={handleFileChange} className="hidden" />
                {importedFileName ? (
                  <>
                    <span className="text-2xl text-emerald-400">📄</span>
                    <p className="text-xs font-semibold text-emerald-300 truncate max-w-xs">{importedFileName}</p>
                    <p className="text-[10px] text-slate-500">已成功解構出 {parsedMessages.length} 則歷史對話，隨時可以落盤</p>
                  </>
                ) : (
                  <>
                    <span className="text-2xl text-slate-600">📤</span>
                    <p className="text-xs text-slate-400 font-medium">點擊此處上傳 .md 對話檔案</p>
                    <p className="text-[10px] text-slate-600">僅接受標準 Markdown 匯出文件</p>
                  </>
                )}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { 
                  setIsImportModalOpen(false); 
                  setImportedFileName(null); 
                  setParsedMessages([]); 
                  setIsFeaturesMenuOpen(true); 
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-4 py-2 rounded-lg transition-colors"
              >
                返回
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={isImporting || parsedMessages.length === 0 || !selectedFolderId}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 disabled:hover:bg-indigo-600 text-white text-xs font-semibold px-5 py-2 rounded-lg transition-colors"
              >
                {isImporting ? '解構重組中...' : '確認匯入資料庫'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🧭 側邊欄 Sidebar */}
      <aside className={`w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between flex-shrink-0
        fixed md:relative top-0 bottom-0 left-0 z-50 transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        <div className="p-4 overflow-y-auto flex-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-indigo-400 tracking-wide">對話工作區</h2>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-slate-400 hover:text-white p-1 text-sm">
              ✕
            </button>
          </div>
          
          {/* 模型切換區 */}
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

          {/* ⚙️ 完美防禦組件：側邊欄只留下一顆乾淨的擴充入口，維持介面最高簡潔度 */}
          <button 
            onClick={() => { setIsFeaturesMenuOpen(true); setIsSidebarOpen(false); }}
            className="w-full mb-4 bg-slate-800/50 hover:bg-indigo-600/10 border border-slate-700/60 hover:border-indigo-500/30 rounded-lg py-2 px-3 text-xs text-slate-300 font-medium flex items-center justify-center gap-2 transition-all group"
          >
            <span className="group-hover:rotate-45 transition-transform duration-300">⚙️</span>
            <span>更多擴充功能組件</span>
          </button>

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
                    <button onClick={(e) => handleDeleteFolder(f.id, e)} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-2 py-1.5 rounded-r bg-transparent hover:bg-slate-800 transition-all">
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {selectedFolderId && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">對話歷史</p>
                  <button onClick={handleCreateChat} className="text-[10px] text-indigo-400 hover:underline">+ 新對話</button>
                </div>
                <div className="space-y-1">
                  {conversations.filter(c => c.folder_id === selectedFolderId).map(c => (
                    <div key={c.id} className="group flex items-center justify-between rounded text-xs transition-colors border border-transparent">
                      <button onClick={() => { setCurrentChat(c); setIsSidebarOpen(false); }} className={`flex flex-1 items-center gap-2 px-2 py-1.5 rounded-l text-left transition-colors ${currentChat?.id === c.id ? 'bg-slate-800 text-white font-medium border-l border-y border-slate-700' : 'text-slate-400 hover:bg-slate-800/60'}`}>
                        <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                        <span className="truncate flex-1 max-w-[130px]">
                          {c.title.includes('[IMAGE_DATA:') ? c.title.split('[IMAGE_DATA:')[0].trim() || '圖片對話' : c.title}
                        </span>
                      </button>
                      <button onClick={(e) => handleDeleteChat(c.id, e)} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-2 py-1.5 rounded-r bg-transparent hover:bg-slate-800 transition-all">
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

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
            <header className="p-3 md:p-4 border-b border-slate-900 bg-slate-900/30 flex items-center justify-between gap-2 flex-shrink-0">
              <div className="flex items-center gap-3 truncate">
                <button onClick={() => setIsSidebarOpen(true)} className="md:hidden text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <h3 className="font-semibold text-xs md:text-sm text-slate-200 truncate">
                  {currentChat.title.includes('[IMAGE_DATA:') ? currentChat.title.split('[IMAGE_DATA:')[0].trim() || '圖片對話' : currentChat.title}
                </h3>
              </div>
              <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700 flex-shrink-0">雲端同步</span>
            </header>

            {/* 複合彈性格局 */}
            <div className="flex-1 flex flex-row overflow-hidden h-full relative">
              
              {/* 💬 核心對話框 */}
              <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-6 scrollbar-none pr-8">
                {currentChat.messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">這是一場全新的對話，選取圖片或輸入訊息開始聊吧。</div>
                ) : (
                  currentChat.messages.map((msg, i) => {
                    const imageRegex = /\[IMAGE_DATA:(data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+)\]/;
                    const match = msg.content.match(imageRegex);
                    const cleanText = msg.content.replace(imageRegex, '').trim();

                    return (
                      <div key={i} id={`message-node-${i}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'user' ? (
                          <div className="max-w-[85%] md:max-w-[75%] rounded-xl px-3.5 py-2 text-sm bg-indigo-600 text-white rounded-br-none shadow-md">
                            {match && (
                              <div className="mb-2 max-w-xs overflow-hidden rounded border border-slate-700/50 bg-slate-950/40 p-1">
                                <img src={match[1]} alt="對話夾帶圖片" className="max-h-40 md:max-h-48 w-auto object-contain rounded" />
                              </div>
                            )}
                            {cleanText && <p className="whitespace-pre-wrap text-xs md:text-sm">{cleanText}</p>}
                          </div>
                        ) : (
                          <div className="w-full rounded-none px-1 py-1 text-slate-200 space-y-3">
                            {cleanText && (
                              <div className="prose prose-invert max-w-none text-slate-200 text-sm md:text-base leading-relaxed space-y-3
                                prose-headings:font-bold prose-headings:text-slate-100 prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
                                prose-p:leading-relaxed
                                prose-code:bg-slate-900 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-amber-400 prose-code:text-xs md:prose-code:text-sm
                                prose-pre:bg-slate-900 prose-pre:p-4 prose-pre:rounded-xl prose-pre:border prose-pre:border-slate-800 prose-pre:overflow-x-auto
                                prose-ul:list-disc prose-ul:pl-5 prose-ol:list-decimal prose-ol:pl-5
                                prose-strong:text-white font-semibold">
                                <ReactMarkdown 
                                  remarkPlugins={[remarkMath]} 
                                  rehypePlugins={[rehypeKatex]}
                                >
                                  {cleanText}
                                </ReactMarkdown>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {isSending && (
                  <div className="flex justify-start">
                    <div className="text-slate-400 text-xs md:text-sm animate-pulse flex items-center gap-2">
                      <span>✨ Gemini 正在運算繁體中文與公式...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* ⏱️ 縱向滾動時間軸：只紀錄使用者的問題 */}
              <aside className="hidden sm:flex absolute right-2 top-4 bottom-4 w-4 bg-slate-800/20 backdrop-blur-sm rounded-full flex-col items-center py-4 overflow-y-auto space-y-4 border border-slate-800/40 scrollbar-none z-30">
                {currentChat.messages.map((msg, i) => {
                  if (msg.role !== 'user') return null;

                  const previewText = msg.content.replace(/\[IMAGE_DATA:.*\]/g, '').slice(0, 15) || '圖片或複雜算式問題';
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        const element = document.getElementById(`message-node-${i}`);
                        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                      title={`[問題紀錄] ${previewText}...`}
                      className="w-2.5 h-2.5 rounded-full transition-all duration-200 flex-shrink-0 cursor-pointer hover:scale-150 bg-slate-500 hover:bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.5)]"
                    />
                  );
                })}
              </aside>

            </div>

            {/* 訊息輸入欄 */}
            <form onSubmit={handleSendMessage} className="p-3 md:p-4 border-t border-slate-900 bg-slate-950 flex-shrink-0">
              <div className="max-w-3xl mx-auto space-y-2">
                {attachedImage && (
                  <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-800 w-fit">
                    <img src={attachedImage} alt="預覽" className="w-8 h-8 md:w-10 md:h-10 object-cover rounded border border-slate-700" />
                    <span className="text-[10px] md:text-[11px] text-slate-400">圖片已壓縮 (限 1MB 內)</span>
                    <button type="button" onClick={() => setAttachedImage(null)} className="text-xs text-rose-400 hover:underline ml-2">取消</button>
                  </div>
                )}

                <div className="flex gap-2 items-center">
                  <label className="cursor-pointer bg-slate-900 hover:bg-slate-800 border border-slate-800 p-2 rounded-lg flex items-center justify-center transition-colors flex-shrink-0">
                    <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" disabled={!apiKey || isSending} />
                  </label>

                  <input type="text" placeholder={apiKey ? "輸入訊息或發送數學物理公式..." : "請先填入 Gemini API Key！"} value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} disabled={!apiKey || isSending} className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-40" />
                  <button type="submit" disabled={(!inputMessage.trim() && !attachedImage) || isSending || !apiKey} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs md:text-sm font-medium px-3 py-1.5 md:px-4 md:py-2 rounded-lg transition-colors disabled:opacity-40 flex-shrink-0">發送</button>
                </div>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center relative">
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden absolute top-3 left-3 text-slate-400 hover:text-white p-2 rounded bg-slate-900 border border-slate-800">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="w-12 h-12 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            </div>
            <h3 className="text-xs md:text-sm font-medium text-slate-400">請從左側點選資料夾並「+ 新對話」</h3>
            <p className="text-[11px] text-slate-600 mt-1 max-w-xs">手機用戶請點選左上角選單展開工作區。</p>
          </div>
        )}
      </main>
    </div>
  );
}