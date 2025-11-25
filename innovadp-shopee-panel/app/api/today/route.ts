import { NextResponse } from 'next/server';
import { getTodayStats } from '@/lib/shopee';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * API Route para buscar as estatisticas do dia (pedidos e faturamento).
 */
export async function GET() {
  try {
    const stats = await getTodayStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('[API /today Error]', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido no servidor';
    return NextResponse.json(
      { message: 'Falha ao buscar estatisticas', error: errorMessage },
      { status: 500 }
    );
  }
}
