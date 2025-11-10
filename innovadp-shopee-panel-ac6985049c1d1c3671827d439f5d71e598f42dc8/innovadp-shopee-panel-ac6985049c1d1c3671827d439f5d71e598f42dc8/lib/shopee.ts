import crypto from 'crypto';
import { getCache, setCache, delCache } from './cache';
import { refreshAccessToken } from './shopee_oauth';

// --- INÃCIO: ConfiguraÃ§Ã£o das VariÃ¡veis de Ambiente ---
// Crie um arquivo .env.local na raiz do projeto e adicione estas variÃ¡veis
const partnerId = process.env.SHOPEE_PARTNER_ID ? parseInt(process.env.SHOPEE_PARTNER_ID, 10) : 0;
const partnerKey = process.env.SHOPEE_PARTNER_KEY || '';
const shopId = process.env.SHOPEE_SHOP_ID ? parseInt(process.env.SHOPEE_SHOP_ID, 10) : 0;
let volatileAccessToken = process.env.SHOPEE_ACCESS_TOKEN || '';
const refreshToken = process.env.SHOPEE_REFRESH_TOKEN || '';
// --- FIM: ConfiguraÃ§Ã£o das VariÃ¡veis de Ambiente ---

const RAW_API_URL = process.env.SHOPEE_API_URL || process.env.SHOPEE_API_HOST || 'https://partner.shopeemobile.com';
const SHOPEE_API_URL = RAW_API_URL.startsWith('http') ? RAW_API_URL : `https://${RAW_API_URL}`;

function ensureEnvConfigured() {
  const missing: string[] = [];
  if (!partnerId || Number.isNaN(partnerId) || partnerId <= 0) missing.push('SHOPEE_PARTNER_ID');
  if (!partnerKey) missing.push('SHOPEE_PARTNER_KEY');
  if (!shopId || Number.isNaN(shopId) || shopId <= 0) missing.push('SHOPEE_SHOP_ID');
  if (!volatileAccessToken) missing.push('SHOPEE_ACCESS_TOKEN');
  if (missing.length) {
    throw new Error(`VariÃ¡veis de ambiente ausentes: ${missing.join(', ')}. Configure seu .env.local.`);
  }
}

/**
 * Gera a assinatura HMAC-SHA256 necessÃ¡ria para as chamadas da API Shopee.
 * @param path O caminho do endpoint da API (ex: /api/v2/order/get_order_list)
 * @param timestamp O timestamp da requisiÃ§Ã£o.
 * @param withToken Se a assinatura deve incluir o access_token e shop_id.
 * @returns A assinatura em formato hexadecimal.
 */
function sign(path: string, timestamp: number, withToken: boolean): string {
  let baseString = `${partnerId}${path}${timestamp}`;
  if (withToken) {
    baseString += `${volatileAccessToken}${shopId}`;
  }
  
  const hmac = crypto.createHmac('sha256', partnerKey);
  hmac.update(baseString);
  return hmac.digest('hex');
}

async function tryRefreshTokenIfNeeded(originalUrl: URL, lastPayload?: any) {
  // Detecta token expirado/ invÃ¡lido por status ou por payload com erro
  const looksExpired = !!lastPayload && (lastPayload.error || lastPayload.message) &&
    (String((lastPayload?.error ?? '') + ' ' + (lastPayload?.message ?? '')).toLowerCase().includes('access_token') || String((lastPayload?.error ?? '') + ' ' + (lastPayload?.message ?? '')).toLowerCase().includes('acceess_token') || (String((lastPayload?.error ?? '') + ' ' + (lastPayload?.message ?? '')).toLowerCase().includes('access') && String((lastPayload?.error ?? '') + ' ' + (lastPayload?.message ?? '')).toLowerCase().includes('token')));
  if (!looksExpired) return null;
  if (!refreshToken) {
    console.warn('[Shopee] Access token possivelmente invÃ¡lido e SHOPEE_REFRESH_TOKEN nÃ£o estÃ¡ configurado.');
    return null;
  }
  try {
    const resp = await refreshAccessToken({ refresh_token: refreshToken, shop_id: shopId });
    const newToken = resp?.response?.access_token || resp?.access_token;
    if (!newToken) {
      console.warn('[Shopee] Falha ao atualizar access_token. Payload:', resp);
      return null;
    }
    volatileAccessToken = newToken;
    // Atualiza access_token na URL e retorna uma nova resposta
    originalUrl.searchParams.set('access_token', volatileAccessToken);
    const retry = await fetch(originalUrl.toString(), { method: 'GET' });
    return retry;
  } catch (e) {
    console.error('[Shopee] Erro no refresh do access_token:', e);
    return null;
  }
}

/**
 * Busca uma lista de pedidos na Shopee com base em um perÃ­odo e status.
 */
