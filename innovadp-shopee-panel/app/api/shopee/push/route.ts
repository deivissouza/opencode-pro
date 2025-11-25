import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { invalidateTodayStatsCache } from "@/lib/shopee";

export const runtime = "nodejs";

function verifyShopeeSignature(
  authorizationHeader: string | null,
  rawBody: string,
  partnerKey: string
) {
  if (!authorizationHeader) return false;

  const expected = crypto
    .createHash("sha256")
    .update(rawBody + partnerKey)
    .digest("hex");

  return authorizationHeader === expected;
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    const authHeader = request.headers.get("authorization");
    const topic = request.headers.get("shopee-topic");

    const signingKey = process.env.SHOPEE_PUSH_PARTNER_KEY!;
    const verified = verifyShopeeSignature(authHeader, rawBody, signingKey);

    // ✅ CORREÇÃO AQUI — sem erro de TS
    const headersObj: Record<string, string> = {};
    for (const [k, v] of request.headers as any) {
      headersObj[String(k)] = String(v);
    }

    console.log("[Shopee Push] headers:", headersObj);
    console.log("[Shopee Push] verified:", verified);

    let payload: any = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = rawBody;
    }

    console.log("[Shopee Push] topic:", topic);
    console.log("[Shopee Push] payload:", payload);

    if (!verified) {
      console.warn("[Shopee Push] ❌ Assinatura inválida!");
      return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
    }

    if (topic && topic.includes("order")) {
      invalidateTodayStatsCache();
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Shopee Push] server error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ ok: true });
}
