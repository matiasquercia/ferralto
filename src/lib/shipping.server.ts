import GeographicLib from 'geographiclib-geodesic';
import catalog from '@/data/catalog.json';
import safari from '@/data/shipping/safari.json';
import { hasNeighborhoodDiscount } from './shipping-neighborhoods.server';
import { serverSecret } from './env.server';
import { deliveryZone, type DeliveryDestination } from './delivery';
import type { ShippingEstimate } from './shipping';

type Point = NonNullable<DeliveryDestination['coordinates']>;
type ShippingLine = { sku: string; quantity: number };
const catalogSkus = new Set(catalog.products.map(({ sku }) => sku));
const WGS84 = GeographicLib.Geodesic.WGS84;
const boundaryToleranceM = 1e-7;

function validPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false;
  const { lat, lon } = value as Partial<Point>;
  return typeof lat === 'number' && typeof lon === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function dispatchOrigin(): Point | null {
  const raw = serverSecret('SHIPPING_ORIGIN_JSON');
  if (!raw) return import.meta.env.DEV ? safari.pilotOrigin : null;
  try {
    const { point, confirmation } = JSON.parse(raw);
    return validPoint(point) && typeof confirmation === 'string' && confirmation.trim() ? point : null;
  } catch {
    return null;
  }
}

export function shippingForOrder(lines: ShippingLine[], destination: DeliveryDestination): ShippingEstimate {
  const pending: ShippingEstimate = {
    status: 'quote_required',
    amount: null,
    message: 'Consultanos por WhatsApp para confirmar el costo y el plazo de entrega de este pedido.',
  };
  const zone = deliveryZone(destination);
  const point = destination.coordinates;
  const origin = dispatchOrigin();
  if (!zone || destination.department?.trim().toLowerCase() === 'la plata' ||
      !validPoint(point) || !origin || !lines.length) return pending;

  const meters = WGS84.Inverse(origin.lat, origin.lon, point.lat, point.lon).s12;
  if (meters === undefined || !Number.isFinite(meters)) return pending;
  const circle = safari.circles.find(({ maxKm }) => meters <= maxKm * 1000 + boundaryToleranceM);
  if (!circle) return pending;

  const quantities = new Map<string, number>();
  for (const { sku, quantity } of lines) {
    if (!catalogSkus.has(sku) || !Number.isSafeInteger(quantity) || quantity < 1) return pending;
    const sum = (quantities.get(sku) ?? 0) + quantity;
    if (sum > 10000) return pending;
    quantities.set(sku, sum);
  }
  const baseAmount = safari.largeSkus.some((sku) => quantities.has(sku)) ? circle.large : circle.standard;
  const amount = circle.cabaNeighborhoodFare !== undefined && zone === 'caba' && hasNeighborhoodDiscount(point)
    ? circle.cabaNeighborhoodFare
    : baseAmount;
  if (!Number.isSafeInteger(amount) || amount <= 0) return pending;

  return {
    status: 'estimated',
    amount,
    rateId: 'safari-circles-v2',
    message: 'Envío a domicilio. Coordinamos la fecha de entrega por WhatsApp.',
  };
}
