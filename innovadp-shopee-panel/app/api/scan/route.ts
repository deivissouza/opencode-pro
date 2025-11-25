import { NextRequest, NextResponse } from 'next/server';
import { findOrderByCode } from '@/lib/shopee';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * API Route para buscar um pedido via código de etiqueta (order_sn).
 */
export async function GET(request: NextRequest) {
  console.log('[API /scan] Recebida requisição');
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  console.log(`[API /scan] Código recebido: ${code}`);

  if (!code) {
    return NextResponse.json({ message: "Parâmetro 'code' é obrigatório." }, { status: 400 });
  }

  try {
    const order = await findOrderByCode(code.trim());

    if (!order) {
      return NextResponse.json({ notFound: true });
    }

    console.log('[API /scan] Pedido encontrado:', JSON.stringify(order, null, 2));

    // Formata a resposta para o frontend
    const itemsList = order.item_list || order.items || [];
    const response = {
      order_sn: order.order_sn,
      buyer: order.buyer_username || 'N/A',
      items: itemsList.map((item: any) => ({
        name: item.item_name,
        variation: item.variation_name || 'Padrão',
        sku: item.item_sku || 'Sem SKU',
        qty: item.model_quantity_purchased,
        image: item.image_info?.image_url // Adicionando imagem se disponível
      })),
      paymentMethod: order.payment_method || 'N/A',
      shippingCarrier: order.shipping_carrier || 'N/A',
      note: order.note || '',
      payTime: order.pay_time ? new Date(order.pay_time * 1000).toLocaleString('pt-BR') : 'N/A',
      recipientCity: order.recipient_address?.city || ''
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error(`[API /scan Error] Code: ${code}`);
    console.error(error); // Log full error object
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido no servidor';
    return NextResponse.json(
      { message: 'Falha ao buscar pedido', error: errorMessage },
      { status: 500 }
    );
  }
}
