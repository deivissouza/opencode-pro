import crypto from "crypto";
import { getCache, setCache, delCache } from "./cache";
import { getStoredTokens, saveTokens } from "./token_store";
import { refreshAccessToken } from "./shopee_oauth";

const DEFAULT_STATUSES = ["READY_TO_SHIP", "PROCESSED", "SHIPPED"];
const DEFAULT_LOOKBACK_DAYS = 15;
const MAX_LOOKBACK_DAYS = 30;
const MIN_IDENTIFIER_LENGTH = 6;
const TODAY_STATS_CACHE_KEY = "today-stats";
const TODAY_STATS_CACHE_TTL = 60 * 1000; // 1 minuto

const rawHost = (process.env.SHOPEE_API_HOST || "https://partner.shopeemobile.com").trim();
const apiHost = (rawHost.startsWith("http") ? rawHost : `https://${rawHost}`).replace(/\/$/, "");
const partnerId = (process.env.SHOPEE_PARTNER_ID || "").trim();
const partnerKey = (process.env.SHOPEE_PARTNER_KEY || "").trim();
const shopId = (process.env.SHOPEE_SHOP_ID || "").trim();

let accessToken = (process.env.SHOPEE_ACCESS_TOKEN || "").trim();
let refreshToken = (process.env.SHOPEE_REFRESH_TOKEN || "").trim();
let tokensLoadedFromStore = false;
let tokensLoadingPromise: Promise<void> | null = null;

type ShopeeOrderItem = {
  item_name: string;
  variation_name?: string;
  item_sku?: string;
  model_quantity_purchased: number;
  image_info?: { image_url?: string };
};

type ShopeeShipmentAllocation = {
  tracking_number?: string | null;
  shipment_unit_id?: string | null;
};

type ShopeePackage = {
  package_number?: string | null;
  tracking_number?: string | null;
  first_mile_tracking_no?: string | null;
  shipment_allocations?: ShopeeShipmentAllocation[];
};

type ShopeeLogisticsInfo = {
  tracking_number?: string | null;
  first_mile_tracking_no?: string | null;
};

export type ShopeeOrder = {
  order_sn: string;
  buyer_username?: string;
  order_status?: string;
  create_time?: number;
  update_time?: number;
  total_amount?: string | number;
  tracking_no?: string | null;
  tracking_number?: string | null;
  item_list?: ShopeeOrderItem[];
  package_list?: ShopeePackage[];
  logistics_info?: ShopeeLogisticsInfo[];
};

type ShopeeOrderListResponse = {
  order_list?: ShopeeOrder[];
  more?: boolean;
  next_cursor?: string | null;
};

type ShopeeApiResponse<T> = {
  error?: string | number;
  message?: string;
  warning?: string;
  response?: T;
};

export type TodayStats = {
  totalOrders: number;
  totalValue: number;
  perHour: { hour: number; orders: number; value: number }[];
};

type OrderListQuery = {
  order_status?: string;
  cursor?: string;
  page_size?: number;
  time_from?: number;
  time_to?: number;
  time_range_field?: "create_time" | "update_time";
};

function ensureEnv() {
  if (!partnerId || !partnerKey || !shopId) {
    throw new Error("Configure SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY e SHOPEE_SHOP_ID no ambiente.");
  }
}

