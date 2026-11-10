import type { APIRoute } from 'astro';
import { resolveOrderLines } from '@/lib/order';
import { shippingForOrder } from '@/lib/shipping.server';
import { matchToSuggestion, postalCodeDigits, prettyLocality, verifyAddress, verifyPostalCode } from '@/lib/address';
import { deliveryZone } from '@/lib/delivery';
export const prerender = false;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
export const POST: APIRoute = async ({ request }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Pedido inválido.' }, 400); }
  if (!body || typeof body.postalCode !== 'string' || typeof body.locality !== 'string' ||
      typeof body.street !== 'string' || body.street.length > 200 || body.postalCode.length > 12 || body.locality.length > 200) return json({ error: 'Indicá calle y número, código postal y localidad.' }, 400);
  if (!postalCodeDigits(body.postalCode) || !body.locality.trim()) return json({ error: 'Indicá un código postal argentino válido y la localidad de entrega.' }, 400);
  const built = resolveOrderLines(body.items);
  if (!built.ok) return json({ error: built.error }, built.status);
  const address = await verifyAddress(body.street, body.locality);
  if (!address.ok) return json({ error: address.error, suggestions: address.matches.map(matchToSuggestion) }, 400);
  if (!deliveryZone(address.match)) return json({ error: 'Por ahora hacemos envíos solo dentro de AMBA. Ese destino está fuera de nuestra cobertura.' }, 422);
  const locality = prettyLocality(address.match.locality, address.match.province);
  const postal = await verifyPostalCode(body.postalCode, locality, address.match.province);
  if (!postal.ok) return json({ error: postal.error }, 400);
  const { status, amount, message } = shippingForOrder(built.lines, address.match);
  const shipping = { status, amount, message };
  return json({ shipping, subtotal: built.total, total: shipping.amount === null ? null : built.total + shipping.amount });
};
