import crypto from 'crypto';

const RAW_API_URL = process.env.SHOPEE_API_URL || process.env.SHOPEE_API_HOST || 'https://partner.shopeemobile.com';
const SHOPEE_API_URL = RAW_API_URL.startsWith('http') ? RAW_API_URL : `https://${RAW_API_URL}`;

const partnerId = process.env.SHOPEE_PARTNER_ID ? parseInt(process.env.SHOPEE_PARTNER_ID, 10) : 0;
const partnerKey = process.env.SHOPEE_PARTNER_KEY || '';

function ensureEnv() {
  if (!partnerId || !partnerKey) {
    throw new Error('Faltam variáveis de ambiente: SHOPEE_PARTNER_ID/SHOPEE_PARTNER_KEY');
  }
}

function sign(path: string, timestamp: number): string {
  const base = `${partnerId}${path}${timestamp}`;
  const hmac = crypto.createHmac('sha256', partnerKey);
  hmac.update(base);
  return hmac.digest('hex');
}

export async function exchangeCodeForToken(params: { code: string; shop_id?: number; merchant_id?: number }) {
  ensureEnv();
  const path = '/api/v2/auth/token/get';
  const timestamp = Math.floor(Date.now() / 1000);

  const url = new URL(SHOPEE_API_URL + path);
  url.searchParams.append('partner_id', String(partnerId));
  url.searchParams.append('timestamp', String(timestamp));
  url.searchParams.append('sign', sign(path, timestamp));

  const body: any = { code: params.code, partner_id: partnerId };
  if (params.shop_id) body.shop_id = params.shop_id;
  if (params.merchant_id) body.merchant_id = params.merchant_id;

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Falha ao trocar code por token: HTTP ${res.status} - ${text}`);
  }
  const data = await res.json();
  return data;
}

export async function refreshAccessToken(params: { refresh_token: string; shop_id?: number; merchant_id?: number }) {
  ensureEnv();
  const path = '/api/v2/auth/access_token/refresh';
  const timestamp = Math.floor(Date.now() / 1000);

  const url = new URL(SHOPEE_API_URL + path);
  url.searchParams.append('partner_id', String(partnerId));
  url.searchParams.append('timestamp', String(timestamp));
  url.searchParams.append('sign', sign(path, timestamp));

  const body: any = { refresh_token: params.refresh_token, partner_id: partnerId };
  if (params.shop_id) body.shop_id = params.shop_id;
  if (params.merchant_id) body.merchant_id = params.merchant_id;

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Falha ao atualizar access_token: HTTP ${res.status} - ${text}`);
  }
  const data = await res.json();
  return data;
}
