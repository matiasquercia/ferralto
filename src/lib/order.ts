import { prettyLocality, verifyAddress, verifyLocality, verifyPostalCode } from '@/lib/address';
import { getProductById, maxQuantity } from '@/lib/catalog';
import { formatPrice } from '@/lib/format';
import { validateBuyer, type Buyer } from '@/lib/buyer';
import { shippingForOrder } from '@/lib/shipping.server';
import { authorizeCheckoutShipping, type ShippingEstimate } from '@/lib/shipping';
import { deliveryZone } from '@/lib/delivery';

export type OrderChannel = 'mercadopago' | 'whatsapp';
export type OrderStatus = 'Pendiente' | 'Pagado' | 'Rechazado' | 'WhatsApp';

export interface OrderLineInput {
  id: string;
  variant?: string;
  quantity: number;
}

export interface ResolvedOrderLine {
  id: string;
  sku: string;
  name: string;
  variant?: string;
  quantity: number;
  unitPrice: number;
  image: string;
  category: string;
  shortDescription: string;
}

export interface OrderRecord {
  orderId: string;
  buyer: Buyer;
  channel: OrderChannel;
  status: OrderStatus;
  lines: ResolvedOrderLine[];
  total: number;
  subtotal: number;
  shipping: ShippingEstimate;
}

export function newOrderId() {
  return `FER-${Date.now().toString(36).toUpperCase()}`;
}

export function resolveOrderLines(items: unknown) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false as const, error: 'El carrito está vacío.', status: 400 };
  }

  if (items.length > 200) return { ok: false as const, error: 'El pedido tiene demasiados artículos.', status: 400 };
  const byLine = new Map<string, ResolvedOrderLine>();
  for (const line of items as OrderLineInput[]) {
    const product = getProductById(line?.id);
    const quantity = line?.quantity;
    if (!product) return { ok: false as const, error: `Producto inexistente: ${line?.id}`, status: 400 };
    if (product.price === null) {
      return {
        ok: false as const,
        error: `"${product.name}" no tiene precio publicado. Consultalo por WhatsApp.`,
        status: 400,
      };
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      return { ok: false as const, error: 'Cantidad inválida.', status: 400 };
    }
    if (product.colors.length > 1 && !product.colors.includes(line.variant ?? '')) {
      return { ok: false as const, error: `Elegí un color válido para "${product.name}".`, status: 400 };
    }
    const variant = product.colors.length > 1 ? line.variant : undefined;
    const id = variant ? `${product.id}::${variant}` : product.id;
    const combined = quantity + (byLine.get(id)?.quantity ?? 0);
    if (combined > maxQuantity(product)) {
      return { ok: false as const, error: `No hay stock suficiente de "${product.name}".`, status: 409 };
    }
    byLine.set(id, {
      id,
      sku: product.sku,
      name: product.name,
      variant,
      quantity: combined,
      unitPrice: product.price,
      image: product.images[0],
      category: product.category,
      shortDescription: product.shortDescription,
    });
  }
  const lines = [...byLine.values()];

  const total = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return { ok: true as const, lines, total };
}

export function formatOrderLines(lines: ResolvedOrderLine[]) {
  return lines
    .map((line) => {
      const variant = line.variant ? ` (${line.variant})` : '';
      return `• ${line.quantity} × ${line.name}${variant} — ${formatPrice(line.unitPrice * line.quantity)}`;
    })
    .join('\n');
}

export async function buildOrder(input: { items: unknown; buyer: unknown; channel: OrderChannel; orderId?: string; shippingAmount?: unknown }) {
  const buyerResult = validateBuyer(input.buyer);
  if (!buyerResult.ok) {
    return { ok: false as const, error: buyerResult.message ?? 'Datos incompletos.', status: 400, errors: buyerResult.errors };
  }
  const locality = await verifyLocality(buyerResult.buyer.locality);
  if (!locality.ok) {
    return {
      ok: false as const,
      error: locality.error,
      status: 400,
      errors: { locality: locality.error },
    };
  }
  const address = await verifyAddress(buyerResult.buyer.street, locality.locality);
  if (!address.ok) {
    const field = /localidad|coincidencias/i.test(address.error) ? 'locality' : 'street';
    return {
      ok: false as const,
      error: address.error,
      status: 400,
      errors: { [field]: address.error },
    };
  }
  const normalizedLocality = prettyLocality(address.match.locality, address.match.province);
  if (!deliveryZone(address.match)) {
    return { ok: false as const, error: 'Por ahora hacemos envíos solo dentro de AMBA. Revisá la localidad de entrega.', status: 422, errors: { locality: 'El destino está fuera de nuestra cobertura actual de AMBA.' } };
  }
  const postal = await verifyPostalCode(
    buyerResult.buyer.postalCode,
    normalizedLocality,
    address.match.province,
  );
  if (!postal.ok) {
    return {
      ok: false as const,
      error: postal.error,
      status: 400,
      errors: { postalCode: postal.error },
    };
  }
  const linesResult = resolveOrderLines(input.items);
  if (!linesResult.ok) return linesResult;

  const shipping = shippingForOrder(linesResult.lines, address.match);
  if (input.channel === 'mercadopago') {
    const authorized = authorizeCheckoutShipping(shipping, input.shippingAmount);
    if (!authorized.ok) return authorized;
  }

  const order: OrderRecord = {
    orderId: input.orderId ?? newOrderId(),
    buyer: {
      ...buyerResult.buyer,
      street: `${address.match.street} ${address.match.number}`,
      locality: normalizedLocality,
    },
    channel: input.channel,
    status: input.channel === 'whatsapp' ? 'WhatsApp' : 'Pendiente',
    lines: linesResult.lines,
    subtotal: linesResult.total,
    shipping,
    total: linesResult.total + (shipping.amount ?? 0),
  };
  return { ok: true as const, order };
}
