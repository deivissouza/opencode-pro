import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = process.env;

  const payload = {
    node_env: env.NODE_ENV || null,
    vercel_env: env.VERCEL_ENV || null,
    // Shopee keys (somente flags, sem valores)
    has_SHOPEE_API_HOST: Boolean(env.SHOPEE_API_HOST),
    has_SHOPEE_PARTNER_ID: Boolean(env.SHOPEE_PARTNER_ID),
    has_SHOPEE_PARTNER_KEY: Boolean(env.SHOPEE_PARTNER_KEY),
    has_SHOPEE_SHOP_ID: Boolean(env.SHOPEE_SHOP_ID),
    has_SHOPEE_PUSH_PARTNER_KEY: Boolean(env.SHOPEE_PUSH_PARTNER_KEY),
    // Supabase (token store)
    has_SUPABASE_URL: Boolean(env.SUPABASE_URL),
    has_SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    // Detectar variáveis públicas configuradas erroneamente
    has_NEXT_PUBLIC_SUPABASE_URL: Boolean(env.NEXT_PUBLIC_SUPABASE_URL),
    has_NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };

  return NextResponse.json({ ok: true, payload });
}
