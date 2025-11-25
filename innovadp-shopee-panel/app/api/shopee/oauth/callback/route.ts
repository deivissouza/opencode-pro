import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/shopee_oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const code = searchParams.get("code");
  const shopId = searchParams.get("shop_id");

  if (!code) {
    return NextResponse.json(
      { ok: false, message: 'Parametro "code" ausente.' },
      { status: 400 }
    );
  }

  if (!shopId) {
    return NextResponse.json(
      { ok: false, message: 'Parametro "shop_id" ausente.' },
      { status: 400 }
    );
  }

  try {
    const resp = await exchangeCodeForToken(code, shopId);

    return NextResponse.json({
      ok: true,
      hint: "Copie access_token/refresh_token para as variáveis de ambiente com segurança.",
      payload: resp,
    });
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erro desconhecido" },
      { status: 500 }
    );
  }
}
