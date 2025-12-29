import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://frwkaysiysknenfthauo.supabase.co';
const supabaseAnonKey = 'sb_publishable_aV19W7-xDXF6zuPrBgayKQ_yB3qHPoB';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);