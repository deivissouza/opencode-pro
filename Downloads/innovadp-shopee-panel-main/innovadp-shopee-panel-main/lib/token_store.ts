import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tokenTable = process.env.SHOPEE_TOKEN_TABLE || 'shopee_tokens';
const tokenId = process.env.SHOPEE_TOKEN_ID || 'default';

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
    : null;

type TokenRecord = {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
};

export async function getStoredTokens(): Promise<TokenRecord | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from(tokenTable)
      .select('access_token, refresh_token, expires_at')
      .eq('id', tokenId)
      .maybeSingle();
    if (error) {
      console.error('[Supabase] Erro ao buscar tokens:', error);
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.error('[Supabase] Exceção ao buscar tokens:', err);
    return null;
  }
}

export async function saveTokens(tokens: TokenRecord) {
  if (!supabase) return;
  try {
    const payload = {
      id: tokenId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: tokens.expires_at ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from(tokenTable).upsert(payload, { onConflict: 'id' });
    if (error) {
      console.error('[Supabase] Erro ao salvar tokens:', error);
    }
  } catch (err) {
    console.error('[Supabase] Exceção ao salvar tokens:', err);
  }
}
