import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mask(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

export async function GET() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const shopId = Number(process.env.SHOPEE_SHOP_ID || 0);

  if (!url || !key) {
    return NextResponse.json(
      {
        ok: false,
        error: "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes no runtime",
      },
      { status: 500 },
    );
  }

  if (!shopId) {
    return NextResponse.json(
      {
        ok: false,
        error: "SHOPEE_SHOP_ID ausente ou inválido",
      },
      { status: 500 },
    );
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Confere se a tabela existe e se há registro
  const { data, error } = await supabase
    .from("tokens_shopee")
    .select("shop_id, access_token, refresh_token, reauth_required, updated_at")
    .eq("shop_id", shopId)
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      {
        ok: false,
        found: false,
        hint: "Nenhum registro em tokens_shopee para esse shop_id",
      },
      { status: 404 },
    );
  }

  const accessToken = data.access_token ?? "";
  const refreshToken = data.refresh_token ?? "";

  return NextResponse.json({
    ok: true,
    found: true,
    shop_id: data.shop_id,
    reauth_required: data.reauth_required ?? null,
    updated_at: data.updated_at ?? null,
    access_token_len: accessToken.length || 0,
    refresh_token_len: refreshToken.length || 0,
    // máscaras apenas para confirmar que existe conteúdo
    access_token_preview: mask(accessToken),
    refresh_token_preview: mask(refreshToken),
  });
}