export async function getOrders(options: { from: number; to: number; status: string; pageSize?: number }) {
  ensureEnvConfigured();
  const path = '/api/v2/order/get_order_list';
  const pageSize = Math.min(options.pageSize || 100, 100);

  const buildUrl = (cursor?: string) => {
    const ts = Math.floor(Date.now() / 1000);
    const u = new URL(SHOPEE_API_URL + path);
    u.searchParams.append('partner_id', String(partnerId));
    u.searchParams.append('timestamp', String(ts));
    u.searchParams.append('access_token', volatileAccessToken);
    u.searchParams.append('shop_id', String(shopId));
    u.searchParams.append('sign', sign(path, ts, true));
    u.searchParams.append('time_range_field', 'update_time');
    u.searchParams.append('time_from', String(options.from));
    u.searchParams.append('time_to', String(options.to));
    u.searchParams.append('order_status', options.status);
    u.searchParams.append('page_size', String(pageSize));
    u.searchParams.append('response_optional_fields', 'order_status');
    if (cursor) u.searchParams.append('cursor', cursor);
    return u;
  };

  const all: any[] = [];
  const maxTotal = 500; // limite de seguranÃ§a
  let cursor: string | undefined = undefined;
  let guard = 0;
  while (true) {
    const url = buildUrl(cursor);
    let response = await fetch(url.toString(), { method: 'GET' });
    let data = await response.json();
    if (!response.ok) {
      const retry = await tryRefreshTokenIfNeeded(url, data);
      if (retry) {
        response = retry;
        if (!response.ok) {
          console.error('Shopee API Error (getOrders) retry:', await response.text());
          throw new Error('Falha ao buscar lista de pedidos da Shopee.');
      }
      data = await response.json();
    } else {
      console.error('Shopee API Error (getOrders):', data);
      throw new Error('Falha ao buscar lista de pedidos da Shopee.');
    }
    }
    // Trata caso 200 com erro de access_token
    if (data?.error && (String((data.error || '') + ' ' + (data.message || '')).toLowerCase().includes('access_token') || String((data.error || '') + ' ' + (data.message || '')).toLowerCase().includes('acceess_token') || (String((data.error || '') + ' ' + (data.message || '')).toLowerCase().includes('access') && String((data.error || '') + ' ' + (data.message || '')).toLowerCase().includes('token')))) {
      const retry2 = await tryRefreshTokenIfNeeded(url, data);
      if (retry2) {
        if (!retry2.ok) {
          console.error('Shopee API Error (getOrders) retry 200/error:', await retry2.text());
          throw new Error('Falha ao buscar lista de pedidos da Shopee.');
        }
        data = await retry2.json();
      } else {
        console.error('Shopee API Error (getOrders) 200/error:', data);
        throw new Error('Falha ao buscar lista de pedidos da Shopee.');
      }
    }
    if (data.error) {
      console.error('Shopee API Logic Error (getOrders):', data);
      throw new Error(`Erro da Shopee: ${data.message}`)
    }

    const resp = data.response || data;
    const list = resp.order_list || [];
    all.push(...list);
    const hasMore = Boolean(resp.more ?? resp.has_more);
    const nextCursor = resp.next_cursor || resp.next || undefined;
    if (!hasMore || !nextCursor || all.length >= maxTotal || ++guard > 10) break;
    cursor = String(nextCursor);
  }

  return all;
}

/**
 * Busca os detalhes de um ou mais pedidos.
 */
export async function getOrderDetails(orderSnList: string[]) {
  ensureEnvConfigured();
  const path = '/api/v2/order/get_order_detail';
  const timestamp = Math.floor(Date.now() / 1000);

  const url = new URL(SHOPEE_API_URL + path);
  url.searchParams.append('partner_id', String(partnerId));
  url.searchParams.append('timestamp', String(timestamp));
  url.searchParams.append('access_token', volatileAccessToken);
  url.searchParams.append('shop_id', String(shopId));
  url.searchParams.append('sign', sign(path, timestamp, true));
  
  url.searchParams.append('order_sn_list', orderSnList.join(','));
  // Campos que queremos de volta
  url.searchParams.append(
    'response_optional_fields',
    'item_list,recipient_address,buyer_user_id,buyer_username,order_sn,total_amount,update_time,create_time'
  );

  let response = await fetch(url.toString(), { method: 'GET' });
  let data = await response.json();
  if (!response.ok) {
    const retry = await tryRefreshTokenIfNeeded(url, data);
    if (retry) {
      response = retry;
      if (!response.ok) {
        console.error('Shopee API Error (getOrderDetails) retry:', await response.text());
        throw new Error('Falha ao buscar detalhes do pedido da Shopee.');
      }
      data = await response.json();
    } else {
      console.error('Shopee API Error (getOrderDetails):', data);
      throw new Error('Falha ao buscar detalhes do pedido da Shopee.');
    }
  }
  // Trata caso 200 com erro de access_token
  if (data?.error && (String((data.error || '') + ' ' + (data.message || '')).toLowerCase().includes('access_token') || String((data.error || '') + ' ' + (data.message || '')).toLowerCase().includes('acceess_token') || (String((data.error || '') + ' ' + (data.message || '')).toLowerCase().includes('access') && String((data.error || '') + ' ' + (data.message || '')).toLowerCase().includes('token')))) {
    const retry2 = await tryRefreshTokenIfNeeded(url, data);
    if (retry2) {
      if (!retry2.ok) {
        console.error('Shopee API Error (getOrderDetails) retry 200/error:', await retry2.text());
        throw new Error('Falha ao buscar detalhes do pedido da Shopee.');
      }
      data = await retry2.json();
    } else {
      console.error('Shopee API Error (getOrderDetails) 200/error:', data);
      throw new Error('Falha ao buscar detalhes do pedido da Shopee.');
    }
  }
  if (data.error) {
     console.error('Shopee API Logic Error (getOrderDetails):', data);
     throw new Error(`Erro da Shopee: ${data.message}`)
  }
  return data.response.order_list;
}

