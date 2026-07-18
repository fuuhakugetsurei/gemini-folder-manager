import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('請確認 .env.local 中的 Supabase 環境變數已正確設定！');
}

// 建立並匯出給全域使用的 Supabase 客戶端
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export interface Folder {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  messages: any[];
  created_at: string;
  updated_at: string;
}