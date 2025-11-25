// lib/shopee.ts — versão corrigida 100% compatível com Vercel Edge

import { getCache, setCache, delCache } from "./cache";
import { kv } from "./redis";

/* -------------------------------------------------------
|  Util: HMAC SHA256 (WebCrypto, compatível com Vercel Edge)
--------------------------------------------------------*/
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(message)
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* -------------------------------------------------------
|  ENV VARS
--------------------------------------------------------*/
const partnerId = process.env.SHOPEE_PARTNER_ID || "";
const partnerKey = process.env.SHOPEE_PARTNER_KEY || "";
const shopId = process.env.SHOPEE_SHOP_ID || "";
const apiHost = process.env.SHOPEE_API_URL || "https://partner.shopeemobile.com";

const TODAY_STATS_CACHE_KEY = "shopee:today-stats";
const TODAY_STATS_CACHE_MS = Number(process.env.TODAY_STATS_CACHE_MS ?? 60_000);
const MAX_ORDER_PAGES = Number(process.env.SHOPEE_MAX_ORDER_PAGES ?? 5);

const KV_ACCESS_TOKEN_KEY = "shopee:access_token";
const KV_REFRESH_TOKEN_KEY = "shopee:refresh_token";

// Cache local para evitar chamadas excessivas ao Redis em uma mesma execução
let localAccessToken = process.env.SHOPEE_ACCESS_TOKEN || "";
let localRefreshToken = process.env.SHOPEE_REFRESH_TOKEN || "";

/* -------------------------------------------------------
| Tipos
--------------------------------------------------------*/
export type TodayStats = {
  totalOrders: number;
  totalValue: number;
  perHour?: { hour: number; orders: number; value: number }[];
};

type ShopeeOrder = Record<string, any>;
type OrderListOptions = {
  status?: string;
  pageSize?: number;
  cursor?: string;
  timeFrom?: number;
  timeTo?: number;
  timeRangeField?: string;
};

/* -------------------------------------------------------
| Validar ENV obrigatórias
--------------------------------------------------------*/
async function getStoredAccessToken() {
  if (localAccessToken) return localAccessToken;
  try {
    const fromKv = await kv.get<string>(KV_ACCESS_TOKEN_KEY);
    if (fromKv) {
      localAccessToken = fromKv;
      return fromKv;
    }
  } catch (e) {
    console.error("Erro ao ler token do KV:", e);
  }
  return "";
}

async function getStoredRefreshToken() {
  if (localRefreshToken) return localRefreshToken;
  try {
    const fromKv = await kv.get<string>(KV_REFRESH_TOKEN_KEY);
    if (fromKv) {
      localRefreshToken = fromKv;
      return fromKv;
    }
  } catch (e) {
    console.error("Erro ao ler refresh token do KV:", e);
  }
  return "";
}

async function ensureBaseEnv(requireAccessToken = true) {
  const missing: string[] = [];
  if (!partnerId) missing.push("SHOPEE_PARTNER_ID");
  if (!partnerKey) missing.push("SHOPEE_PARTNER_KEY");
  if (!shopId) missing.push("SHOPEE_SHOP_ID");
  if (!apiHost) missing.push("SHOPEE_API_HOST");

  if (requireAccessToken) {
    const token = await getStoredAccessToken();
    if (!token) missing.push("SHOPEE_ACCESS_TOKEN (KV ou ENV)");
  }

  // Refresh token é necessário para renovação, mas pode não estar no ENV se estiver no KV
  if (!localRefreshToken) {
    const rToken = await getStoredRefreshToken();
    if (!rToken) missing.push("SHOPEE_REFRESH_TOKEN (KV ou ENV)");
  }

  if (missing.length) {
    throw new Error("Variáveis de ambiente ausentes: " + missing.join(", "));
  }
}

