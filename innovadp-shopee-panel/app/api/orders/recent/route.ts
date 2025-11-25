import { NextRequest, NextResponse } from 'next/server';
import { getOrders } from '@/lib/shopee';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AnyObj = Record<string, any>;

function extractOrders(payload: any): AnyObj[] {
  return (
    payload?.response?.order_list ||
    payload?.response?.orders ||
    payload?.data?.orders ||
    payload?.orders ||
    []
  );
}

function parseStatuses(input?: string | null): string[] {
  const full = [
    'UNPAID',
    'READY_TO_SHIP',
    'PROCESSED',
    'RETRY_SHIP',
    'SHIPPED',
    'TO_CONFIRM_RECEIVE',
    'TO_RETURN',
    'IN_CANCEL',
    'CANCELLED',
    'RETURNED',
    'COMPLETED',
  ];

  if (!input || !input.trim()) {
    const raw = process.env.SCAN_ORDER_STATUSES || full.join(',');
    return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  }
  if (input.toLowerCase() === 'all') {
    return full;
  }
  return input
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function toInt(val: string | null, def: number, min: number, max: number) {
  const n = val ? parseInt(val, 10) : def;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

async function shopeeFetch(
  path: string,
  params: Record<string, any> = {}
) {
  const partnerId = process.env.SHOPEE_PARTNER_ID || '';
  const partnerKey = process.env.SHOPEE_PARTNER_KEY || '';
  const shopId = process.env.SHOPEE_SHOP_ID || '';
  const apiHost = process.env.SHOPEE_API_URL || 'https://partner.shopeemobile.com';
  const accessToken = process.env.SHOPEE_ACCESS_TOKEN || '';

  const timestamp = Math.floor(Date.now() / 1000);

  const search = new URLSearchParams();
  search.set('partner_id', partnerId);
  search.set('shop_id', shopId);
  search.set('timestamp', String(timestamp));
  if (accessToken) search.set('access_token', accessToken);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) search.set(k, String(v));
  }

  const signBase = `${partnerId}${path}${timestamp}${shopId}`;
  const sign = await hmacSha256Hex(partnerKey, signBase);
  search.set('sign', sign);

  const url = `${apiHost}${path}?${search.toString()}`;
  const res = await fetch(url);
  return res.json();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const statuses = parseStatuses(searchParams.get('status'));
    const limit = toInt(searchParams.get('limit'), 10, 1, 200);
    const pageSize = toInt(searchParams.get('pageSize'), 100, 1, 100);

    const all: AnyObj[] = [];
    // Primeiro, tenta via helper getOrders (rápida)
    try {
      for (const status of statuses) {
        const res = await getOrders(status, pageSize);
        const list = extractOrders(res).map((o: AnyObj) => ({ ...o, _statusFromQuery: status }));
        all.push(...list);
      }
    } catch {}

    // Se vazio, tenta via chamada direta com janela temporal
    if (all.length === 0) {
      const days = toInt(searchParams.get('days'), 30, 1, 365);
      const now = Math.floor(Date.now() / 1000);
      const from = now - days * 86400;
      const maxPages = toInt(searchParams.get('maxPages'), Number(process.env.SHOPEE_MAX_ORDER_PAGES || '5'), 1, 100);

      for (const status of statuses) {
        for (const field of ['update_time','create_time']) {
          let cursor: string | undefined;
          let page = 0;
          do {
            const res = await shopeeFetch('/api/v2/order/get_order_list', {
              order_status: status,
              page_size: pageSize,
              cursor,
              time_from: from,
              time_to: now,
              time_range_field: field,
            });
            const list = extractOrders(res).map((o: AnyObj) => ({ ...o, _statusFromQuery: status }));
            all.push(...list);
            cursor = res?.response?.next_cursor;
            page++;
          } while (cursor && page < maxPages && all.length < limit);
          if (all.length >= limit) break;
        }
        if (all.length >= limit) break;
      }
    }

    const seen = new Set<string>();
    const uniq: AnyObj[] = [];
    for (const o of all) {
      const key = String(o.order_sn || o.orderid || '')
        .trim()
        .toUpperCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      uniq.push(o);
    }

    uniq.sort((a, b) => {
      const ax = Number(a.update_time || a.create_time || 0);
      const bx = Number(b.update_time || b.create_time || 0);
      return bx - ax;
    });

    const pickFields = (o: AnyObj) => ({
      order_sn: o.order_sn,
      order_status: o.order_status,
      buyer_username: o.buyer_username,
      tracking_number: o.tracking_number,
      shipping_carrier: o.shipping_carrier,
      create_time: o.create_time,
      update_time: o.update_time,
      _from_status_query: o._statusFromQuery,
    });

    const result = uniq.slice(0, limit).map(pickFields);

    return NextResponse.json({ ok: true, statuses, limit, count: result.length, orders: result });
  } catch (err) {
    console.error('[API /orders/recent Error]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown_error' },
      { status: 500 }
    );
  }
}
