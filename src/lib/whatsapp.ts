import { formatBuyerAddress, type Buyer } from './buyer';
import { formatPrice } from './format';
import type { CartItem } from './cart';
import { SITE } from './site';
import type { ShippingEstimate } from './shipping';

export function buildWhatsAppOrderUrl(items: CartItem[], buyer?: Buyer, shipping?: ShippingEstimate | null) {
  const lines = items.map(
    (i) =>
      `• ${i.quantity} x ${i.name}${i.variant ? ` (${i.variant})` : ''} — ${formatPrice(i.price * i.quantity)}`,
  );
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const text = [
    `¡Hola ${SITE.name}! Quiero hacer este pedido:`,
    '',
    ...lines,
    '',
    `Productos: ${formatPrice(total)}`,
    shipping?.amount != null ? `Envío estimado: ${formatPrice(shipping.amount)}` : 'Envío: a cotizar antes del pago.',
    shipping?.amount != null ? `*Total estimado con envío: ${formatPrice(total + shipping.amount)}*` : '*Solicito el costo de envío y el total final antes de pagar.*',
    buyer?.name ? `\nNombre: ${buyer.name}` : '',
    buyer?.email ? `Email: ${buyer.email}` : '',
    buyer?.phone ? `Teléfono: ${buyer.phone}` : '',
    buyer?.street ? `Dirección: ${formatBuyerAddress(buyer)}` : '',
    buyer?.notes ? `Notas: ${buyer.notes}` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
  return `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(text)}`;
}

export const whatsappContactUrl = (message = `¡Hola ${SITE.name}! Tengo una consulta.`) =>
  `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(message)}`;
