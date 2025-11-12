import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken } from '@/lib/shopee_oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code') || '';
  const shopId = searchParams.get('shop_id');
  const merchantId = searchParams.get('merchant_id') || searchParams.get('main_account_id');

  if (!code) {
    return NextResponse.json({ ok: false, message: 'Parâmetro "code" ausente.' }, { status: 400 });
  }

  try {
    const resp = await exchangeCodeForToken({
      code,
      shop_id: shopId ? Number(shopId) : undefined,
      merchant_id: merchantId ? Number(merchantId) : undefined,
    });

    // NÃO persisto tokens aqui por segurança. Mostro instruções para configurar envs na Vercel.
    // Você pode adaptar para salvar com segurança em um KV/DB.
    return NextResponse.json({
      ok: true,
      hint: 'Copie access_token/refresh_token para as variáveis de ambiente na Vercel com segurança.',
      payload: resp,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
