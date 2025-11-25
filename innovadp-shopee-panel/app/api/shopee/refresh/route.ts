import { NextResponse } from "next/server";
import { refreshAccessToken } from "@/lib/shopee";

export const dynamic = 'force-dynamic';

/**
 * Endpoint para renovar o access_token da Shopee manualmente ou via Cron Job.
 */
export async function GET(request: Request) {
    try {
        // Verificação de segurança opcional para Cron Jobs
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;

        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized' },
                { status: 401 }
            );
        }

        console.log("[Refresh] Iniciando renovação de token");
        const result = await refreshAccessToken();

        if (!result) {
            return NextResponse.json(
                { success: false, error: "failed_to_refresh", message: "Não foi possível renovar o token. Verifique os logs." },
                { status: 500 }
            );
        }

        if (result.error) {
            console.error("[Refresh] Erro ao renovar token:", result);
            return NextResponse.json(
                { success: false, error: result.error, message: result.message },
                { status: 500 }
            );
        }

        console.log("[Refresh] Token renovado com sucesso");
        return NextResponse.json({
            success: true,
            message: "Token renovado com sucesso",
            expires_in: result.expire_in,
        });
    } catch (error: any) {
        console.error("[Refresh] Erro inesperado:", error);
        return NextResponse.json(
            { success: false, error: "internal_error", message: error.message },
            { status: 500 }
        );
    }
}
