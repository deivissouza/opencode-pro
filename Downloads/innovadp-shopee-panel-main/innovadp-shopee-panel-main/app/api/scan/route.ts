import { NextRequest, NextResponse } from 'next/server';
import { findOrderByCode } from '@/lib/shopee';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * API Route para buscar um pedido via código de etiqueta (order_sn).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({ message: "Parâmetro 'code' é obrigatório." }, { status: 400 });
  }

  try {
    const order = await findOrderByCode(code.trim());

    if (!order) {
      return NextResponse.json({ notFound: true });
    }

    // Formata a resposta para o frontend
    const items = Array.isArray(order.item_list) ? order.item_list : [];

    const response = {
      order_sn: order.order_sn,
      buyer: order.buyer_username || 'N/A',
      items: items.map((item: any) => ({
        name: item.item_name,
        variation: item.variation_name || 'Padrão',
        sku: item.item_sku || 'Sem SKU',
        qty: item.model_quantity_purchased,
        image: item.image_info?.image_url // Adicionando imagem se disponível
      })),
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error(`[API /scan Error] Code: ${code}`, error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido no servidor';
    return NextResponse.json(
      { message: 'Falha ao buscar pedido', error: errorMessage },
      { status: 500 }
    );
  }
}
