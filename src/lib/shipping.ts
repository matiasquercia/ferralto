/** Pure shipping pricing. Rates are private, verified whole-order cost ceilings.
 * Never substitute product height for packed dimensions or guess a carrier tariff. */
export interface ShippingPolicy {
  contingencyRate: number;
  netMarginRate: number;
  minimumProfit: number;
  collectionRate: number | null;
  roundTo: number;
}
export interface ShippingRate {
  id: string;
  carrier: string;
  originPostalCode: string;
  destinationPostalCodes: string[];
  destinationLocalities: string[];
  verifiedAt: string;
  validUntil: string;
  source: string;
  /** Costs cover the WHOLE order up to this quantity envelope. */
  quantities: Record<string, number>;
  packagesVerified: boolean;
  carrierCost: number;
  packagingCost: number;
  insuranceCost: number;
  handlingCost: number;
}
export interface ShippingConfiguration { policy: ShippingPolicy; rates: ShippingRate[] }
export interface ShippingEstimate {
  status: 'estimated' | 'quote_required';
  amount: number | null;
  message: string;
  carrier?: string;
  rateId?: string;
  validUntil?: string;
}
export const DEFAULT_SHIPPING_POLICY: ShippingPolicy = {
  contingencyRate: 0.10, netMarginRate: 0.10, minimumProfit: 1000,
  collectionRate: null, roundTo: 100,
};
const positive = (n: number) => Number.isFinite(n) && n > 0;
const nonnegative = (n: number) => Number.isFinite(n) && n >= 0;
export function priceShipping(cost: number, policy: ShippingPolicy): number | null {
  const { contingencyRate: buffer, netMarginRate: margin, minimumProfit: floor, collectionRate: fees, roundTo } = policy;
  if (!positive(cost) || fees === null || !nonnegative(fees) || !nonnegative(buffer) ||
      !positive(margin) || !positive(floor) || !positive(roundTo) || fees + margin >= 1) return null;
  const coveredCost = cost * (1 + buffer);
  const charge = Math.max(coveredCost / (1 - fees - margin), (coveredCost + floor) / (1 - fees));
  const rounded = Math.ceil(charge / roundTo) * roundTo;
  return Number.isSafeInteger(rounded) ? rounded : null;
}
export function postalDigits(value: string): string | null {
  const match = value.trim().toUpperCase().match(/^(?:[A-Z])?(\d{4})(?:[A-Z]{3})?$/);
  return match?.[1] ?? null;
}
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const pending = (): ShippingEstimate => ({
  status: 'quote_required', amount: null,
  message: 'No hay una tarifa automática disponible para este pedido y destino. Solicitá la cotización por WhatsApp para confirmar el costo y el plazo antes de pagar.',
});
export function estimateShipping(
  lines: { sku: string; quantity: number }[], postalCode: string, locality: string,
  config: ShippingConfiguration, now = Date.now(),
): ShippingEstimate {
  const cp = postalDigits(postalCode);
  if (!cp || !locality.trim() || !lines.length || !Array.isArray(config.rates)) return pending();
  const quantities: Record<string, number> = {};
  for (const line of lines) {
    if (!line.sku || !Number.isSafeInteger(line.quantity) || line.quantity < 1) return pending();
    quantities[line.sku] = (quantities[line.sku] ?? 0) + line.quantity;
  }
  const candidates = config.rates.flatMap((rate) => {
    const start = Date.parse(rate.verifiedAt), end = Date.parse(rate.validUntil);
    if (!rate.id || !rate.carrier || !rate.source || !postalDigits(rate.originPostalCode) ||
        !rate.packagesVerified || !Number.isFinite(start) || !Number.isFinite(end) ||
        start > now || end <= now || end - start > 7 * 86400000 ||
        !rate.destinationPostalCodes?.includes(cp) ||
        !rate.destinationLocalities?.some((s) => normalize(s) === normalize(locality)) ||
        Object.entries(quantities).some(([sku, qty]) => !Number.isSafeInteger(rate.quantities?.[sku]) || qty > rate.quantities[sku])) return [];
    const costs = [rate.carrierCost, rate.packagingCost, rate.insuranceCost, rate.handlingCost];
    if (!costs.every(nonnegative) || !positive(rate.carrierCost)) return [];
    const amount = priceShipping(costs.reduce((sum, n) => sum + n, 0), config.policy);
    if (amount === null) return [];
    return [{ status: 'estimated' as const, amount, carrier: rate.carrier, rateId: rate.id,
      validUntil: rate.validUntil, message: 'Envío estimado para tu pedido. El importe se confirma nuevamente al iniciar el pago.' }];
  });
  return candidates.sort((a, b) => a.amount - b.amount)[0] ?? pending();
}

/** Mercado Pago may charge products only when no verified tariff exists (`shippingAmount` 0). */
export function authorizeCheckoutShipping(
  shipping: ShippingEstimate,
  requestedAmount: unknown,
): { ok: true } | { ok: false; error: string; status: number } {
  if (shipping.amount !== null) {
    if (requestedAmount !== shipping.amount) {
      return {
        ok: false,
        error: 'El costo de envío cambió. Volvé a calcularlo antes de pagar.',
        status: 409,
      };
    }
    return { ok: true };
  }
  if (requestedAmount === 0) return { ok: true };
  return { ok: false, error: shipping.message, status: 422 };
}
