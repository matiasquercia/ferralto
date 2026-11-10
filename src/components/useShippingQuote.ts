import { useEffect, useState } from 'react';
import { localityFormatError, postalCodeError, splitStreetAndNumber, streetFormatError, type AddressSuggestion } from '@/lib/address';
import type { OrderLineInput } from '@/lib/order';
import type { ShippingEstimate } from '@/lib/shipping';

type Destination = { street: string; locality: string; postalCode: string };
type Result = { shipping?: ShippingEstimate; subtotal?: number; error?: string; suggestions?: AddressSuggestion[] };

export function useShippingQuote(items: OrderLineInput[], destination: Destination, active: boolean) {
  const { street, locality, postalCode } = destination;
  const key = JSON.stringify({
    items: items.map(({ id, variant, quantity }) => ({ id, variant, quantity })),
    street: street.trim(), locality: locality.trim(), postalCode: postalCode.trim(),
  });
  const ready = active && items.length > 0 && !streetFormatError(street) && Boolean(splitStreetAndNumber(street).number) &&
    !localityFormatError(locality) && !postalCodeError(postalCode);
  const [retryCount, setRetryCount] = useState(0);
  const [result, setResult] = useState<{ key: string; attempt: number; data: Result } | null>(null);

  useEffect(() => {
    setResult(null);
    if (!ready) return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/shipping', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key, signal,
        });
        const data: Result = await response.json();
        if (!data || (response.ok ? !data.shipping : !data.error)) throw new Error('Invalid quote response');
        if (!signal.aborted) setResult({ key, attempt: retryCount, data });
      } catch {
        if (!signal.aborted) setResult({
          key, attempt: retryCount, data: { error: 'No pudimos calcular el envío. Probá de nuevo en unos segundos.' },
        });
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [ready, key, retryCount]);

  const data = ready && result?.key === key && result.attempt === retryCount ? result.data : null;
  return { key, ready, data, busy: ready && !data, retry: () => setRetryCount((count) => count + 1) };
}
