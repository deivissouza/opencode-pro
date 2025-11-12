import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_LOOKBACK_HOURS = 6;

function jsonError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function ensureEnv(name: string, value?: string | null) {
  if (!value) {
    throw new Error(`Variável ${name} ausente`);
  }
  return value;
}

function signRequest(path: string, timestamp: number, partnerId: string, shopId: string, accessToken: string, partnerKey: string) {
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", partnerKey).update(base).digest("hex");
}

async function loadTokensFromSupabase(shopId: number) {
  const url = ensureEnv("SUPABASE_URL", process.env.SUPABASE_URL);
  const key = ensureEnv("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  const table = process.env.SHOPEE_TOKEN_TABLE || "tokens_shopee";

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from(table)
    .select("shop_id, access_token, refresh_token, reauth_required, updated_at")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (error) throw new Error("supabase: " + error.message);
  if (!data) throw new Error("supabase: nenhum registro para esse shop_id");
  if (!data.access_token) throw new Error("supabase: registro encontrado, porém sem access_token");

  return data;
}

type ShopeeCallOptions = {
  path: string;
  query?: Record<string, string | number | undefined | null>;
  method?: "GET" | "POST";
  body?: any;
  apiHost: string;
  partnerId: string;
  partnerKey: string;
  shopId: string;
  accessToken: string;
};

async function callShopeeV2(options: ShopeeCallOptions) {
  const { path, query = {}, method = "GET", body, apiHost, partnerId, partnerKey, shopId, accessToken } = options;
  const timestamp = Math.floor(Date.now() / 1000);

  const params = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
    sign: signRequest(path, timestamp, partnerId, shopId, accessToken, partnerKey),
    shop_id: shopId,
  });

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });

  const url = `${apiHost}${path}?${params.toString()}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: accessToken,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // mantém texto cru
  }

  return { response, payload, text };
}

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams;
    const partnerId = ensureEnv("SHOPEE_PARTNER_ID", process.env.SHOPEE_PARTNER_ID);
    const partnerKey = ensureEnv("SHOPEE_PARTNER_KEY", process.env.SHOPEE_PARTNER_KEY);
    const shopId = ensureEnv("SHOPEE_SHOP_ID", process.env.SHOPEE_SHOP_ID);
    const apiHost = (process.env.SHOPEE_API_HOST || "https://partner.shopeemobile.com").replace(/\/$/, "");

    const shopNumeric = Number(shopId);
    if (!shopNumeric) {
      throw new Error("SHOPEE_SHOP_ID inválido");
    }

    const orderStatus = search.get("status") || "READY_TO_SHIP";
    const cursor = search.get("cursor") || undefined;
    const pageSize = Number(search.get("page_size") || DEFAULT_PAGE_SIZE);
    const timeTo = Number(search.get("time_to")) || Math.floor(Date.now() / 1000);
    const lookbackSeconds = Number(search.get("lookback_seconds")) || DEFAULT_LOOKBACK_HOURS * 3600;
    const timeFrom = Number(search.get("time_from")) || timeTo - lookbackSeconds;
    const timeRangeField = (search.get("time_field") as "create_time" | "update_time") || "update_time";

    const tokens = await loadTokensFromSupabase(shopNumeric);
    const { response, payload, text } = await callShopeeV2({
      path: "/api/v2/order/get_order_list",
      apiHost,
      partnerId,
      partnerKey,
      shopId,
      accessToken: tokens.access_token,
      query: {
        order_status: orderStatus,
        cursor,
        page_size: pageSize,
        time_from: timeFrom,
        time_to: timeTo,
        time_range_field: timeRangeField,
      },
    });

    const requestId =
      response.headers.get("x-request-id") ||
      response.headers.get("request-id") ||
      response.headers.get("x-correlation-id");

    return NextResponse.json(
      {
        ok: response.ok,
        http_status: response.status,
        request_id: requestId,
        querySent: {
          order_status: orderStatus,
          cursor: cursor ?? null,
          page_size: pageSize,
          time_from: timeFrom,
          time_to: timeTo,
          time_range_field: timeRangeField,
        },
        supabase_record: {
          shop_id: tokens.shop_id,
          reauth_required: tokens.reauth_required ?? null,
          updated_at: tokens.updated_at ?? null,
        },
        response: payload,
        raw: typeof payload === "object" ? undefined : text,
      },
      { status: response.ok ? 200 : 502 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return jsonError(500, message);
  }
}