function signRequest(path: string, timestamp: number, body: string = "") {
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}${body}`;
  return crypto.createHmac("sha256", partnerKey).update(base).digest("hex");
}

async function ensureTokensLoaded() {
  if ((accessToken && refreshToken) || tokensLoadedFromStore) return;
  if (!tokensLoadingPromise) {
    tokensLoadingPromise = (async () => {
      try {
        const stored = await getStoredTokens();
        if (stored?.access_token && !accessToken) {
          accessToken = stored.access_token;
        }
        if (stored?.refresh_token && !refreshToken) {
          refreshToken = stored.refresh_token;
        }
      } finally {
        tokensLoadedFromStore = true;
        tokensLoadingPromise = null;
      }
    })();
  }
  await tokensLoadingPromise;
}

async function shopeeRequest<T>(
  path: string,
  options: { method?: "GET" | "POST"; query?: Record<string, any>; body?: any } = {},
  attempt = 0
): Promise<ShopeeApiResponse<T>> {
  ensureEnv();
  await ensureTokensLoaded();

  const timestamp = Math.floor(Date.now() / 1000);
  const bodyString = options.body ? JSON.stringify(options.body) : "";
  const sign = signRequest(path, timestamp, bodyString);

  const params = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
    sign,
    shop_id: shopId,
  });

  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      params.set(key, String(value));
    });
  }

  const url = `${apiHost}${path}?${params.toString()}`;
  const res = await fetch(url, {
    method: options.method || (options.body ? "POST" : "GET"),
    headers: {
      Authorization: accessToken,
      "Content-Type": "application/json",
    },
    body: bodyString || undefined,
  });

  const text = await res.text();
  let data: ShopeeApiResponse<T>;
  try {
    data = text ? (JSON.parse(text) as ShopeeApiResponse<T>) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    const httpErr = new Error(`[Shopee] HTTP ${res.status}`);
    (httpErr as any).payload = data;
    throw httpErr;
  }

  const hasError = data?.error && data.error !== 0 && data.error !== "0" && data.error !== "error";
  if (hasError) {
    const refreshed = attempt === 0 ? await tryRefreshTokenIfNeeded(data) : false;
    if (refreshed) {
      return shopeeRequest(path, options, attempt + 1);
    }
    const err = new Error(data?.message || "Erro ao chamar Shopee API");
    (err as any).payload = data;
    throw err;
  }

  return data;
}

async function fetchOrderList(query: OrderListQuery): Promise<ShopeeOrderListResponse> {
  const response = await shopeeRequest<ShopeeOrderListResponse>("/api/v2/order/get_order_list", { query });
  return response.response ?? { order_list: [], more: false };
}

function getConfiguredStatuses(): string[] {
  const raw = process.env.SCAN_ORDER_STATUSES;
  if (!raw) return DEFAULT_STATUSES;
  const parsed = raw
    .split(",")
    .map((status) => status.trim().toUpperCase())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_STATUSES;
}

function getLookbackWindowSeconds(): number {
  const raw = Number(process.env.SCAN_ORDER_LOOKBACK_DAYS || DEFAULT_LOOKBACK_DAYS);
  const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), MAX_LOOKBACK_DAYS) : DEFAULT_LOOKBACK_DAYS;
  return days * 24 * 60 * 60;
}

function normalizeIdentifier(value?: string | number | null) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function extractScanCandidates(raw: string): string[] {
  const tokens = new Set<string>();
  raw
    .split(/[\s\r\n]+/)
    .map((segment) => normalizeIdentifier(segment))
    .filter((segment) => segment.length >= MIN_IDENTIFIER_LENGTH)
    .forEach((segment) => tokens.add(segment));

  const collapsed = normalizeIdentifier(raw);
  if (collapsed.length >= MIN_IDENTIFIER_LENGTH) {
    tokens.add(collapsed);
  }

  return Array.from(tokens);
}

function collectOrderIdentifiers(order: Partial<ShopeeOrder>): string[] {
  const identifiers = new Set<string>();
  const push = (value?: string | number | null) => {
    const normalized = normalizeIdentifier(value);
    if (normalized.length >= MIN_IDENTIFIER_LENGTH) identifiers.add(normalized);
  };

  push(order.order_sn);
  push(order.tracking_no);
  push((order as any)?.tracking_number);

  order.package_list?.forEach((pkg) => {
    push(pkg.package_number);
    push(pkg.tracking_number);
    push(pkg.first_mile_tracking_no);
    pkg.shipment_allocations?.forEach((alloc) => {
      push(alloc.tracking_number);
      push(alloc.shipment_unit_id);
    });
  });

  order.logistics_info?.forEach((info) => {
    push(info.tracking_number);
    push(info.first_mile_tracking_no);
  });

  return Array.from(identifiers);
}

async function fetchOrdersWithinRange(
  statuses: string[],
  opts: { timeFrom: number; timeTo: number; timeRangeField: "create_time" | "update_time" }
): Promise<ShopeeOrder[]> {
  const uniqueStatuses = Array.from(new Set(statuses.length ? statuses : DEFAULT_STATUSES));
  const collected = new Map<string, ShopeeOrder>();

  for (const status of uniqueStatuses) {
    let cursor: string | undefined;
    do {
      const page = await fetchOrderList({
        order_status: status,
        cursor,
        page_size: 100,
        time_from: opts.timeFrom,
        time_to: opts.timeTo,
        time_range_field: opts.timeRangeField,
      });

      page.order_list?.forEach((order) => {
        if (order.order_sn) {
          collected.set(order.order_sn, order);
        }
      });

      cursor = page.more ? page.next_cursor ?? undefined : undefined;
    } while (cursor);
  }

  return Array.from(collected.values());
}

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

async function fetchOrderDetail(orderSn: string): Promise<ShopeeOrder | null> {
  if (!orderSn) return null;
  const response = await shopeeRequest<ShopeeOrderListResponse>("/api/v2/order/get_order_detail", {
    query: { order_sn_list: orderSn },
  });
  const order = response.response?.order_list?.[0];
  if (!order) return null;

  return {
    ...order,
    item_list: Array.isArray(order.item_list) ? order.item_list : [],
  };
}

async function safeGetOrderDetail(orderSn: string): Promise<ShopeeOrder | null> {
  try {
    return await fetchOrderDetail(orderSn);
  } catch (err) {
    console.warn(`[Shopee] Falha ao buscar detalhes do pedido ${orderSn}`, err);
    return null;
  }
}

export async function tryRefreshTokenIfNeeded(lastPayload?: any): Promise<boolean> {
  try {
    const message = String((lastPayload?.error ?? "") + " " + (lastPayload?.message ?? "")).toLowerCase();
    const looksExpired =
      message.includes("access_token") ||
      message.includes("acceess_token") ||
      (message.includes("invalid") && message.includes("token"));

    if (!looksExpired) return false;

    await ensureTokensLoaded();

    if (!refreshToken) {
      console.warn("[Shopee] Access token expirado, mas o refresh_token não está disponível.");
      return false;
    }

    console.log("[Shopee] Tentando renovar access_token automaticamente...");
    const tokenResponse = await refreshAccessToken({
      refresh_token: refreshToken,
      shop_id: shopId ? Number(shopId) : undefined,
    });

    const payload = tokenResponse?.response ?? tokenResponse;
    if (payload?.access_token) {
      accessToken = payload.access_token;
      refreshToken = payload.refresh_token || refreshToken;

      const expiresAt =
        payload.expire_in && Number(payload.expire_in)
          ? new Date(Date.now() + Number(payload.expire_in) * 1000).toISOString()
          : undefined;

      await saveTokens({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
      });

      console.log("[Shopee] Novo access_token obtido com sucesso.");
      return true;
    }

    console.error("[Shopee] Falha ao renovar token automaticamente:", tokenResponse);
    return false;
  } catch (err) {
    console.error("[Shopee] Erro durante o refresh automático:", err);
    return false;
  }
}

export async function getOrderDetail(orderSn: string): Promise<ShopeeOrder | null> {
  return fetchOrderDetail(orderSn);
}

export async function getOrders(status: string = "READY_TO_SHIP", pageSize: number = 100) {
  return fetchOrderList({ order_status: status, page_size: pageSize });
}

export async function findOrderByCode(rawCode: string): Promise<ShopeeOrder | null> {
  if (!rawCode?.trim()) return null;

  const candidates = extractScanCandidates(rawCode);
  for (const candidate of candidates) {
    const order = await safeGetOrderDetail(candidate);
    if (order) {
      return order;
    }
  }

  const normalizedTarget = normalizeIdentifier(rawCode);
  if (normalizedTarget.length < MIN_IDENTIFIER_LENGTH) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const lookbackSeconds = getLookbackWindowSeconds();
  const statuses = getConfiguredStatuses();
  const recentOrders = await fetchOrdersWithinRange(statuses, {
    timeFrom: now - lookbackSeconds,
    timeTo: now,
    timeRangeField: "update_time",
  });

  const matched = recentOrders.find((order) =>
    collectOrderIdentifiers(order).some((identifier) => identifier === normalizedTarget)
  );

  if (!matched) {
    return null;
  }

  return safeGetOrderDetail(matched.order_sn);
}

export async function getTodayStats(): Promise<TodayStats> {
  const cached = getCache<TodayStats>(TODAY_STATS_CACHE_KEY);
  if (cached) {
    return cached;
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const timeFrom = Math.floor(startOfDay.getTime() / 1000);
  const timeTo = Math.floor(now.getTime() / 1000);

  const statuses = getConfiguredStatuses();
  const orders = await fetchOrdersWithinRange(statuses, {
    timeFrom,
    timeTo,
    timeRangeField: "create_time",
  });

  let totalOrders = 0;
  let totalValue = 0;
  const perHourMap = new Map<number, { hour: number; orders: number; value: number }>();

  orders.forEach((order) => {
    totalOrders += 1;
    const amount = toNumber(order.total_amount);
    totalValue += amount;

    if (typeof order.create_time === "number" && order.create_time > 0) {
      const hour = new Date(order.create_time * 1000).getHours();
      const bucket = perHourMap.get(hour) || { hour, orders: 0, value: 0 };
      bucket.orders += 1;
      bucket.value += amount;
      perHourMap.set(hour, bucket);
    }
  });

  const perHour = Array.from(perHourMap.values()).sort((a, b) => a.hour - b.hour);

  const stats: TodayStats = {
    totalOrders,
    totalValue,
    perHour,
  };

  setCache(TODAY_STATS_CACHE_KEY, stats, TODAY_STATS_CACHE_TTL);
  return stats;
}

export function invalidateTodayStatsCache() {
  delCache(TODAY_STATS_CACHE_KEY);
}
