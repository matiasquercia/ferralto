import GeographicLib from 'geographiclib-geodesic';
import safari from '@/data/shipping/safari.json';
import { hasNeighborhoodDiscount } from './shipping-neighborhoods.server';
import { serverSecret } from './env.server';
import { deliveryZone, type DeliveryDestination } from './delivery';
import type { ShippingEstimate } from './shipping';

type Point = NonNullable<DeliveryDestination['coordinates']>;
type ShippingLine = { sku: string; quantity: number };
type LoadProfile = { massKg: number; dimensionsCm: number[] } | { ratios: number[] };
const profiles: Record<string, LoadProfile> = safari.load;
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

function loadRatios(profile: LoadProfile) {
  if ('ratios' in profile) return profile.ratios;
  const [length, width, depth] = profile.dimensionsCm;
  return [
    profile.massKg / safari.reference.mass,
    (length * width * depth) / 1e6 / safari.reference.volume,
    Math.max(length, width, depth) / 100 / safari.reference.length,
  ];
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
  if (meters === undefined || !Number.isFinite(meters) || meters > safari.maxKm * 1000 + boundaryToleranceM) return pending;

  const quantities = new Map<string, number>();
  for (const { sku, quantity } of lines) {
    if (!Object.hasOwn(profiles, sku) || !Number.isSafeInteger(quantity) || quantity < 1) return pending;
    const sum = (quantities.get(sku) ?? 0) + quantity;
    if (sum > 10000) return pending;
    quantities.set(sku, sum);
  }
  let mass = 0;
  let volume = 0;
  let longest = 0;
  for (const sku of [...quantities.keys()].sort()) {
    const [m, v, l] = loadRatios(profiles[sku]);
    const quantity = quantities.get(sku)!;
    mass += quantity * m;
    volume += quantity * v;
    longest = Math.max(longest, l);
  }
  const weight = 1 / 3;
  const loadQuotient = weight * mass + weight * volume + weight * longest;
  const orderFactor = (1 + loadQuotient) / 2;
  const billedKm = Math.max(1, Math.ceil((meters - boundaryToleranceM) / 5000)) * 5;
  const baseAmount = Math.ceil(
    Math.max(safari.minimum, safari.ratePerKm * billedKm * orderFactor) / safari.roundingStep,
  ) * safari.roundingStep;
  const amount = zone === 'caba' && hasNeighborhoodDiscount(point)
    ? Math.round(baseAmount * (100 - safari.discount)) / 100
    : baseAmount;
  if (!Number.isSafeInteger(amount) || amount <= 0) return pending;

  return {
    status: 'estimated',
    amount,
    rateId: 'safari-quotient-v1',
    message: 'Envío a domicilio. Coordinamos la fecha de entrega por WhatsApp.',
  };
}