/* -------------------------------------------------------
| Shopee Fetch — CORRIGIDO PARA LIVE
| Assinatura:
|   SIGN = HMAC_SHA256(partner_id + path + timestamp + shop_id)
| NUNCA inclui access_token
--------------------------------------------------------*/
async function shopeeFetch(path: string, params: Record<string, any> = {}) {
  await ensureBaseEnv();

  const timestamp = Math.floor(Date.now() / 1000);
  const accessToken = await getStoredAccessToken();

  const query = new URLSearchParams();
  query.set("partner_id", partnerId);
  query.set("shop_id", shopId);
  query.set("timestamp", String(timestamp));

  if (accessToken) query.set("access_token", accessToken);

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) query.set(k, String(v));
  }

  // Shopee V2 Shop API Signature: partner_id + path + timestamp + access_token + shop_id
  let signBase = `${partnerId}${path}${timestamp}`;
  if (accessToken) {
    signBase += `${accessToken}${shopId}`;
  } else {
    if (shopId) signBase += `${shopId}`;
  }

  const sign = await hmacSha256Hex(partnerKey, signBase);

  query.set("sign", sign);

  const url = `${apiHost}${path}?${query.toString()}`;

  console.log(`[ShopeeFetch] Request: ${path}`);
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    console.error(`[ShopeeFetch] Error ${res.status}: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return { error: "network_error", message: text };
    }
  }

  return res.json();
}

/* -------------------------------------------------------
| Shopee Fetch com Auto-Refresh
| Wrapper que automaticamente renova o token e tenta novamente
--------------------------------------------------------*/
async function shopeeFetchWithAutoRefresh(path: string, params: Record<string, any> = {}) {
  const res = await shopeeFetch(path, params);

  // Se o token expirou, renova e tenta novamente
  const errorMsg = String(res?.error ?? res?.message ?? "").toLowerCase();
  if (errorMsg.includes("access_token") || errorMsg.includes("invalid")) {
    console.warn("[ShopeeFetch] Token expirado - renovando automaticamente");
    await tryRefreshTokenIfNeeded(res);
    // Tenta novamente com o token renovado
    return shopeeFetch(path, params);
  }

  return res;
}

/* -------------------------------------------------------
| Funções Auxiliares
--------------------------------------------------------*/
function extractOrders(payload: any): ShopeeOrder[] {
  return (
    payload?.response?.order_list ||
    payload?.response?.orders ||
    payload?.data?.orders ||
    payload?.orders ||
    []
  );
}

function sanitize(v: any) {
  return String(v ?? "").trim().replace(/[#\s]+/g, "").toUpperCase();
}

const BRAZIL_TRACKING_REGEX = /^BR[A-Z0-9]{8,}$/i;

function extractOrderValue(order: ShopeeOrder): number {
  const items = order.item_list ?? order.items ?? [];
  let total = 0;

  for (const item of items) {
    const price =
      Number(item.model_discounted_price) ||
      Number(item.model_original_price) ||
      Number(item.item_price) ||
      0;

    const qty =
      Number(item.model_quantity_purchased) ||
      Number(item.quantity_purchased) ||
      1;

    total += price * qty;
  }

  return total;
}

function getStatusList() {
  const raw = process.env.SCAN_ORDER_STATUSES || "READY_TO_SHIP,PROCESSED,SHIPPED,COMPLETED";
  return raw.split(",").map((s) => s.trim().toUpperCase());
}

async function fetchOrderList(o: OrderListOptions) {
  const params: Record<string, string> = {};
  if (o.status) params.order_status = o.status;
  if (o.pageSize) params.page_size = String(o.pageSize);
  if (o.cursor) params.cursor = o.cursor;
  if (o.timeFrom) params.time_from = String(o.timeFrom);
  if (o.timeTo) params.time_to = String(o.timeTo);
  if (o.timeRangeField) params.time_range_field = o.timeRangeField;

  return shopeeFetchWithAutoRefresh("/api/v2/order/get_order_list", params);
}

async function fetchOrderDetail(orderSn: string, fields: string[] = []) {
  const params: Record<string, string> = {
    order_sn_list: orderSn,
  };

  if (fields.length) params.response_optional_fields = fields.join(",");

  return shopeeFetchWithAutoRefresh("/api/v2/order/get_order_detail", params);
}

/* -------------------------------------------------------
| Buscar pedido por código
--------------------------------------------------------*/
const ORDER_FIELDS = [
  'buyer_user_id',
  'buyer_username',
  'estimated_shipping_fee',
  'recipient_address',
  'actual_shipping_fee',
  'goods_to_declare',
  'note',
  'pay_time',
  'payment_method',
  'pickup_done_time',
  'shipping_carrier',
  'currency',
  'return_order_sn_list',
  'item_list',
  'invoice_data',
  'checkout_shipping_carrier',
  'reverse_shipping_fee',
  'order_status',
  'tracking_number'
];

export async function findOrderByCode(raw: string) {
  console.log(`[findOrderByCode] Iniciando busca para: ${raw}`);
  const code = sanitize(raw);
  console.log(`[findOrderByCode] Código sanitizado: ${code}`);
  if (!code) return null;

  // Tenta direto por order_sn
  const direct = await fetchOrderDetail(code, ORDER_FIELDS);
  if (extractOrders(direct).length > 0) return extractOrders(direct)[0];

  // Tracking BR
  if (BRAZIL_TRACKING_REGEX.test(code)) {
    const byTracking = await searchOrderInStatuses(code);
    if (byTracking) return byTracking;
  }

  return searchOrderInStatuses(code);
}

function getLookbackDays() {
  return Number(process.env.SHOPEE_ORDER_LOOKBACK_DAYS ?? 30);
}

async function searchOrderInStatuses(code: string) {
  const now = Math.floor(Date.now() / 1000);
  const lookbackDays = getLookbackDays();
  const past = now - lookbackDays * 86400;

  console.log(`[Search] Iniciando busca por ${code} nos últimos ${lookbackDays} dias`);

  // Shopee API limita a 15 dias por requisição
  const DAYS_PER_CHUNK = 15;
  const chunks: Array<{ from: number; to: number }> = [];

  for (let i = 0; i < lookbackDays; i += DAYS_PER_CHUNK) {
    const chunkStart = now - Math.min(i + DAYS_PER_CHUNK, lookbackDays) * 86400;
    const chunkEnd = now - i * 86400;
    chunks.push({ from: chunkStart, to: chunkEnd });
  }

  for (const status of getStatusList()) {
    console.log(`[Search] Verificando status: ${status}`);

    for (const chunk of chunks) {
      let cursor: string | undefined;
      let page = 0;

      do {
        const res = await fetchOrderList({
          status,
          cursor,
          pageSize: 100,
          timeFrom: chunk.from,
          timeTo: chunk.to,
          timeRangeField: "update_time",
        });

        if (res.error) {
          console.error(`[Search] Erro na API Shopee para status ${status}:`, res);
          break; // Pula para o próximo chunk se houver erro
        }

        const orders = extractOrders(res);
        console.log(`[Search] Status ${status} chunk ${chunk.from}-${chunk.to} pág ${page}: ${orders.length} pedidos`);

        const matchesOrder = (o: any, needle: string) => {
          try {
            const fields = [
              'order_sn',
              'tracking_number',
              'tracking_no',
              'trackingid',
              'package_number',
              'package_no',
              'package_sn',
              'waybill',
              'awb',
            ];

            for (const k of fields) {
              const v = sanitize((o as any)?.[k]);
              if (v && v === needle) return true;
            }

            const pkg = (o as any)?.package_list;
            if (Array.isArray(pkg)) {
              for (const p of pkg) {
                for (const k of fields) {
                  const v = sanitize((p as any)?.[k]);
                  if (v && v === needle) return true;
                }
              }
            }
          } catch { }
          return false;
        };

        for (const order of orders) {
          const sn = sanitize(order.order_sn);
          if (sn === code || matchesOrder(order, code)) {
            console.log(`[Search] Encontrado match direto! SN: ${order.order_sn}`);
            const detail = await fetchOrderDetail(order.order_sn, ORDER_FIELDS);
            return extractOrders(detail)[0] ?? null;
          }

          const deepCandidate = /[A-Z]/i.test(code) || code.length >= 12;
          if (deepCandidate) {
            try {
              const detail = await fetchOrderDetail(order.order_sn, [
                'package_list',
                'tracking_number',
                'shipping_carrier',
                ...ORDER_FIELDS
              ]);
              const full = extractOrders(detail)[0];
              if (full && matchesOrder(full, code)) {
                console.log(`[Search] Encontrado match profundo! SN: ${order.order_sn}`);
                return full;
              }
            } catch { }
          }
        }

        cursor = res?.response?.next_cursor;
        page++;
      } while (cursor && page < MAX_ORDER_PAGES);
    }
  }

  console.log(`[Search] Nenhum pedido encontrado para ${code}`);
  return null;
}

/* -------------------------------------------------------
| Hoje — estatísticas
--------------------------------------------------------*/
export async function getTodayStats(): Promise<TodayStats> {
  const cached = await getCache<TodayStats>(TODAY_STATS_CACHE_KEY);
  if (cached) return cached;

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const startTs = Math.floor(start.getTime() / 1000);
  const nowTs = Math.floor(Date.now() / 1000);

  // 1. Coletar todos os SNs do dia
  const orderSns = new Set<string>();
  const orderMap = new Map<string, number>(); // SN -> timestamp

  for (const status of getStatusList()) {
    let cursor: string | undefined;
    let page = 0;

    do {
      const res = await fetchOrderList({
        status,
        pageSize: 100,
        cursor,
        timeFrom: startTs,
        timeTo: nowTs,
        timeRangeField: "update_time",
      });

      const orders = extractOrders(res);
      for (const order of orders) {
        const sn = sanitize(order.order_sn);
        const ts = Number(order.update_time);
        if (sn && ts >= startTs) {
          orderSns.add(sn);
          orderMap.set(sn, ts);
        }
      }

      cursor = res?.response?.next_cursor;
      page++;
    } while (cursor && page < MAX_ORDER_PAGES);
  }

  // 2. Buscar detalhes em lote (chunk de 50) para pegar valores reais
  const allSns = Array.from(orderSns);
  let totalOrders = 0;
  let totalValue = 0;
  const perHour = new Map<number, { orders: number; value: number }>();

  // Função auxiliar para chunks
  const chunkArray = (arr: string[], size: number) => {
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  };

  const chunks = chunkArray(allSns, 50);

  for (const chunk of chunks) {
    // Pede detalhes com item_list para calcular valor
    const detailRes = await fetchOrderDetail(chunk.join(","), ['item_list', 'order_sn']);
    const details = extractOrders(detailRes);

    for (const order of details) {
      const sn = sanitize(order.order_sn);
      const ts = orderMap.get(sn);
      if (!ts) continue;

      totalOrders++;
      const val = extractOrderValue(order);
      totalValue += val;

      const hour = new Date(ts * 1000).getHours();
      const block = perHour.get(hour) ?? { orders: 0, value: 0 };
      block.orders++;
      block.value += val;
      perHour.set(hour, block);
    }
  }

  const result: TodayStats = {
    totalOrders,
    totalValue,
    perHour: [...perHour.entries()].map(([hour, d]) => ({
      hour,
      orders: d.orders,
      value: d.value,
    })),
  };

  await setCache(TODAY_STATS_CACHE_KEY, result, TODAY_STATS_CACHE_MS / 1000);
  return result;
}

export async function invalidateTodayStatsCache() {
  await delCache(TODAY_STATS_CACHE_KEY);
}

/* -------------------------------------------------------
| Refresh Token
--------------------------------------------------------*/
export async function refreshAccessToken() {
  try {
    await ensureBaseEnv(false);
    const rToken = await getStoredRefreshToken();

    if (!rToken) {
      console.warn("[Shopee] Access token expirado mas SHOPEE_REFRESH_TOKEN não está configurado.");
      return null;
    }

    console.log("[Shopee] Tentando renovar access_token automaticamente...");

    const timestamp = Math.floor(Date.now() / 1000);
    const path = "/api/v2/auth/access_token/get";
    const signBase = `${partnerId}${path}${timestamp}`;
    const sign = await hmacSha256Hex(partnerKey, signBase);

    const url = `${apiHost}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partner_id: Number(partnerId),
        shop_id: Number(shopId),
        refresh_token: rToken,
      }),
    });

    const data = await res.json();

    if (data?.access_token) {
      localAccessToken = data.access_token;
      await kv.set(KV_ACCESS_TOKEN_KEY, data.access_token); // Persiste no KV

      console.log("[Shopee] Novo access_token obtido e salvo no KV.");

      if (data?.refresh_token) {
        localRefreshToken = data.refresh_token;
        await kv.set(KV_REFRESH_TOKEN_KEY, data.refresh_token); // Persiste no KV
        console.log("[Shopee] Novo refresh_token salvo no KV.");
      }
    } else {
      console.error("[Shopee] Falha ao renovar token:", data);
    }

    return data;
  } catch (err) {
    console.error("[Shopee] Erro durante o refresh automatico:", err);
    return null;
  }
}

export async function tryRefreshTokenIfNeeded(lastPayload?: any) {
  const msg = String(lastPayload?.error ?? lastPayload?.message ?? "").toLowerCase();

  if (msg.includes("access_token") || msg.includes("invalid")) {
    return refreshAccessToken();
  }

  return null;
}

/* -------------------------------------------------------
| GetOrders
--------------------------------------------------------*/
export async function getOrders(status = "READY_TO_SHIP", pageSize = 100) {
  const res = await fetchOrderList({ status, pageSize });

  if (res?.error || res?.message) {
    await tryRefreshTokenIfNeeded(res);
  }

  return res;
}
