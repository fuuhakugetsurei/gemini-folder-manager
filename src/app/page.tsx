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
      if (!ctx) return reject(new Error('Canvas Context 獲取失敗'));

      ctx.drawImage(image, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('圖片壓縮轉換失敗'))),
        'image/jpeg',
        quality
      );
    };
    image.onerror = (err) => reject(err);
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const [apiKey, setApiKey] = useState(''); // Gemini API Key
  const [githubToken, setGithubToken] = useState(''); // GitHub Models PAT
  const [selectedProvider, setSelectedProvider] = useState<'gemini' | 'github'>('gemini'); // 預設 Gemini
  const [isSending, setIsSending] = useState(false);
  const [apiErrorStatus, setApiErrorStatus] = useState<string | null>(null);

  // 側邊欄 UI 狀態：三點選單 / 重命名 / 搬移
  const [activeChatMenuId, setActiveChatMenuId] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [movingChatId, setMovingChatId] = useState<string | null>(null);

  // 對話內編輯問題狀態
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  
  // Drag & Drop 狀態
  const [draggedChatId, setDraggedChatId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  // 模型切換狀態
  const [selectedGeminiModel, setSelectedGeminiModel] = useState('gemini-3.5-flash');
  const [selectedGithubModel, setSelectedGithubModel] = useState('gpt-4.1-mini');
  
  // 🔐 邀請密鑰專用防禦狀態
  const [isVerified, setIsVerified] = useState<boolean | null>(null); 
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [verifying, setVerifying] = useState(false);

  // 🖼️ 雲端圖片 & 本地檔案狀態
  const [attachedImageUrl, setAttachedImageUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [attachedFileContent, setAttachedFileContent] = useState<string | null>(null);
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);

  // Modal 狀態
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFeaturesMenuOpen, setIsFeaturesMenuOpen] = useState(false);
  
  // 📥 匯入控制艙與用戶引導彈窗狀態
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [parsedMessages, setParsedMessages] = useState<{ role: string; content: string }[]>([]);
  const [firstQuestionTitle, setFirstQuestionTitle] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [activeGuide, setActiveGuide] = useState<'api' | 'compress' | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

    // 本地持久化設定讀取
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) setApiKey(savedKey);

    const savedGithubToken = localStorage.getItem('github_token');
    if (savedGithubToken) setGithubToken(savedGithubToken);

    const savedProvider = localStorage.getItem('selected_provider');
    if (savedProvider) setSelectedProvider(savedProvider as any);

    const savedGeminiModel = localStorage.getItem('gemini_selected_model');
    if (savedGeminiModel) setSelectedGeminiModel(savedGeminiModel);

    const savedGithubModel = localStorage.getItem('github_selected_model');
    if (savedGithubModel) setSelectedGithubModel(savedGithubModel);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentChat?.messages]);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  const saveGithubToken = (token: string) => {
    setGithubToken(token);
    localStorage.setItem('github_token', token);
  };

  const saveProvider = (provider: 'gemini' | 'github') => {
    setSelectedProvider(provider);
    localStorage.setItem('selected_provider', provider);
  };

  const checkUserVerification = async (userId: string) => {
    try {
      const { data } = await supabase.from('invite_codes').select('code').eq('assigned_to_user_id', userId);
      setIsVerified(!!(data && data.length > 0));
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
        alert('無效的存取密鑰！');
        setVerifying(false);
        return;
      }

      const { error: updateError } = await supabase
        .from('invite_codes')
        .update({ is_used: true, assigned_to_user_id: user.id })
        .eq('code', inviteCodeInput.trim());

      if (updateError) throw updateError;
      alert('驗證成功！歡迎加入私有工作區。');
      setIsVerified(true);
    } catch (err: any) {
      alert(`密鑰驗證失敗: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleUniversalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.type.startsWith('image/')) {
      setIsUploadingImage(true);
      try {
        const compressedBlob = await compressImage(file, 1920, 1920, 0.75);
        const fileName = `${user.id}/${Date.now()}.jpg`;

        const { error } = await supabase.storage
          .from('images')
          .upload(fileName, compressedBlob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: true });

        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(fileName);
        setAttachedImageUrl(publicUrl);
        setAttachedFileContent(null);
        setAttachedFileName(null);
      } catch (err: any) {
        alert(`圖片上傳失敗: ${err.message}`);
      } finally {
        setIsUploadingImage(false);
      }
    } else {
      if (file.size > 4 * 1024 * 1024) return alert('檔案大小超過 4MB 限制！');
      setAttachedFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        setAttachedFileContent((event.target?.result as string) || '');
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
    if (data) setFolders(prev => [...prev, data[0]]);
    setNewFolderName('');
  };

  const handleRenameFolder = async (folderId: string) => {
    if (!editingFolderName.trim()) {
      setEditingFolderId(null);
      return;
    }
    const { error } = await supabase.from('folders').update({ name: editingFolderName.trim() }).eq('id', folderId);
    if (!error) {
      setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: editingFolderName.trim() } : f));
    }
    setEditingFolderId(null);
  };

  const handleRenameChat = async (chatId: string) => {
    if (!editingChatTitle.trim()) {
      setEditingChatId(null);
      return;
    }
    const { error } = await supabase.from('conversations').update({ title: editingChatTitle.trim() }).eq('id', chatId);
    if (!error) {
      setConversations(prev => prev.map(c => c.id === chatId ? { ...c, title: editingChatTitle.trim() } : c));
      if (currentChat?.id === chatId) {
        setCurrentChat(prev => prev ? { ...prev, title: editingChatTitle.trim() } : null);
      }
    }
    setEditingChatId(null);
  };

  const handleMoveChatToFolder = async (chatId: string, targetFolderId: string) => {
    const { error } = await supabase.from('conversations').update({ folder_id: targetFolderId }).eq('id', chatId);
    if (!error) {
      setConversations(prev => prev.map(c => c.id === chatId ? { ...c, folder_id: targetFolderId } : c));
      setMovingChatId(null);
      setActiveChatMenuId(null);
    }
  };

  const handleCreateChat = async () => {
    if (!user || !selectedFolderId) return alert('請先選擇一個資料夾！');
    
    const { data } = await supabase
      .from('conversations')
      .insert([{ user_id: user.id, folder_id: selectedFolderId, title: '新對話', messages: [] }])
      .select();

    if (data) {
      setConversations(prev => [data[0], ...prev]);
      setCurrentChat(data[0]);
      setIsSidebarOpen(false); 
    }
  };

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (!confirm('確定要刪除此資料夾嗎？')) return;

    const { error } = await supabase.from('folders').delete().eq('id', folderId);
    if (!error) {
      setFolders(prev => prev.filter(f => f.id !== folderId));
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
        setCurrentChat(null);
      }
      setConversations(prev => prev.filter(c => c.folder_id !== folderId));
    }
  };

  const handleDeleteChat = async (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation(); 
    if (!confirm('確定要刪除這場對話紀錄嗎？')) return;

    const { error } = await supabase.from('conversations').delete().eq('id', chatId);
    if (!error) {
      setConversations(prev => prev.filter(c => c.id !== chatId));
      if (currentChat?.id === chatId) setCurrentChat(null);
      setActiveChatMenuId(null);
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
        alert(`成功導入！已建立新對話（共解析 ${parsedMessages.length} 則歷史訊息）。`);
        
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

  // 🌐 GitHub Models API 專用 Fetch 呼叫器
  const callGitHubModels = async (targetMessages: { role: string; content: string }[]) => {
    const formattedMessages = targetMessages.map(msg => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content
    }));

    const response = await fetch('https://models.inference.ai.azure.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${githubToken}`
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "你是一個專業、精準的學術與程式助手。當使用者使用中文與你對話時，你必須、且只能使用『繁體中文（台灣習慣用語）』進行回覆。如果回答中涉及數學公式、定理、階乘、算式或變數，你必須嚴格使用標準 LaTeX 語法包裹，行內公式使用 $...$ 包裹，獨立區塊公式使用 $$...$$ 包裹。" },
          ...formattedMessages
        ],
        model: selectedGithubModel,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `GitHub API 失敗 (HTTP ${response.status})`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '（GitHub Models 未能取得回應）';
  };

  // 🚀 Gemini API 專用呼叫器 (含 503 自動退避與 GitHub 備援)
  const callGeminiWithRetry = async (targetMessages: { role: string; content: string }[]) => {
    const ai = new GoogleGenAI({ apiKey: apiKey });

    const contents = await Promise.all(targetMessages.map(async (msg, index) => {
      if (msg.role === 'model') return { role: 'model', parts: [{ text: msg.content }] };

      const text = msg.content;
      const urlRegex = /\[IMAGE_URL:(https:\/\/[\s\S]+?)\]/;
      const match = text.match(urlRegex);
      const parts: any[] = [];
      const isLatestMessage = index === targetMessages.length - 1;

      if (match && isLatestMessage) {
        const cleanText = text.replace(urlRegex, '').trim();
        if (cleanText) parts.push({ text: cleanText });

        try {
          const imageResp = await fetch(match[1]);
          const blob = await imageResp.blob();
          const buffer = await blob.arrayBuffer();
          const base64String = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

          parts.push({ inlineData: { data: base64String, mimeType: blob.type || "image/jpeg" } });
        } catch (fetchErr) {
          parts.push({ text: text });
        }
      } else {
        parts.push({ text: text });
      }

      return { role: 'user', parts: parts };
    }));

    let maxRetries = 3;
    let retryDelay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: selectedGeminiModel,
          contents: contents,
          config: {
            systemInstruction: "你是一個專業、精準的學術與程式助手。當使用者使用中文與你對話時，你必須、且只能使用『繁體中文（台灣習慣用語）』進行回覆。如果回答中涉及數學公式、定理、階乘、算式或變數，你必須嚴格使用標準 LaTeX 語法包裹，行內公式使用 $...$ 包裹，獨立區塊公式使用 $$...$$ 包裹。"
          }
        });
        return response?.text || '（Gemini 未能取得回應）';
      } catch (apiErr: any) {
        const is503OrRateLimit = apiErr.message?.includes('503') || apiErr.message?.includes('429') || apiErr.status === 503;
        if (is503OrRateLimit && attempt < maxRetries) {
          await sleep(retryDelay);
          retryDelay *= 2;
        } else {
          if (githubToken) {
            console.warn("⚠️ Gemini API 塞車，全自動切換至 GitHub Models 備援備份！");
            return await callGitHubModels(targetMessages);
          }
          throw apiErr;
        }
      }
    }
    throw new Error('Gemini API 高峰期服務不可用');
  };

  // 🚀 核心訊息處理中樞 (自動分流)
  const executeSendMessage = async (targetMessages: { role: string; content: string }[]) => {
    if (!currentChat) return;
    
    setIsSending(true);
    setApiErrorStatus(null);
    const chatId = currentChat.id;

    try {
      let modelResponseText = '';

      if (selectedProvider === 'github') {
        if (!githubToken) throw new Error('請先在設定中填入 GitHub PAT 金鑰！');
        modelResponseText = await callGitHubModels(targetMessages);
      } else {
        if (!apiKey) throw new Error('請先在設定中填入 Gemini API Key！');
        modelResponseText = await callGeminiWithRetry(targetMessages);
      }

      const finalMessages = [...targetMessages, { role: 'model', content: modelResponseText }];
      const currentChatIsoString = new Date().toISOString();

      const { data } = await supabase
        .from('conversations')
        .update({ messages: finalMessages, updated_at: currentChatIsoString })
        .eq('id', chatId)
        .select();

      if (data) {
        setCurrentChat(data[0]);
        setConversations(prev => prev.map(c => c.id === chatId ? data[0] : c));
      }
    } catch (err: any) {
      setApiErrorStatus(err.message || 'API 響應異常');
    } finally {
      setIsSending(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasCredentials = selectedProvider === 'github' ? !!githubToken : !!apiKey;
    if ((!inputMessage.trim() && !attachedImageUrl && !attachedFileContent) || !currentChat || !hasCredentials || isSending) return;

    let finalContent = inputMessage.trim();

    if (attachedImageUrl) {
      finalContent = `${inputMessage.trim()}\n\n[IMAGE_URL:${attachedImageUrl}]`;
    } else if (attachedFileContent && attachedFileName) {
      const fileExt = attachedFileName.split('.').pop() || 'txt';
      finalContent = `${inputMessage.trim()}\n\n📁 **附帶檔案: ${attachedFileName}**\n\`\`\`${fileExt}\n${attachedFileContent}\n\`\`\``;
    }

    const userMessage = { role: 'user', content: finalContent };
    const updatedMessages = [...currentChat.messages, userMessage];

    const nextChatState = {
      ...currentChat,
      messages: updatedMessages,
      title: currentChat.title === '新對話' ? (inputMessage.trim() || attachedFileName || '對話') : currentChat.title,
      updated_at: new Date().toISOString()
    };

    setCurrentChat(nextChatState);
    setConversations(prev => prev.map(c => c.id === currentChat.id ? nextChatState : c));
    setInputMessage('');
    setAttachedImageUrl(null); 
    setAttachedFileContent(null); 
    setAttachedFileName(null);

    await executeSendMessage(updatedMessages);
  };

  const handleRegenerate = async () => {
    if (!currentChat || isSending || currentChat.messages.length === 0) return;
    let trimmedMessages = [...currentChat.messages];
    if (trimmedMessages[trimmedMessages.length - 1].role === 'model') {
      trimmedMessages.pop();
    }
    if (trimmedMessages.length === 0) return;
    setCurrentChat({ ...currentChat, messages: trimmedMessages });
    await executeSendMessage(trimmedMessages);
  };

  const handleSaveEditedMessage = async (msgIndex: number) => {
    if (!currentChat || !editingMessageText.trim()) {
      setEditingMessageIndex(null);
      return;
    }
    const truncatedMessages = currentChat.messages.slice(0, msgIndex);
    const updatedUserMessage = { role: 'user', content: editingMessageText.trim() };
    const newHistory = [...truncatedMessages, updatedUserMessage];

    setCurrentChat({ ...currentChat, messages: newHistory });
    setEditingMessageIndex(null);
    setEditingMessageText('');
    await executeSendMessage(newHistory);
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
            <input type="text" placeholder="請貼上您的專屬密鑰..." value={inviteCodeInput} onChange={(e) => setInviteCodeInput(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
            <div className="flex gap-2">
              <button type="submit" disabled={verifying || !inviteCodeInput.trim()} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors disabled:opacity-40">
                {verifying ? '安全校驗中...' : '確認驗證並綁定'}
              </button>
              <button type="button" onClick={() => supabase.auth.signOut()} className="bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs px-3 rounded-lg transition-colors border border-slate-700">登出</button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  const activeHasCredentials = selectedProvider === 'github' ? !!githubToken : !!apiKey;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden relative" onClick={() => setActiveChatMenuId(null)}>
      
      {isSidebarOpen && (
        <div onClick={() => setIsSidebarOpen(false)} className="md:hidden fixed inset-0 bg-black/60 z-40 transition-opacity" />
      )}

      {/* 📱 行動端「搬移對話」Modal */}
      {movingChatId && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[110] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-xs bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h4 className="text-xs font-bold text-slate-200">🚚 移動對話至...</h4>
              <button onClick={() => setMovingChatId(null)} className="text-xs text-slate-400">✕</button>
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {folders.map(f => (
                <button
                  key={f.id}
                  onClick={() => handleMoveChatToFolder(movingChatId, f.id)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-slate-950 hover:bg-indigo-600/20 text-xs text-slate-300 border border-slate-800 flex items-center gap-2"
                >
                  <span className="text-amber-500">📁</span>
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ⚙️ 超級控制艙 */}
      {isFeaturesMenuOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[90] flex items-center justify-center p-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚙️</span>
                <h3 className="font-bold text-sm md:text-base text-slate-200">擴充功能與核心設定艙</h3>
              </div>
              <button onClick={() => setIsFeaturesMenuOpen(false)} className="text-slate-400 hover:text-white text-xs bg-slate-800 px-2 py-1 rounded">關閉面板 ✕</button>
            </div>

            {/* Provider 提供商選擇器 */}
            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-2">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">目前模型提供商 (Provider)</label>
              <select 
                value={selectedProvider} 
                onChange={(e) => saveProvider(e.target.value as any)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="gemini">Google Gemini API (原生預設)</option>
                <option value="github">GitHub Models (高峰期超強備援)</option>
              </select>
            </div>

            {/* 動態渲染不同 Provider 的 Key 與模型選擇 */}
            {selectedProvider === 'gemini' ? (
              <div className="space-y-3">
                <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Gemini API Key 憑證</label>
                  <input type="password" placeholder="貼上 AI Studio 金鑰..." value={apiKey} onChange={(e) => saveApiKey(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500" />
                </div>
                <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Gemini 系列模型</label>
                  <select value={selectedGeminiModel} onChange={(e) => { setSelectedGeminiModel(e.target.value); localStorage.setItem('gemini_selected_model', e.target.value); }} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200">
                    <option value="gemini-3.5-flash">Gemini 3.5 Flash (極速預設)</option>
                    <option value="gemini-3.5-pro">Gemini 3.5 Pro (專家推理)</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">GitHub Personal Access Token (PAT)</label>
                  <input type="password" placeholder="貼上 github_pat_... 金鑰" value={githubToken} onChange={(e) => saveGithubToken(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500" />
                </div>
                <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">GitHub Models 支援項目</label>
                  <select value={selectedGithubModel} onChange={(e) => { setSelectedGithubModel(e.target.value); localStorage.setItem('github_selected_model', e.target.value); }} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200">
                    <option value="gpt-4.1-mini">OpenAI gpt-4.1-mini (次世代預設·Coding小鋼砲)</option>
                    <option value="gpt-4.1">OpenAI gpt-4.1 (旗艦極致推理)</option>
                    <option value="gpt-4.1-nano">OpenAI gpt-4.1-nano (超低延遲)</option>
                    <option value="gpt-4o-mini">OpenAI gpt-4o-mini (經典輕量)</option>
                    <option value="gpt-4o">OpenAI gpt-4o (全能高階)</option>
                    <option value="meta-llama-3.3-70b-instruct">Meta Llama-3.3-70b</option>
                  </select>
                </div>
              </div>
            )}

            {/* ✨ 更新文案後的輔助功能選單 */}
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
                  <p className="text-xs font-semibold text-slate-200">如何取得免費 API Key / PAT？</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">引導前往 Google AI Studio 與 GitHub 申請專屬憑證</p>
                </div>
              </button>

              <button
                onClick={() => { setActiveGuide('compress'); setIsFeaturesMenuOpen(false); }}
                className="w-full bg-slate-950 hover:bg-slate-800/60 border border-slate-800 rounded-xl p-3 text-left transition-all flex items-center gap-3 group"
              >
                <span className="text-xl bg-slate-900 p-2 rounded-lg group-hover:bg-indigo-600/20 group-hover:text-indigo-400 transition-colors">🖼️</span>
                <div>
                  <p className="text-xs font-semibold text-slate-200">圖片前端自動壓縮說明</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">了解系統如何全自動壓縮圖片以達到 0.5 秒極速傳輸</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📥 歷史對話匯入 Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
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

      {/* 💡 ✨ 最新升級：二級靜態用戶引導控制艙 */}
      {activeGuide && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">{activeGuide === 'api' ? '🔑' : '⚡'}</span>
                <h3 className="font-bold text-sm md:text-base text-slate-200">
                  {activeGuide === 'api' ? '雙模型憑證 (Key / PAT) 申請指南' : '前端全自動圖片壓縮說明'}
                </h3>
              </div>
              <button onClick={() => { setActiveGuide(null); setIsFeaturesMenuOpen(true); }} className="text-slate-400 hover:text-white text-xs bg-slate-800 px-2 py-1 rounded">
                返回上一層 ✕
              </button>
            </div>

            <div className="text-xs text-slate-300 leading-relaxed space-y-4 max-h-80 overflow-y-auto pr-1 scrollbar-none font-sans">
              {activeGuide === 'api' ? (
                <>
                  <div className="space-y-2 border-b border-slate-800 pb-3">
                    <p className="font-semibold text-indigo-400 flex items-center gap-1.5">
                      <span>⚡ 1. Google AI Studio Key (Gemini 原生)</span>
                    </p>
                    <ol className="list-decimal pl-4 space-y-1.5 text-slate-400 text-[11px]">
                      <li>前往 <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="text-indigo-400 underline font-semibold hover:text-indigo-300">Google AI Studio 官網</a>。</li>
                      <li>點擊 "Get API key" → "Create API key"。</li>
                      <li>複製生成的 Key 貼入本站 Gemini 金鑰欄。</li>
                    </ol>
                  </div>

                  <div className="space-y-2">
                    <p className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <span>🐙 2. GitHub Personal Access Token (GitHub Models 備援)</span>
                    </p>
                    <ol className="list-decimal pl-4 space-y-1.5 text-slate-400 text-[11px]">
                      <li>前往 GitHub Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens。</li>
                      <li>點擊 "Generate new token"，名稱隨意（如 `GitHub Models`）。</li>
                      <li>在 <b>Account permissions</b> 區塊下找到 <b>Models</b>，務必將權限設為 <b>Read-only</b>。</li>
                      <li>點擊生成後，複製 `github_pat_...` 貼入 GitHub PAT 欄。</li>
                    </ol>
                  </div>
                </>
              ) : (
                <>
                  <p className="font-semibold text-emerald-400">✨ 本系統已全面升級為「全自動 Canvas 前端即時壓縮」：</p>
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 text-[11px] text-slate-400">
                    <p><span className="text-slate-200 font-semibold">零手動干預</span>：選擇任何相片（包含 4K 原圖或幾十 MB 照片），系統會在背景自動以 HTML5 Canvas 處理。</p>
                    <p><span className="text-slate-200 font-semibold">智慧降頻</span>：最大寬高自動鎖定 1920px、品質設為 75% 高清 JPEG，體積瞬間暴降 80%~90%（降至 200KB~400KB 左右）。</p>
                    <p><span className="text-slate-200 font-semibold">極速上傳</span>：體積縮小後，推送至 Supabase Storage CDN 只需 0.5 秒，且完美繞過資料庫 4MB 上傳限制與 RLS 異常！</p>
                  </div>
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
      <aside className={`w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between flex-shrink-0 fixed md:relative top-0 bottom-0 left-0 z-50 transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`} onClick={(e) => e.stopPropagation()}>
        <div className="p-4 overflow-y-auto flex-1">
          <div className="flex items-center justify-between mb-4 border-b border-slate-800/50 pb-2">
            <h2 className="text-xl font-bold text-indigo-400 tracking-wide">對話工作區</h2>
            <button onClick={() => { setIsFeaturesMenuOpen(true); setIsSidebarOpen(false); }} className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-indigo-600/20 text-slate-400 hover:text-indigo-400 border border-slate-700/50 transition-all">⚙️</button>
          </div>

          <form onSubmit={handleCreateFolder} className="mb-4 flex gap-1">
            <input type="text" placeholder="新建資料夾..." value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500 text-slate-200" />
            <button type="submit" disabled={!newFolderName.trim()} className="bg-indigo-600 px-2 py-1 rounded text-xs hover:bg-indigo-700 transition-colors">+</button>
          </form>

          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">我的資料夾</p>
              <div className="space-y-1">
                {folders.map(f => (
                  <div
                    key={f.id}
                    onDragOver={(e) => { e.preventDefault(); setDragOverFolderId(f.id); }}
                    onDragLeave={() => setDragOverFolderId(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverFolderId(null);
                      if (draggedChatId) handleMoveChatToFolder(draggedChatId, f.id);
                    }}
                    className={`group flex items-center justify-between rounded text-xs font-medium transition-all border ${
                      dragOverFolderId === f.id ? 'border-indigo-500 bg-indigo-600/20 scale-[1.02]' : 'border-transparent'
                    }`}
                  >
                    {editingFolderId === f.id ? (
                      <input
                        type="text"
                        value={editingFolderName}
                        onChange={(e) => setEditingFolderName(e.target.value)}
                        onBlur={() => handleRenameFolder(f.id)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder(f.id)}
                        autoFocus
                        className="flex-1 bg-slate-950 border border-indigo-500 text-xs px-2 py-1 rounded text-slate-200 focus:outline-none"
                      />
                    ) : (
                      <>
                        <button onClick={() => { setSelectedFolderId(f.id); setCurrentChat(null); }} className={`flex flex-1 items-center gap-2 px-2 py-1.5 rounded-l text-left transition-colors ${selectedFolderId === f.id ? 'bg-indigo-600/30 text-indigo-300 border-l border-y border-indigo-500/30' : 'text-slate-400 hover:bg-slate-800'}`}>
                          <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                          <span className="truncate max-w-[110px]">{f.name}</span>
                        </button>
                        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => { setEditingFolderId(f.id); setEditingFolderName(f.name); }} className="text-slate-500 hover:text-indigo-400 px-1 py-1.5">✏️</button>
                          <button onClick={(e) => handleDeleteFolder(f.id, e)} className="text-slate-500 hover:text-rose-400 px-1 py-1.5">🗑️</button>
                        </div>
                      </>
                    )}
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
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => setDraggedChatId(c.id)}
                      onDragEnd={() => setDraggedChatId(null)}
                      className="group relative flex items-center justify-between rounded text-xs transition-colors border border-transparent"
                    >
                      {editingChatId === c.id ? (
                        <input
                          type="text"
                          value={editingChatTitle}
                          onChange={(e) => setEditingChatTitle(e.target.value)}
                          onBlur={() => handleRenameChat(c.id)}
                          onKeyDown={(e) => e.key === 'Enter' && handleRenameChat(c.id)}
                          autoFocus
                          className="w-full bg-slate-950 border border-indigo-500 text-xs px-2 py-1 rounded text-slate-200 focus:outline-none"
                        />
                      ) : (
                        <>
                          <button onClick={() => { setCurrentChat(c); setIsSidebarOpen(false); }} className={`flex flex-1 items-center gap-2 px-2 py-1.5 rounded-l text-left transition-colors ${currentChat?.id === c.id ? 'bg-slate-800 text-white font-medium border-l border-y border-slate-700' : 'text-slate-400 hover:bg-slate-800/60'}`}>
                            <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                            <span className="truncate flex-1 max-w-[110px]">{c.title}</span>
                          </button>

                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveChatMenuId(activeChatMenuId === c.id ? null : c.id);
                              }}
                              className="p-1.5 text-slate-500 hover:text-white rounded hover:bg-slate-800 transition-colors"
                            >
                              ⋮
                            </button>

                            {activeChatMenuId === c.id && (
                              <div className="absolute right-0 top-6 w-32 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-[100] py-1 animate-fade-in text-xs space-y-0.5">
                                <button onClick={(e) => { e.stopPropagation(); setEditingChatId(c.id); setEditingChatTitle(c.title); setActiveChatMenuId(null); }} className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 flex items-center gap-2">
                                  <span>✏️</span> 重新命名
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setMovingChatId(c.id); setActiveChatMenuId(null); }} className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 flex items-center gap-2">
                                  <span>🚚</span> 移動資料夾
                                </button>
                                <button onClick={(e) => handleDeleteChat(c.id, e)} className="w-full text-left px-3 py-1.5 hover:bg-rose-950/40 text-rose-400 flex items-center gap-2">
                                  <span>🗑️</span> 刪除對話
                                </button>
                              </div>
                            )}
                          </div>
                        </>
                      )}
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
      <main className="flex-1 flex flex-col bg-slate-950 h-full overflow-hidden" onClick={() => setActiveChatMenuId(null)}>
        {currentChat ? (
          <>
            <header className="p-3 md:p-4 border-b border-slate-900 bg-slate-900/30 flex items-center justify-between gap-2 flex-shrink-0">
              <div className="flex items-center gap-3 truncate">
                <button onClick={() => setIsSidebarOpen(true)} className="md:hidden text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
                </button>
                <h3 className="font-semibold text-xs md:text-sm text-slate-200 truncate">{currentChat.title}</h3>
              </div>
              <span className="text-[10px] bg-indigo-950/60 text-indigo-400 px-2 py-0.5 rounded border border-indigo-800/40 flex-shrink-0 font-mono">
                {selectedProvider === 'github' ? `GitHub: ${selectedGithubModel}` : `Gemini: ${selectedGeminiModel}`}
              </span>
            </header>

            <div className="flex-1 h-0 flex flex-row relative">
              <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-6 scrollbar-none pr-10 h-full">
                {currentChat.messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">這是一場全新的對話，選取圖片、原始碼或文字檔開始聊吧。</div>
                ) : (
                  currentChat.messages.map((msg, i) => {
                    const urlRegex = /\[IMAGE_URL:(https:\/\/[\s\S]+?)\]/;
                    const match = msg.content.match(urlRegex);
                    const cleanText = msg.content.replace(urlRegex, '').trim();

                    return (
                      <div key={i} id={`message-node-${i}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group/msg`}>
                        {msg.role === 'user' ? (
                          <div className="max-w-[85%] md:max-w-[75%] rounded-xl px-3.5 py-2 text-sm bg-indigo-600 text-white rounded-br-none shadow-md relative">
                            {editingMessageIndex === i ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editingMessageText}
                                  onChange={(e) => setEditingMessageText(e.target.value)}
                                  className="w-full bg-slate-950 border border-indigo-400 rounded p-2 text-xs text-slate-100 focus:outline-none"
                                  rows={3}
                                />
                                <div className="flex justify-end gap-1.5">
                                  <button onClick={() => setEditingMessageIndex(null)} className="text-[10px] bg-slate-800 px-2 py-1 rounded">取消</button>
                                  <button onClick={() => handleSaveEditedMessage(i)} className="text-[10px] bg-emerald-600 px-2 py-1 rounded font-semibold">儲存並重新發送</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {match && (
                                  <div className="mb-2 max-w-xs overflow-hidden rounded border border-slate-700/50 bg-slate-950/40 p-1">
                                    <img src={match[1]} alt="雲端圖片" className="max-h-40 md:max-h-48 w-auto object-contain rounded" />
                                  </div>
                                )}
                                {cleanText && <div className="whitespace-pre-wrap text-xs md:text-sm prose prose-invert max-w-none"><ReactMarkdown>{cleanText}</ReactMarkdown></div>}
                                
                                <button
                                  onClick={() => { setEditingMessageIndex(i); setEditingMessageText(cleanText); }}
                                  className="opacity-0 group-hover/msg:opacity-100 absolute -left-8 top-2 text-xs text-slate-500 hover:text-indigo-400 transition-opacity p-1"
                                  title="編輯問題並重新生成"
                                >
                                  ✏️
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="w-full rounded-none px-1 py-1 text-slate-200 space-y-3">
                            {cleanText && (
                              <div className="prose prose-invert max-w-none text-slate-200 text-sm md:text-base leading-relaxed space-y-3 prose-headings:font-bold prose-code:bg-slate-900 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-amber-400 prose-pre:bg-slate-900 prose-pre:p-4 prose-pre:rounded-xl">
                                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{cleanText}</ReactMarkdown>
                              </div>
                            )}

                            {i === currentChat.messages.length - 1 && !isSending && (
                              <div className="pt-1">
                                <button
                                  onClick={handleRegenerate}
                                  className="text-[11px] text-slate-400 hover:text-indigo-400 bg-slate-900 hover:bg-slate-800 border border-slate-800 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5"
                                >
                                  <span>🔄</span>
                                  <span>重新生成回應</span>
                                </button>
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
                      <span>✨ AI 正在解構上下文與算式 ({selectedProvider === 'github' ? 'GitHub Models' : 'Gemini Core'})...</span>
                    </div>
                  </div>
                )}

                {apiErrorStatus && (
                  <div className="flex flex-col items-center justify-center p-4 bg-rose-950/20 border border-rose-800/40 rounded-xl space-y-2 animate-fade-in">
                    <p className="text-xs text-rose-400">⚠️ API 響應異常：{apiErrorStatus}</p>
                    <button onClick={handleRegenerate} className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5">
                      <span>🔄</span>
                      <span>點此重新生成</span>
                    </button>
                  </div>
                )}

                <div ref={messagesEndRef} className="h-2 w-full flex-shrink-0" />
              </div>

              {/* 時間軸 */}
              <aside className="hidden sm:flex absolute right-2 top-4 bottom-4 w-4 bg-slate-800/20 backdrop-blur-sm rounded-full flex-col items-center py-4 overflow-y-auto space-y-4 border border-slate-800/40 scrollbar-none z-30">
                {currentChat.messages.map((msg, i) => {
                  if (msg.role !== 'user') return null;
                  const previewText = msg.content.replace(/\[IMAGE_URL:.*\]/g, '').slice(0, 15) || '檔案或問題';
                  return (
                    <button
                      key={i}
                      onClick={() => document.getElementById(`message-node-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                      title={`[問題紀錄] ${previewText}...`}
                      className="w-2.5 h-2.5 rounded-full transition-all duration-200 flex-shrink-0 cursor-pointer hover:scale-150 bg-slate-500 hover:bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.5)]"
                    />
                  );
                })}
              </aside>
            </div>

            {/* 輸入欄 */}
            <form onSubmit={handleSendMessage} className="p-3 md:p-4 border-t border-slate-900 bg-slate-950 flex-shrink-0">
              <div className="max-w-3xl mx-auto space-y-2">
                {isUploadingImage && (
                  <div className="text-xs text-indigo-400 animate-pulse bg-slate-900 p-2 rounded-lg border border-slate-800 w-fit">
                    ⏳ 正在即時壓縮並推送至 Supabase Storage...
                  </div>
                )}

                {attachedImageUrl && (
                  <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-800 w-fit">
                    <img src={attachedImageUrl} alt="預覽" className="w-8 h-8 md:w-10 md:h-10 object-cover rounded border border-slate-700" />
                    <span className="text-[10px] md:text-[11px] text-emerald-400">✓ 圖片已極速壓縮上傳</span>
                    <button type="button" onClick={() => setAttachedImageUrl(null)} className="text-xs text-rose-400 hover:underline ml-2">取消</button>
                  </div>
                )}

                {attachedFileName && (
                  <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-800 w-fit">
                    <span className="text-xl">📄</span>
                    <span className="text-[10px] md:text-[11px] text-indigo-400 font-mono truncate max-w-[180px]">{attachedFileName}</span>
                    <button type="button" onClick={() => { setAttachedFileContent(null); setAttachedFileName(null); }} className="text-xs text-rose-400 hover:underline ml-2">取消</button>
                  </div>
                )}

                <div className="flex gap-2 items-center">
                  <label className="cursor-pointer bg-slate-900 hover:bg-slate-800 border border-slate-800 p-2 rounded-lg flex items-center justify-center transition-colors flex-shrink-0">
                    <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                    <input type="file" accept="image/*,.txt,.py,.cpp,.h,.cs,.java,.js,.ts,.html,.css,.json,.md" onChange={handleUniversalFileChange} className="hidden" disabled={!activeHasCredentials || isSending || isUploadingImage} />
                  </label>

                  <input type="text" placeholder={activeHasCredentials ? "輸入訊息或發送數學物理公式..." : "請先填入專屬 Key / PAT 憑證！"} value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} disabled={!activeHasCredentials || isSending || isUploadingImage} className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-40" />
                  <button type="submit" disabled={(!inputMessage.trim() && !attachedImageUrl && !attachedFileContent) || isSending || !activeHasCredentials || isUploadingImage} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs md:text-sm font-medium px-3 py-1.5 md:px-4 md:py-2 rounded-lg transition-colors disabled:opacity-40 flex-shrink-0">發送</button>
                </div>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center relative">
            <h3 className="text-xs md:text-sm font-medium text-slate-400">請從左側點選資料夾並「+ 新對話」</h3>
          </div>
        )}
      </main>
    </div>
  );
}