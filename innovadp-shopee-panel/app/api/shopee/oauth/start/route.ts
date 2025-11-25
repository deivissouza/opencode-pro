import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const BASE = process.env.SHOPEE_API_URL || 'https://partner.shopeemobile.com';
const partnerId = process.env.SHOPEE_PARTNER_ID ? parseInt(process.env.SHOPEE_PARTNER_ID, 10) : 0;
const partnerKey = process.env.SHOPEE_PARTNER_KEY || '';

function sign(path: string, timestamp: number): string {
  const base = `${partnerId}${path}${timestamp}`;
  const hmac = crypto.createHmac('sha256', partnerKey);
  hmac.update(base);
  return hmac.digest('hex');
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    if (!partnerId || !partnerKey) {
      return NextResponse.json({ ok: false, message: 'Configure SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY no ambiente.' }, { status: 500 });
    }

    const target = (req.nextUrl.searchParams.get('target') || 'shop').toLowerCase();
    const state = req.nextUrl.searchParams.get('state') || '';
    const path = target === 'merchant' ? '/api/v2/merchant/auth_partner' : '/api/v2/shop/auth_partner';
    const ts = Math.floor(Date.now() / 1000);

    const callback = new URL('/api/shopee/oauth/callback', req.nextUrl.origin);
    if (state) callback.searchParams.set('state', state);

    const url = new URL(BASE + path);
    url.searchParams.set('partner_id', String(partnerId));
    url.searchParams.set('redirect', callback.toString());
    url.searchParams.set('timestamp', String(ts));
    url.searchParams.set('sign', sign(path, ts));

    return NextResponse.redirect(url.toString());
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
