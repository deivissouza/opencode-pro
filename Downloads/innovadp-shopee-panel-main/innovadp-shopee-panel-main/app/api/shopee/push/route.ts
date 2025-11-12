import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { invalidateTodayStatsCache, getTodayStats } from '@/lib/shopee';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Lê variáveis sensíveis do ambiente
// Preferir uma chave dedicada para Push, se existir
const partnerKey = process.env.SHOPEE_PUSH_PARTNER_KEY || process.env.SHOPEE_PARTNER_KEY || '';

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export async function POST(request: NextRequest) {
  try {
    // Leia o corpo como bytes crus para assinar corretamente
    const rawBuf = Buffer.from(await request.arrayBuffer());
    const rawText = rawBuf.toString('utf8');

    // Extraia a assinatura enviada (aceita diversos headers)
    const authRaw =
      request.headers.get('x-shopee-signature') ||
      request.headers.get('x-shopee-signature-256') ||
      request.headers.get('authorization') ||
      '';
    // Remova possíveis prefixos (ex.: "Bearer ..." ou "SHA256=...")
    const auth = (authRaw || '')
      .replace(/^Bearer\s+/i, '')
      .replace(/^\s*[A-Za-z0-9_\-]+=\s*/i, '')
      .trim();

    // Tente parsear JSON independentemente do content-type (alguns envios vem com applicationjson)
    let payload: any = undefined;
    try { payload = JSON.parse(rawText); } catch {}

    // Verificação HMAC-SHA256 sobre os BYTES crus do corpo
    let verified = false;
    if (partnerKey && auth) {
      const digest = crypto.createHmac('sha256', partnerKey).update(rawBuf).digest();
      const hex = digest.toString('hex');
      const b64 = digest.toString('base64');
      if (safeEqual(auth.toLowerCase(), hex.toLowerCase()) || safeEqual(auth, b64)) {
        verified = true;
      }
    }

    const summary = payload ? {
      code: payload.code ?? payload.push_code ?? payload.type ?? payload.action ?? null,
      action: payload.action ?? null,
      order_sn: payload?.data?.ordersn ?? payload.order_sn ?? payload.order_sn_list?.[0] ?? null,
      tracking_no: payload?.data?.tracking_no ?? payload.waybill ?? null,
      item_id: payload.item_id ?? payload.item?.item_id ?? null,
      shop_id: payload.shop_id ?? null,
      status: payload?.data?.status ?? payload.status ?? payload.order_status ?? null,
      ts: payload?.data?.update_time ?? payload.update_time ?? payload.create_time ?? null,
    } : undefined;

    // Handshake de verificação da Shopee
    if (payload && (payload.code === 0 || payload?.data?.verify_info)) {
      return new Response('success', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Invalidar e pré-aquecer métricas ao receber eventos de pedido
    if (payload) {
      const code = summary?.code;
      const hasOrder = !!summary?.order_sn || Array.isArray(payload.order_sn_list);
      if (
        hasOrder ||
        code === 'order_status_push' ||
        code === 3 ||
        code === '3'
      ) {
        try {
          invalidateTodayStatsCache();
          // Pré-aquecer de forma assíncrona (não bloqueia a resposta)
          getTodayStats().catch(() => {});
        } catch {}
      }
    }

    console.log('[Shopee Push] headers:', Object.fromEntries(request.headers.entries()));
    console.log('[Shopee Push] verified:', verified);
    if (summary) console.log('[Shopee Push] summary:', summary);
    console.log('[Shopee Push] payload:', payload ?? rawText);

    // Importante: responder rapidamente 200 para evitar reentregas
    return NextResponse.json({ ok: true, verified, summary }, { status: 200 });
  } catch (err) {
    console.error('[Shopee Push] erro ao processar push', err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

export async function GET() {
  // Endpoint saudável para validação rápida
  return NextResponse.json({ ok: true });
}
