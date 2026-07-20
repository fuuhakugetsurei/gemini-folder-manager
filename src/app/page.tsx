'use client';

import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useState, useEffect, useRef } from 'react';
import { supabase, Folder, Conversation } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

// 🛠️ 輔助函式：前端 Canvas 自動壓縮圖片
const compressImage = (file: File, maxWidth = 1920, maxHeight = 1920, quality = 0.75): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.src = URL.createObjectURL(file);
    image.onload = () => {
      let width = image.width;
      let height = image.height;

      if (width > maxWidth || height > maxHeight) {
        if (width / height > maxWidth / maxHeight) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas Context 獲取失敗'));
        return;
      }

      ctx.drawImage(image, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('圖片壓縮轉換失敗'));
          }
        },
        'image/jpeg',
        quality
      );
    };
    image.onerror = (err) => reject(err);
  });
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // 核心資料狀態
  const [folders, setFolders] = useState<Folder[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [currentChat, setCurrentChat] = useState<Conversation | null>(null);

  // 輸入與控制狀態
  const [inputMessage, setInputMessage] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  // 🤖 Gemini 模型切換狀態 - 僅保留 3 系列核心
  const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash');

  // 🔐 邀請密鑰專用防禦狀態
  const [isVerified, setIsVerified] = useState<boolean | null>(null); 
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [verifying, setVerifying] = useState(false);

  // 🖼️ 雲端圖片網址狀態（Supabase Storage 分流）
  const [attachedImageUrl, setAttachedImageUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // 📄 本地文字/程式碼檔案暫存狀態（零雲端空間消耗）
  const [attachedFileContent, setAttachedFileContent] = useState<string | null>(null);
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);

  // 📱 行動端側邊欄收闔控制狀態
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // ⚙️ 「其他功能」總中控艙狀態
  const [isFeaturesMenuOpen, setIsFeaturesMenuOpen] = useState(false);

  // 📥 匯入控制艙（Modal）狀態
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [parsedMessages, setParsedMessages] = useState<{ role: string; content: string }[]>([]);
  const [firstQuestionTitle, setFirstQuestionTitle] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // 💡 用戶引導彈窗狀態
  const [activeGuide, setActiveGuide] = useState<'api' | 'compress' | null>(null);
  
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

    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) setApiKey(savedKey);

    const savedModel = localStorage.getItem('gemini_selected_model');
    if (savedModel) setSelectedModel(normalizeModelSelection(savedModel));

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

  // 防禦性自動捲動修復
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentChat?.messages]);

  // 僅保留 3 系列核心的校驗邏輯
  const normalizeModelSelection = (model: string) => {
    switch (model) {
      case 'gemini-3.5-flash':
      case 'gemini-3.5-pro':
        return model;
      default:
        return 'gemini-3.5-flash';
    }
  };

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  const saveSelectedModel = (model: string) => {
    const normalizedModel = normalizeModelSelection(model);
    setSelectedModel(normalizedModel);
    localStorage.setItem('gemini_selected_model', normalizedModel);
  };

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

  // 🚀 優化版：萬用文件夾帶分流處理（整合 Canvas 壓圖機制）
  const handleUniversalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const fileType = file.type;

    if (fileType.startsWith('image/')) {
      setIsUploadingImage(true);
      try {
        // 1. 前端 Canvas 輕量壓縮
        const compressedBlob = await compressImage(file, 1920, 1920, 0.75);
        
        // 2. 構建不重複檔名
        const fileName = `${user.id}/${Date.now()}.jpg`;

        // 3. 上傳 Supabase Storage (附帶正確的 contentType 與 upsert 參數)
        const { error } = await supabase.storage
          .from('images')
          .upload(fileName, compressedBlob, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: true
          });

        if (error) {
          if (error.message.includes('row-level security')) {
            throw new Error('Supabase Storage 權限未設定！請確保在 Supabase Console 中的 Storage Policies 允許 anon/authenticated 角色的 INSERT 權限。');
          }
          throw error;
        }

        const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(fileName);
        setAttachedImageUrl(publicUrl);
        setAttachedFileContent(null);
        setAttachedFileName(null);
      } catch (err: any) {
        alert(`圖片儲存桶同步失敗: ${err.message}`);
      } finally {
        setIsUploadingImage(false);
      }
    } else {
      if (file.size > 4 * 1024 * 1024) {
        alert('純文字/程式碼檔案大小超過 4MB 限制！');
        return;
      }
      setAttachedFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setAttachedFileContent(text || '');
        setAttachedImageUrl(null);
      };
      reader.readAsText(file);
    }
  };

  const fetchFolders = async () => {
    const { data } = await supabase.from('folders').select('*').order('created_at', { ascending: true });
    setFolders(data || []);
  };

  const fetchConversations = async () => {
    const { data } = await supabase.from('conversations').select('*').order('updated_at', { ascending: false });
    setConversations(data || []);
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || !user) return;
    const { data } = await supabase.from('folders').insert([{ name: newFolderName.trim(), user_id: user.id }]).select();
    if (data) {
      setFolders(prev => [...prev, data[0]]);
    }
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
      setConversations(prev => [data[0], ...prev]);
      setCurrentChat(data[0]);
      setIsSidebarOpen(false); 
    }
  };

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (!confirm('確定要刪除此資料夾嗎？裡面的所有對話幕也會一併消失喔！')) return;

    const { error } = await supabase.from('folders').delete().eq('id', folderId);
    if (!error) {
      setFolders(prev => prev.filter(f => f.id !== folderId));
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
        setCurrentChat(null);
      }
      setConversations(prev => prev.filter(c => c.folder_id !== folderId));
    } else {
      alert(`刪除資料夾失敗: ${error.message}`);
    }
  };

  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (!confirm('確定要刪除這場對話紀錄嗎？')) return;

    const { error = null } = await supabase.from('conversations').delete().eq('id', chatId);
    if (!error) {
      setConversations(prev => prev.filter(c => c.id !== chatId));
      if (currentChat?.id === chatId) {
        setCurrentChat(null);
      }
    } else {
      alert(`刪除對話失敗: ${error.message}`);
    }
  };

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
        setConversations(prev => [data[0], ...prev]);
        setCurrentChat(data[0]);
        alert(`成功導入！已建立新生命對話（共解析 ${parsedMessages.length} 則歷史訊息）。`);
        
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

  // 🚀 核心優化：呼叫 Gemini API 並進行歷史圖片 Payload 裁剪
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputMessage.trim() && !attachedImageUrl && !attachedFileContent) || !currentChat || !apiKey || isSending) return;

    let finalContent = inputMessage.trim();

    if (attachedImageUrl) {
      finalContent = `${inputMessage.trim()}\n\n[IMAGE_URL:${attachedImageUrl}]`;
    } else if (attachedFileContent && attachedFileName) {
      const fileExt = attachedFileName.split('.').pop() || 'txt';
      finalContent = `${inputMessage.trim()}\n\n📁 **附帶檔案: ${attachedFileName}**\n\`\`\`${fileExt}\n${attachedFileContent}\n\`\`\``;
    }

    const userMessage = { role: 'user', content: finalContent };
    const updatedMessages = [...currentChat.messages, userMessage];
    const chatId = currentChat.id;
    const originalInput = inputMessage.trim();

    const nextChatState = {
      ...currentChat,
      messages: updatedMessages,
      title: currentChat.title === '新對話' ? (originalInput || attachedFileName || '檔案對話') : currentChat.title,
      updated_at: new Date().toISOString()
    };

    setCurrentChat(nextChatState);
    setConversations(prev => prev.map(c => c.id === chatId ? nextChatState : c));
    setInputMessage('');
    setAttachedImageUrl(null); 
    setAttachedFileContent(null); 
    setAttachedFileName(null);
    setIsSending(true);

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      const contents = await Promise.all(updatedMessages.map(async (msg, index) => {
        if (msg.role === 'model') {
          return { role: 'model', parts: [{ text: msg.content }] };
        }

        const text = msg.content;
        const urlRegex = /\[IMAGE_URL:(https:\/\/[\s\S]+?)\]/;
        const match = text.match(urlRegex);

        const parts: any[] = [];
        
        // ⚡ 關鍵優化：只對「最新發送的那一條訊息」下載圖片轉 Base64 餵給 Gemini；歷史對話只保留文字標籤
        const isLatestMessage = index === updatedMessages.length - 1;

        if (match && isLatestMessage) {
          const cleanText = text.replace(urlRegex, '').trim();
          if (cleanText) parts.push({ text: cleanText });
          
          const targetUrl = match[1];
          try {
            const imageResp = await fetch(targetUrl);
            const blob = await imageResp.blob();
            const buffer = await blob.arrayBuffer();
            const base64String = btoa(
              new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
            );

            parts.push({
              inlineData: {
                data: base64String,
                mimeType: blob.type || "image/jpeg"
              }
            });
          } catch (fetchErr) {
            console.error("流式抓取儲存桶圖片失敗:", fetchErr);
            parts.push({ text: text });
          }
        } else {
          parts.push({ text: text });
        }

        return { role: 'user', parts: parts };
      }));

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: contents,
        config: {
          systemInstruction: "你是一個專業、精準的學術與程式助手。當使用者使用中文與你對話時，你必須、且只能使用『繁體中文（台灣習慣用語）』進行回覆。如果回答中涉及數學公式、定理、階乘、算式或變數，你必須嚴格使用標準 LaTeX 語法包裹，行內公式使用 $...$ 包裹，獨立區塊公式使用 $$...$$ 包裹。嚴禁直接輸出純文字的數學運算符號（例如嚴禁直接寫 \\times 卻沒有包裹在 $ 裡面）。"
        }
      });

      const modelResponseText = response.text || '（未能取得回應）';
      const finalMessages = [...updatedMessages, { role: 'model', content: modelResponseText }];

      const currentChatTitle = nextChatState.title;
      const currentChatIsoString = new Date().toISOString();

      const { data } = await supabase
        .from('conversations')
        .update({ 
          messages: finalMessages,
          title: currentChatTitle,
          updated_at: currentChatIsoString
        })
        .eq('id', chatId)
        .select();

      if (data) {
        const syncedChat = data[0];
        setCurrentChat(syncedChat);
        setConversations(prev => prev.map(c => c.id === chatId ? syncedChat : c));
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

      {/* ⚙️ 一級控制艙：整合了「模型切換」與「API Key管理」的超級擴充功能面板 */}
      {isFeaturesMenuOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[90] flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚙️</span>
                <h3 className="font-bold text-sm md:text-base text-slate-200">擴充功能與核心設定艙</h3>
              </div>
              <button onClick={() => setIsFeaturesMenuOpen(false)} className="text-slate-400 hover:text-white text-xs bg-slate-800 px-2 py-1 rounded">
                關閉面板 ✕
              </button>
            </div>

            {/* ✨【整合項目 1】模型切換 */}
            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-2">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">AI 三系列核心選擇</label>
              <select 
                value={selectedModel} 
                onChange={(e) => saveSelectedModel(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="gemini-3.5-flash">Gemini 3.5 Flash (全能·次世代高流速)</option>
                <option value="gemini-3.5-pro">Gemini 3.5 Pro (深度推理·專家代碼)</option>
              </select>
              <p className="text-[10px] text-slate-500 leading-tight px-0.5">
                {selectedModel === 'gemini-3.5-flash' && "⚡ 提示：全新 3.5 Flash 核心，極速回應，全方位覆蓋日常開發與複雜學術任務。"}
                {selectedModel === 'gemini-3.5-pro' && "🧠 提示：3.5 Pro 重推推理引擎，專攻高難度演算法、數理證明與深層邏輯解構。"}
              </p>
            </div>

            {/* ✨【整合項目 2】API KEY 設定區 */}
            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Gemini API Key 憑證</label>
              <input 
                type="password" 
                placeholder="請貼上您的 AI Studio 金鑰..." 
                value={apiKey} 
                onChange={(e) => saveApiKey(e.target.value)} 
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500" 
              />
            </div>

            {/* 其他輔助功能組件 */}
            <div className="grid grid-cols-1 gap-2.5 pt-1">
              <button
                onClick={() => { setIsImportModalOpen(true); setIsFeaturesMenuOpen(false); }}
                className="w-full bg-slate-950 hover:bg-slate-800/60 border border-slate-800 rounded-xl p-3 text-left transition-all flex items-center gap-3 group"
              >
                <span className="text-xl bg-slate-900 p-2 rounded-lg group-hover:bg-indigo-600/20 group-hover:text-indigo-400 transition-colors">📥</span>
                <div>
                  <p className="text-xs font-semibold text-slate-200">歷史對話重組匯入</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">支援上傳 AI Exporter 的 .md 檔案無縫復活對話</p>
                </div>
              </button>

              <button
                onClick={() => { setActiveGuide('api'); setIsFeaturesMenuOpen(false); }}
                className="w-full bg-slate-950 hover:bg-slate-800/60 border border-slate-800 rounded-xl p-3 text-left transition-all flex items-center gap-3 group"
              >
                <span className="text-xl bg-slate-900 p-2 rounded-lg group-hover:bg-indigo-600/20 group-hover:text-indigo-400 transition-colors">🔑</span>
                <div>
                  <p className="text-xs font-semibold text-slate-200">如何取得免費 API Key？</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">圖文引導你前往 Google AI Studio 申請專屬金鑰</p>
                </div>
              </button>

              <button
                onClick={() => { setActiveGuide('compress'); setIsFeaturesMenuOpen(false); }}
                className="w-full bg-slate-950 hover:bg-slate-800/60 border border-slate-800 rounded-xl p-3 text-left transition-all flex items-center gap-3 group"
              >
                <span className="text-xl bg-slate-900 p-2 rounded-lg group-hover:bg-indigo-600/20 group-hover:text-indigo-400 transition-colors">🖼️</span>
                <div>
                  <p className="text-xs font-semibold text-slate-200">圖片傳輸與壓縮說明</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">了解系統如何自動壓縮圖片以大幅加快傳輸速度</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📥 二級嵌套視窗：Markdown 檔案上傳解構艙 */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📥</span>
                <h3 className="font-bold text-sm md:text-base text-slate-200">歷史對話重組控制艙</h3>
              </div>
              <button onClick={() => { setIsImportModalOpen(false); setImportedFileName(null); setParsedMessages([]); setIsFeaturesMenuOpen(true); }} className="text-slate-400 hover:text-white text-xs bg-slate-800 px-2 py-1 rounded">
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
                onClick={() => { setIsImportModalOpen(false); setImportedFileName(null); setParsedMessages([]); setIsFeaturesMenuOpen(true); }}
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

      {/* 💡 二級靜態用戶引導控制艙 */}
      {activeGuide && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">{activeGuide === 'api' ? '🔑' : '🖼️'}</span>
                <h3 className="font-bold text-sm md:text-base text-slate-200">
                  {activeGuide === 'api' ? 'Google AI Studio 密鑰指南' : '圖片傳輸與壓縮說明'}
                </h3>
              </div>
              <button onClick={() => { setActiveGuide(null); setIsFeaturesMenuOpen(true); }} className="text-slate-400 hover:text-white text-xs bg-slate-800 px-2 py-1 rounded">
                返回上一層 ✕
              </button>
            </div>

            <div className="text-xs text-slate-300 leading-relaxed space-y-3 max-h-80 overflow-y-auto pr-1 scrollbar-none font-sans">
              {activeGuide === 'api' ? (
                <>
                  <p className="font-semibold text-indigo-400">只需三步，即可取得終身免費的 Gemini 核心金鑰：</p>
                  <ol className="list-decimal pl-4 space-y-2 text-slate-400">
                    <li>點擊前往 <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="text-indigo-400 underline font-semibold hover:text-indigo-300">Google AI Studio 官方網站</a> 並使用任意 Google 帳號登入。</li>
                    <li>點擊左上角的 "Get API key" 按鈕。</li>
                    <li>點擊 "Create API key"，建立成功後將其複製，並貼回我們工作區左側的密鑰輸入框內即可！</li>
                  </ol>
                </>
              ) : (
                <>
                  <p className="font-semibold text-emerald-400">本系統已內建 HTML5 Canvas 前端自動壓縮技術：</p>
                  <ul className="list-disc pl-4 space-y-2 text-slate-400">
                    <li><span className="text-slate-200 font-semibold">自動降頻壓縮</span>：不論相片原始體積多大，上傳時皆會自動等比縮放至最大 1920px 並轉為高畫質 75% JPEG，體積暴降 80%~90%。</li>
                    <li><span className="text-slate-200 font-semibold">極速直推</span>：體積大幅減少後，上傳至 Supabase Storage CDN 的時間可縮短至 0.5 秒內。</li>
                  </ul>
                </>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => { setIsFeaturesMenuOpen(true); setActiveGuide(null); }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-4 py-2 rounded-lg transition-colors w-full sm:w-auto"
              >
                我知道了，返回
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
          <div className="flex items-center justify-between mb-4 border-b border-slate-800/50 pb-2">
            <h2 className="text-xl font-bold text-indigo-400 tracking-wide">對話工作區</h2>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => { setIsFeaturesMenuOpen(true); setIsSidebarOpen(false); }}
                title="更多擴充功能與核心組件設定"
                className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-indigo-600/20 text-slate-400 hover:text-indigo-400 border border-slate-700/50 hover:border-indigo-500/30 transition-all duration-200 group flex items-center justify-center"
              >
                <span className="text-sm group-hover:rotate-45 transition-transform duration-300">⚙️</span>
              </button>
              <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-slate-400 hover:text-white p-1 text-sm ml-1">
                ✕
              </button>
            </div>
          </div>

          {/* 新增資料夾 */}
          <form onSubmit={handleCreateFolder} className="mb-4 flex gap-1">
            <input type="text" placeholder="新建資料夾..." value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500 text-slate-200" />
            <button type="submit" disabled={!newFolderName.trim()} className="bg-indigo-600 px-2 py-1 rounded text-xs hover:bg-indigo-700 transition-colors">+</button>
          </form>

          {/* 資料夾與對話清單 */}
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
                          {c.title.includes('[IMAGE_URL:') ? c.title.split('[IMAGE_URL:')[0].trim() || '圖片對話' : c.title}
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
            {/* 对話頂欄 */}
            <header className="p-3 md:p-4 border-b border-slate-900 bg-slate-900/30 flex items-center justify-between gap-2 flex-shrink-0">
              <div className="flex items-center gap-3 truncate">
                <button onClick={() => setIsSidebarOpen(true)} className="md:hidden text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <h3 className="font-semibold text-xs md:text-sm text-slate-200 truncate">
                  {currentChat.title.includes('[IMAGE_URL:') ? currentChat.title.split('[IMAGE_URL:')[0].trim() || '圖片對話' : currentChat.title}
                </h3>
              </div>
              <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700 flex-shrink-0">智能雙流分流中</span>
            </header>

            {/* 複合彈性格局 */}
            <div className="flex-1 h-0 flex flex-row relative">
              
              {/* 💬 核心對話框 */}
              <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-6 scrollbar-none pr-10 h-full">
                {currentChat.messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">這是一場全新的對話，選取圖片、原始碼或文字檔開始聊吧。</div>
                ) : (
                  currentChat.messages.map((msg, i) => {
                    const urlRegex = /\[IMAGE_URL:(https:\/\/[\s\S]+?)\]/;
                    const match = msg.content.match(urlRegex);
                    const cleanText = msg.content.replace(urlRegex, '').trim();
 
                    return (
                      <div key={i} id={`message-node-${i}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'user' ? (
                          <div className="max-w-[85%] md:max-w-[75%] rounded-xl px-3.5 py-2 text-sm bg-indigo-600 text-white rounded-br-none shadow-md">
                            {match && (
                              <div className="mb-2 max-w-xs overflow-hidden rounded border border-slate-700/50 bg-slate-950/40 p-1">
                                <img src={match[1]} alt="雲端儲存桶圖片" className="max-h-40 md:max-h-48 w-auto object-contain rounded" />
                              </div>
                            )}
                            {cleanText && (
                              <div className="whitespace-pre-wrap text-xs md:text-sm prose prose-invert max-w-none prose-code:text-amber-300 prose-pre:bg-slate-950">
                                <ReactMarkdown>{cleanText}</ReactMarkdown>
                              </div>
                            )}
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
                      <span>✨ Gemini 正在解構上下文與算式...</span>
                    </div>
                  </div>
                )}
                
                {/* 滾動底部鎖定點 */}
                <div ref={messagesEndRef} className="h-2 w-full flex-shrink-0" />
              </div>

              {/* ⏱️ 縱向滾動時間軸：只紀錄使用者的問題 */}
              <aside className="hidden sm:flex absolute right-2 top-4 bottom-4 w-4 bg-slate-800/20 backdrop-blur-sm rounded-full flex-col items-center py-4 overflow-y-auto space-y-4 border border-slate-800/40 scrollbar-none z-30">
                {currentChat.messages.map((msg, i) => {
                  if (msg.role !== 'user') return null;

                  const previewText = msg.content.replace(/\[IMAGE_URL:.*\]/g, '').slice(0, 15) || '原始碼或複雜檔案問題';
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
                
                {isUploadingImage && (
                  <div className="text-xs text-indigo-400 animate-pulse bg-slate-900 p-2 rounded-lg border border-slate-800 w-fit">
                    ⏳ 正在即時壓縮並推送至 Supabase Storage...
                  </div>
                )}

                {attachedImageUrl && (
                  <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-800 w-fit animate-fade-in">
                    <img src={attachedImageUrl} alt="預覽" className="w-8 h-8 md:w-10 md:h-10 object-cover rounded border border-slate-700" />
                    <span className="text-[10px] md:text-[11px] text-emerald-400">✓ 圖片已極速壓縮上傳 CDN</span>
                    <button type="button" onClick={() => setAttachedImageUrl(null)} className="text-xs text-rose-400 hover:underline ml-2">取消</button>
                  </div>
                )}

                {attachedFileName && (
                  <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-800 w-fit animate-fade-in">
                    <span className="text-xl">📄</span>
                    <span className="text-[10px] md:text-[11px] text-indigo-400 font-mono font-semibold truncate max-w-[180px]">
                      {attachedFileName}
                    </span>
                    <span className="text-[9px] text-slate-500">（本地異步合流·零空間消耗）</span>
                    <button type="button" onClick={() => { setAttachedFileContent(null); setAttachedFileName(null); }} className="text-xs text-rose-400 hover:underline ml-2">取消</button>
                  </div>
                )}

                <div className="flex gap-2 items-center">
                  <label className="cursor-pointer bg-slate-900 hover:bg-slate-800 border border-slate-800 p-2 rounded-lg flex items-center justify-center transition-colors flex-shrink-0" title="夾帶相片(走雲端) 或 代碼/文字檔(走本地免額度)">
                    <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <input type="file" accept="image/*,.txt,.py,.cpp,.h,.cs,.java,.js,.ts,.html,.css,.json,.md" onChange={handleUniversalFileChange} className="hidden" disabled={!apiKey || isSending || isUploadingImage} />
                  </label>

                  <input type="text" placeholder={apiKey ? "輸入訊息或發送數學物理公式..." : "請先填入 Gemini API Key！"} value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} disabled={!apiKey || isSending || isUploadingImage} className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-40" />
                  <button type="submit" disabled={(!inputMessage.trim() && !attachedImageUrl && !attachedFileContent) || isSending || !apiKey || isUploadingImage} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs md:text-sm font-medium px-3 py-1.5 md:px-4 md:py-2 rounded-lg transition-colors disabled:opacity-40 flex-shrink-0">發送</button>
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