/**
 * Encontra um pedido especÃ­fico pelo seu cÃ³digo (order_sn).
 * OBS: O cÃ³digo da etiqueta da Shopee geralmente Ã© o order_sn.
 * Se o cÃ³digo lido for outro, a lÃ³gica de busca precisa ser adaptada aqui.
 */
export async function findOrderByCode(code: string) {
  ensureEnvConfigured();
  // Busca nos pedidos atualizados nos Ãºltimos 7 dias. Ajuste se necessÃ¡rio.
  const to = Math.floor(Date.now() / 1000);
  const from = to - (7 * 24 * 60 * 60);

  // Primeiro, tentamos buscar diretamente pelo order_sn
  try {
    const orderDetails = await getOrderDetails([code]);
    if (orderDetails && orderDetails.length > 0) {
      return orderDetails[0];
    }
  } catch (e) {
    console.log(`NÃ£o foi possÃ­vel buscar o pedido ${code} diretamente, tentando na lista...`);
  }

  // Se a busca direta falhar (pode acontecer), procuramos na lista de pedidos.
  // Isso Ã© um fallback, a busca direta Ã© mais eficiente.
  const orders = await getOrders({ from, to, status: 'READY_TO_SHIP' });
  const foundOrder = orders.find((order: any) => order.order_sn === code);

  if (foundOrder) {
    const details = await getOrderDetails([foundOrder.order_sn]);
    return details[0];
  }

  return null;
}

/**
 * Calcula as estatÃ­sticas de pedidos do dia.
 */
export async function getTodayStats() {
  ensureEnvConfigured();
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  
  const from = Math.floor(midnight.getTime() / 1000);
  const to = Math.floor(now.getTime() / 1000);

  const cacheKey = `today-stats:${shopId}:${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const cached = getCache<any>(cacheKey);
  if (cached) {
    return cached;
  }

  // Shopee limita page_size <= 100
  const orders = await getOrders({ from, to, status: 'READY_TO_SHIP', pageSize: 100 });

  if (!orders || orders.length === 0) {
    const empty = { totalOrders: 0, totalValue: 0, orders: [], perHour: [] };
    setCache(cacheKey, empty, 15_000);
    return empty;
  }

  const orderSnList = orders.map((order: any) => order.order_sn);
  const detailedOrders = await getOrderDetails(orderSnList);

  let totalValue = 0;
  detailedOrders.forEach((order: any) => {
    totalValue += Number(order.total_amount) || 0;
  });

  const hoursCount = new Array(24).fill(0);
  const hoursValue = new Array(24).fill(0);
  detailedOrders.forEach((order: any) => {
    const ts = Number(order.update_time || order.create_time);
    if (!ts) return;
    const d = new Date(ts * 1000);
    const hour = d.getHours();
    if (hour >= 0 && hour < 24) {
      hoursCount[hour] += 1;
      hoursValue[hour] += Number(order.total_amount) || 0;
    }
  });
  const perHour = hoursCount.map((count, hour) => ({ hour, orders: count, value: hoursValue[hour] }));

  const result = {
    totalOrders: detailedOrders.length,
    totalValue,
    orders: detailedOrders.map((o: any) => ({ // Lista simplificada
        order_sn: o.order_sn,
        buyer: o.buyer_username,
        items_count: o.item_list.length
    })),
    perHour,
  };
  setCache(cacheKey, result, 15_000);
  return result;
}

export function invalidateTodayStatsCache() {
  const now = new Date();
  const cacheKey = `today-stats:${shopId}:${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  delCache(cacheKey);
}


