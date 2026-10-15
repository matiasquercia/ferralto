import { track, ecommerceItem } from '@/lib/analytics';
import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState } from 'react';
import { BUYER_FIELDS, emptyBuyer, hydrateBuyer, validateBuyer, type Buyer, type BuyerField } from '@/lib/buyer';
import {
  applySuggestion,
  prettyLocality,
  streetFormatError,
  localityFormatError,
  postalCodeError,
  suggestionKindLabel,
  type AddressSuggestion,
} from '@/lib/address';
import { lineKey, $cart, $cartTotal, removeFromCart, setQuantity } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { productImage } from '@/lib/images';
import { buildWhatsAppOrderUrl } from '@/lib/whatsapp';
import type { ShippingEstimate } from '@/lib/shipping';
import DeliveryOffer from './DeliveryOffer';

const DRAFT_KEY = 'ferrato:buyer';
const inputBase =
  'w-full min-h-11 rounded-lg border bg-white px-4 py-3 outline-none focus:ring-2';
const inputOk = 'border-stone-300 focus:border-brand-500 focus:ring-brand-100';
const inputErr = 'border-red-500 focus:border-red-600 focus:ring-red-100';

function loadDraft(): Buyer {
  if (typeof window === 'undefined') return emptyBuyer();
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? hydrateBuyer(JSON.parse(raw)) : emptyBuyer();
  } catch {
    return emptyBuyer();
  }
}

export default function CheckoutForm() {
  const items = useStore($cart);
  const total = useStore($cartTotal);
  const submitting = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [buyer, setBuyer] = useState<Buyer>(emptyBuyer);
  const [touched, setTouched] = useState<Partial<Record<BuyerField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState<'mp' | 'wa' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [suggestField, setSuggestField] = useState<'street' | 'locality'>('street');
  const [verifiedKey, setVerifiedKey] = useState('');
  const [localityOk, setLocalityOk] = useState('');
  const [postalOk, setPostalOk] = useState('');
  const [geoErrors, setGeoErrors] = useState<Partial<Record<'street' | 'locality' | 'postalCode', string>>>({});
  const [addressBusy, setAddressBusy] = useState(false);
  const [openList, setOpenList] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const streetRef = useRef<HTMLInputElement>(null);
  const localityRef = useRef<HTMLInputElement>(null);
  const lookupTimer = useRef<number>(0);
  const suggestAbort = useRef<AbortController | null>(null);
  const [shippingResult, setShippingResult] = useState<{ key: string; estimate: ShippingEstimate; subtotal: number } | null>(null);
  const [shippingBusy, setShippingBusy] = useState(false);
  const [shippingError, setShippingError] = useState('');
  const [payProductsOnly, setPayProductsOnly] = useState(false);
  const shippingKey = JSON.stringify([items.map((i) => [i.id, i.variant, i.quantity]), buyer.street.trim(), buyer.postalCode.trim(), buyer.locality.trim()]);
  const shipping = shippingResult?.key === shippingKey && shippingResult.subtotal === total ? shippingResult.estimate : null;
  const canPayMercadoPago = shipping?.amount != null || (payProductsOnly && shipping?.status === 'quote_required');

  const calculateShipping = async () => {
    const destinationError = streetFormatError(buyer.street) || postalCodeError(buyer.postalCode) || localityFormatError(buyer.locality);
    if (destinationError) { setShippingError(destinationError); setShippingResult(null); return; }
    setShippingBusy(true);
    setShippingError('');
    setShippingResult(null);
    const key = shippingKey;
    try {
      const res = await fetch('/api/shipping', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map((i) => ({ id: i.id, variant: i.variant, quantity: i.quantity })), street: buyer.street, postalCode: buyer.postalCode, locality: buyer.locality }),
      });
      const data = await res.json();
      if (!res.ok || !data.shipping) throw new Error(data.error ?? 'No pudimos calcular el envío.');
      setShippingResult({ key, estimate: data.shipping, subtotal: data.subtotal });
    } catch (err) { setShippingError(err instanceof Error ? err.message : 'Consultá el envío por WhatsApp.'); }
    finally { setShippingBusy(false); }
  };

  useEffect(() => {
    setBuyer(loadDraft());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(buyer));
    } catch {
      // The form remains usable when Safari/private browsing blocks persistence.
    }
  }, [buyer, mounted]);

  useEffect(() => {
    setPayProductsOnly(false);
  }, [shippingKey]);

  useEffect(() => {
    if (!mounted || items.length === 0) return;
    if (streetFormatError(buyer.street) || postalCodeError(buyer.postalCode) || localityFormatError(buyer.locality)) return;
    const timer = window.setTimeout(() => {
      void calculateShipping();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [shippingKey, mounted, items.length]);

  if (!mounted) return <p className="py-16 text-center text-steel">Cargando carrito…</p>;

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center">
        <p className="text-lg">Tu carrito está vacío.</p>
        <a href="/productos" className="btn-dark mt-6">
          Ver productos
        </a>
      </div>
    );
  }

  const validation = validateBuyer(buyer);
  const currentKey = `${buyer.street.trim()}|${buyer.locality.trim()}`;
  const verified = verifiedKey === currentKey && Boolean(verifiedKey);
  const localityVerified = localityOk === buyer.locality.trim() && Boolean(localityOk);
  const postalVerified =
    postalOk === `${buyer.postalCode.trim().toUpperCase()}|${buyer.locality.trim()}` && Boolean(postalOk);
  const showError = (field: BuyerField) => {
    if (!(submitted || touched[field])) return undefined;
    if (field === 'street') return validation.errors.street ?? geoErrors.street;
    if (field === 'locality') return validation.errors.locality ?? geoErrors.locality;
    if (field === 'postalCode') return validation.errors.postalCode ?? geoErrors.postalCode;
    return validation.errors[field];
  };

  const closeSuggestions = () => {
    setSuggestions([]);
    setOpenList(false);
    setActiveIndex(-1);
  };

  const placeCursor = (field: 'street' | 'locality', at: number) => {
    requestAnimationFrame(() => {
      const input = field === 'street' ? streetRef.current : localityRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(at, at);
    });
  };

  const lookupAddress = async (
    field: 'street' | 'locality' | 'postalCode',
    next: Buyer,
    mode: 'suggest' | 'verify' = 'verify',
  ) => {
    const query = field === 'street' ? next.street : field === 'locality' ? next.locality : next.postalCode;
    if (mode === 'suggest' && field !== 'postalCode' && query.trim().length < (field === 'locality' ? 2 : 3)) {
      closeSuggestions();
      return { verified: false as const };
    }
    suggestAbort.current?.abort();
    const abort = new AbortController();
    suggestAbort.current = abort;
    setAddressBusy(true);
    try {
      const params = new URLSearchParams();
      if (mode === 'suggest' && field !== 'postalCode') {
        params.set('type', field);
        params.set('q', query);
        if (field === 'street' && next.locality) params.set('locality', next.locality);
      } else if (field === 'locality') {
        params.set('type', 'verify-locality');
        params.set('q', next.locality);
      } else if (field === 'postalCode') {
        params.set('type', 'postal');
        params.set('q', next.postalCode);
        if (next.locality) params.set('locality', next.locality);
      } else {
        params.set('street', next.street);
        params.set('locality', next.locality);
      }
      const res = await fetch(`/api/address?${params}`, { signal: abort.signal });
      const data = (await res.json()) as {
        verified?: boolean;
        field?: 'street' | 'locality' | 'postalCode';
        normalized?: string;
        locality?: string;
        province?: string;
        postalCode?: string;
        match?: { street: string; number: number; locality: string; province: string };
        suggestions?: AddressSuggestion[];
        error?: string;
      };
      const options = data.suggestions ?? [];
      if (mode === 'suggest' && field !== 'postalCode') {
        setSuggestField(field);
        setSuggestions(options);
        setOpenList(options.length > 0);
        setActiveIndex(options.length > 0 ? 0 : -1);
      }
      if (data.verified && data.match) {
        const street = `${data.match.street} ${data.match.number}`;
        const locality = prettyLocality(data.match.locality, data.match.province);
        setBuyer((current) => ({ ...current, street, locality }));
        setVerifiedKey(`${street}|${locality}`);
        setLocalityOk(locality);
        setGeoErrors((current) => ({ ...current, street: undefined, locality: undefined }));
        if (mode === 'verify') closeSuggestions();
        return { verified: true as const, street, locality };
      }
      if (data.verified && field === 'locality' && data.locality) {
        setBuyer((current) => ({ ...current, locality: data.locality ?? current.locality }));
        setLocalityOk(data.locality);
        setGeoErrors((current) => ({ ...current, locality: undefined }));
        if (mode === 'verify') closeSuggestions();
        return { verified: true as const, locality: data.locality };
      }
      if (data.verified && field === 'postalCode') {
        setPostalOk(`${next.postalCode.trim().toUpperCase()}|${next.locality.trim()}`);
        setGeoErrors((current) => ({ ...current, postalCode: undefined }));
        return { verified: true as const };
      }
      if (mode === 'verify') {
        const errorField = data.field ?? (field === 'postalCode' ? 'postalCode' : /localidad|coincidencias/i.test(data.error ?? '') ? 'locality' : 'street');
        if (errorField === 'street') setVerifiedKey('');
        if (errorField === 'locality') setLocalityOk('');
        if (errorField === 'postalCode') setPostalOk('');
        setGeoErrors((current) => ({ ...current, [errorField]: data.error ?? 'Revisá este dato.' }));
        if (options.length > 0 && (errorField === 'street' || errorField === 'locality')) {
          setSuggestField(errorField);
          setSuggestions(options);
          setOpenList(true);
          setActiveIndex(0);
        }
      }
      return { verified: false as const, error: data.error, field: data.field, suggestions: options };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return { verified: false as const };
      if (mode === 'verify') {
        const message = 'No pudimos verificar este dato. Probá de nuevo.';
        if (field === 'street') setVerifiedKey('');
        if (field === 'locality') setLocalityOk('');
        if (field === 'postalCode') setPostalOk('');
        setGeoErrors((current) => ({ ...current, [field]: message }));
        return { verified: false as const, error: message, field };
      }
      return { verified: false as const, error: 'No pudimos verificar este dato. Probá de nuevo.' };
    } finally {
      if (suggestAbort.current === abort) setAddressBusy(false);
    }
  };

  const pickSuggestion = (suggestion: AddressSuggestion) => {
    const next = applySuggestion({ street: buyer.street, locality: buyer.locality }, suggestion);
    const verified = suggestion.kind === 'address';
    setBuyer((current) => ({ ...current, street: next.street, locality: next.locality }));
    setGeoErrors((current) => ({
      ...current,
      street: verified ? undefined : current.street,
      locality: suggestion.kind === 'locality' || verified ? undefined : current.locality,
    }));
    closeSuggestions();
    if (suggestion.kind === 'locality') {
      setLocalityOk(next.locality.trim());
      setPostalOk('');
      setVerifiedKey('');
    }
    if (verified) {
      setVerifiedKey(`${next.street.trim()}|${next.locality.trim()}`);
      setLocalityOk(next.locality.trim());
      return;
    }
    setVerifiedKey('');
    if (suggestion.kind === 'street' && next.street.endsWith(' ')) placeCursor('street', next.street.length);
    if (suggestion.kind === 'locality' && next.street && !streetFormatError(next.street)) {
      window.clearTimeout(lookupTimer.current);
      lookupTimer.current = window.setTimeout(
        () => lookupAddress('street', { ...buyer, ...next }, 'verify'),
        200,
      );
    }
  };

  const update = (field: BuyerField) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    const next = { ...buyer, [field]: value };
    setBuyer(next);
    if (field === 'street' || field === 'locality' || field === 'postalCode') {
      if (field === 'street') setVerifiedKey('');
      if (field === 'locality') {
        setVerifiedKey('');
        setLocalityOk('');
        setPostalOk('');
      }
      if (field === 'postalCode') setPostalOk('');
      setGeoErrors((current) => ({ ...current, [field]: undefined }));
    }
    if (field === 'street' || field === 'locality') {
      window.clearTimeout(lookupTimer.current);
      lookupTimer.current = window.setTimeout(() => lookupAddress(field, next, 'suggest'), 280);
    }
  };

  const blur = (field: BuyerField) => () => {
    setTouched((current) => ({ ...current, [field]: true }));
    if (field === 'street' || field === 'locality') {
      window.setTimeout(() => setOpenList(false), 120);
    }
    if (field === 'locality' && !localityFormatError(buyer.locality)) {
      lookupAddress('locality', buyer, 'verify');
      return;
    }
    if (field === 'postalCode' && !postalCodeError(buyer.postalCode)) {
      lookupAddress('postalCode', buyer, 'verify');
      return;
    }
    const key = `${buyer.street.trim()}|${buyer.locality.trim()}`;
    if (field === 'street' && buyer.street && buyer.locality && key !== verifiedKey) {
      lookupAddress('street', buyer, 'verify');
    }
  };

  const onAddressKeyDown = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === 'Escape') {
      setOpenList(false);
      return;
    }
    if (!openList || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0 && suggestions[activeIndex]) {
      event.preventDefault();
      pickSuggestion(suggestions[activeIndex]);
    }
  };

  const payload = () => ({
    items: items.map((i) => ({ id: i.id, variant: i.variant, quantity: i.quantity })),
    buyer,
    shippingAmount: shipping?.amount ?? (payProductsOnly ? 0 : undefined),
  });

  const focusFirstError = (errors: Partial<Record<BuyerField, string>>) => {
    const first = BUYER_FIELDS.find(({ id }) => errors[id]);
    if (!first) return;
    summaryRef.current?.focus();
    document.getElementById(first.id)?.focus();
  };

  const ensureValid = async () => {
    setSubmitted(true);
    setError(null);
    const next = validateBuyer(buyer);
    const errors: Partial<Record<BuyerField, string>> = { ...next.errors };
    let locality = buyer.locality;

    if (!errors.locality) {
      const localityCheck = localityVerified
        ? { verified: true as const, locality: buyer.locality }
        : await lookupAddress('locality', buyer, 'verify');
      if (!localityCheck.verified) {
        errors.locality = localityCheck.error ?? 'Indicá una localidad real.';
      } else if (localityCheck.locality) {
        locality = localityCheck.locality;
      }
    }

    const current = { ...buyer, locality };
    if (!errors.street && !errors.locality) {
      const addressCheck = verified ? { verified: true as const } : await lookupAddress('street', current, 'verify');
      if (!addressCheck.verified) {
        errors.street = addressCheck.error ?? 'Confirmá una calle y número reales.';
      }
    }

    if (!errors.postalCode) {
      const postalCheck = postalVerified
        ? { verified: true as const }
        : await lookupAddress('postalCode', current, 'verify');
      if (!postalCheck.verified) {
        errors.postalCode = postalCheck.error ?? 'Indicá un código postal real.';
      }
    }

    if (Object.keys(errors).length > 0) {
      focusFirstError(errors);
      return false;
    }
    return true;
  };

  const payWithMercadoPago = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (submitting.current) return;
    if (!canPayMercadoPago) {
      setError('Consultá el envío o confirmá que vas a pagar solo los productos.');
      return;
    }
    if (!(await ensureValid())) return;
    submitting.current = true;
    track('begin_checkout', { currency: 'ARS', value: total, items: items.map(ecommerceItem) });
    setLoading('mp');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const data = await res.json();
      if (!res.ok || !data.initPoint) throw new Error(data.error ?? 'No se pudo iniciar el pago.');
      track('checkout_submit', { payment_method: 'mercadopago' });
      window.location.href = data.initPoint;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado.');
      submitting.current = false;
      track('checkout_error', { stage: 'create_preference' });
      setLoading(null);
    }
  };

  const orderByWhatsApp = async () => {
    if (submitting.current) return;
    if (!(await ensureValid())) return;
    submitting.current = true;
    setLoading('wa');
    try {
      await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
    } catch {
      // El pedido por WhatsApp sigue; Notion es un respaldo.
    }
    track('checkout_submit', { payment_method: 'whatsapp' });
    window.location.href = buildWhatsAppOrderUrl(items, buyer, shipping);
  };

  const visibleErrors = BUYER_FIELDS.filter(({ id }) => showError(id));

  return (
    <div className="checkout-shell">
      <div className="checkout-layout">
        <section aria-label="Productos" className="h-fit rounded-2xl border border-stone-200 bg-white">
          <ul className="divide-y divide-stone-100">
            {items.map((item) => (
              <li key={lineKey(item)} className="flex flex-wrap items-start gap-4 p-5">
                <img
                  src={productImage(item.image, 160)}
                  alt=""
                  width={80}
                  height={80}
                  className="h-20 w-20 shrink-0 rounded-xl bg-brand-50 object-cover"
                />
                <div className="min-w-0 flex-1 basis-48">
                  <a href={`/productos/${item.slug}`} className="font-semibold hover:text-brand-700">
                    {item.name}
                    {item.variant && (
                      <span className="block text-xs font-normal text-steel">{item.variant}</span>
                    )}
                  </a>
                  <p className="text-sm text-steel">{formatPrice(item.price)} c/u</p>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex items-center rounded-md border border-stone-300">
                      <button
                        type="button"
                        className="min-h-11 min-w-11 px-3"
                        onClick={() => setQuantity(lineKey(item), item.quantity - 1)}
                        aria-label="Restar"
                      >
                        −
                      </button>
                      <span className="w-8 text-center">{item.quantity}</span>
                      <button
                        type="button"
                        className="min-h-11 min-w-11 px-3"
                        onClick={() => setQuantity(lineKey(item), item.quantity + 1)}
                        aria-label="Sumar"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className="text-sm text-red-600 hover:underline"
                      onClick={() => removeFromCart(lineKey(item))}
                    >
                      Quitar
                    </button>
                  </div>
                </div>
                <span className="ml-auto text-lg font-bold">{formatPrice(item.price * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-2 border-t border-stone-200 p-5">
            <div className="flex justify-between"><span>Productos</span><span>{formatPrice(total)}</span></div>
            <div className="flex justify-between"><span>Envío</span><span>{shipping?.amount != null ? formatPrice(shipping.amount) : 'A cotizar'}</span></div>
            <div className="flex justify-between text-xl font-bold">
              <span>{shipping?.amount != null ? 'Total con envío' : 'Subtotal productos'}</span>
              <span>{formatPrice(total + (shipping?.amount ?? 0))}</span>
            </div>
            {shipping?.amount == null && <p className="text-xs text-steel">El envío se confirma antes del pago. No está incluido en el subtotal.</p>}
          </div>
        </section>

        <form onSubmit={payWithMercadoPago} noValidate className="h-fit space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="section-title">Tus datos</h2>
          <p className="text-sm text-steel">Los campos con * son obligatorios para coordinar el envío.</p>

          {submitted && visibleErrors.length > 0 && (
            <div
              ref={summaryRef}
              tabIndex={-1}
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              <p className="font-semibold">Revisá estos datos:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {visibleErrors.map(({ id, label }) => (
                  <li key={id}>
                    <a href={`#${id}`} className="underline">
                      {label}: {showError(id)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-semibold">
              Nombre y apellido <span className="text-red-700">*</span>
            </label>
            <input
              id="name"
              className={`${inputBase} ${showError('name') ? inputErr : inputOk}`}
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="next"
              value={buyer.name}
              onChange={update('name')}
              onBlur={blur('name')}
              aria-invalid={Boolean(showError('name'))}
              aria-describedby={showError('name') ? 'name-error' : undefined}
            />
            {showError('name') && (
              <p id="name-error" className="mt-1 text-sm text-red-700">
                {showError('name')}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-semibold">
              Email <span className="text-red-700">*</span>
            </label>
            <input
              id="email"
              type="email"
              className={`${inputBase} ${showError('email') ? inputErr : inputOk}`}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="email"
              enterKeyHint="next"
              value={buyer.email}
              onChange={update('email')}
              onBlur={blur('email')}
              aria-invalid={Boolean(showError('email'))}
              aria-describedby={showError('email') ? 'email-error' : undefined}
            />
            {showError('email') && (
              <p id="email-error" className="mt-1 text-sm text-red-700">
                {showError('email')}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="phone" className="mb-1 block text-sm font-semibold">
              Teléfono <span className="text-red-700">*</span>
            </label>
            <input
              id="phone"
              type="tel"
              className={`${inputBase} ${showError('phone') ? inputErr : inputOk}`}
              autoComplete="tel"
              inputMode="tel"
              enterKeyHint="next"
              value={buyer.phone}
              onChange={update('phone')}
              onBlur={blur('phone')}
              aria-invalid={Boolean(showError('phone'))}
              aria-describedby={showError('phone') ? 'phone-error' : 'phone-hint'}
            />
            {showError('phone') ? (
              <p id="phone-error" className="mt-1 text-sm text-red-700">
                {showError('phone')}
              </p>
            ) : (
              <p id="phone-hint" className="mt-1 text-xs text-steel">
                Con código de área, por ejemplo 11 3100 8720.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <label htmlFor="street" className="mb-1 block text-sm font-semibold">
                Calle y número <span className="text-red-700">*</span>
              </label>
              <input
                ref={streetRef}
                id="street"
                role="combobox"
                aria-expanded={openList && suggestField === 'street'}
                aria-controls="street-list"
                aria-autocomplete="list"
                aria-activedescendant={
                  openList && suggestField === 'street' && activeIndex >= 0 ? `street-option-${activeIndex}` : undefined
                }
                className={`${inputBase} ${showError('street') ? inputErr : inputOk}`}
                autoComplete="street-address"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="next"
                value={buyer.street}
                onChange={update('street')}
                onBlur={blur('street')}
                onFocus={() => setSuggestField('street')}
                onKeyDown={onAddressKeyDown}
                aria-invalid={Boolean(showError('street'))}
                aria-describedby={showError('street') ? 'street-error' : 'street-hint'}
              />
              {openList && suggestField === 'street' && suggestions.length > 0 && (
                <ul
                  id="street-list"
                  role="listbox"
                  className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
                >
                  {suggestions.map((suggestion, index) => (
                    <li
                      key={suggestion.id}
                      id={`street-option-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                    >
                      <button
                        type="button"
                        className={`flex min-h-11 w-full items-start gap-3 px-4 py-2.5 text-left text-sm hover:bg-brand-50 ${
                          index === activeIndex ? 'bg-brand-50' : ''
                        }`}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => pickSuggestion(suggestion)}
                      >
                        <span className="mt-0.5 w-16 shrink-0 text-[11px] font-medium text-steel">
                          {suggestionKindLabel(suggestion.kind)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{suggestion.title}</span>
                          {suggestion.subtitle && (
                            <span className="block text-xs text-steel">{suggestion.subtitle}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {showError('street') ? (
                <p id="street-error" className="mt-1 text-sm text-red-700">
                  {showError('street')}
                </p>
              ) : (
                <p id="street-hint" className="mt-1 text-xs text-steel">
                  {addressBusy && suggestField === 'street'
                    ? 'Buscando calles…'
                    : 'Por ejemplo Av. Corrientes 1234.'}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="unit" className="mb-1 block text-sm font-semibold">
                Piso / depto
              </label>
              <input
                id="unit"
                className={`${inputBase} ${showError('unit') ? inputErr : inputOk}`}
                autoComplete="address-line2"
                enterKeyHint="next"
                value={buyer.unit}
                onChange={update('unit')}
                onBlur={blur('unit')}
                aria-invalid={Boolean(showError('unit'))}
                aria-describedby={showError('unit') ? 'unit-error' : 'unit-hint'}
              />
              {showError('unit') ? (
                <p id="unit-error" className="mt-1 text-sm text-red-700">
                  {showError('unit')}
                </p>
              ) : (
                <p id="unit-hint" className="mt-1 text-xs text-steel">
                  Opcional, por ejemplo 3° B.
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <label htmlFor="locality" className="mb-1 block text-sm font-semibold">
                Localidad <span className="text-red-700">*</span>
              </label>
              <input
                ref={localityRef}
                id="locality"
                role="combobox"
                aria-expanded={openList && suggestField === 'locality'}
                aria-controls="locality-list"
                aria-autocomplete="list"
                aria-activedescendant={
                  openList && suggestField === 'locality' && activeIndex >= 0
                    ? `locality-option-${activeIndex}`
                    : undefined
                }
                className={`${inputBase} ${showError('locality') ? inputErr : inputOk}`}
                autoComplete="address-level2"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="next"
                value={buyer.locality}
                onChange={update('locality')}
                onBlur={blur('locality')}
                onFocus={() => setSuggestField('locality')}
                onKeyDown={onAddressKeyDown}
                aria-invalid={Boolean(showError('locality'))}
                aria-describedby={showError('locality') ? 'locality-error' : 'locality-hint'}
              />
              {openList && suggestField === 'locality' && suggestions.length > 0 && (
                <ul
                  id="locality-list"
                  role="listbox"
                  className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
                >
                  {suggestions.map((suggestion, index) => (
                    <li
                      key={suggestion.id}
                      id={`locality-option-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                    >
                      <button
                        type="button"
                        className={`flex min-h-11 w-full items-start gap-3 px-4 py-2.5 text-left text-sm hover:bg-brand-50 ${
                          index === activeIndex ? 'bg-brand-50' : ''
                        }`}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => pickSuggestion(suggestion)}
                      >
                        <span className="mt-0.5 w-16 shrink-0 text-[11px] font-medium text-steel">
                          {suggestionKindLabel(suggestion.kind)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{suggestion.title}</span>
                          {suggestion.subtitle && (
                            <span className="block text-xs text-steel">{suggestion.subtitle}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {showError('locality') ? (
                <p id="locality-error" className="mt-1 text-sm text-red-700">
                  {showError('locality')}
                </p>
              ) : verified ? (
                <p id="locality-hint" className="mt-1 text-xs text-green-700">
                  Dirección verificada.
                </p>
              ) : localityVerified ? (
                <p id="locality-hint" className="mt-1 text-xs text-green-700">
                  Localidad verificada.
                </p>
              ) : (
                <p id="locality-hint" className="mt-1 text-xs text-steel">
                  {addressBusy && suggestField === 'locality' ? 'Buscando localidades…' : 'Solo AMBA. Por ejemplo CABA o Quilmes.'}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="postalCode" className="mb-1 block text-sm font-semibold">
                Código postal <span className="text-red-700">*</span>
              </label>
              <input
                id="postalCode"
                className={`${inputBase} ${showError('postalCode') ? inputErr : inputOk}`}
                autoComplete="postal-code"
                autoCapitalize="characters"
                inputMode="text"
                enterKeyHint="next"
                value={buyer.postalCode}
                onChange={update('postalCode')}
                onBlur={blur('postalCode')}
                aria-invalid={Boolean(showError('postalCode'))}
                aria-describedby={showError('postalCode') ? 'postal-error' : 'postal-hint'}
              />
              {showError('postalCode') ? (
                <p id="postal-error" className="mt-1 text-sm text-red-700">
                  {showError('postalCode')}
                </p>
              ) : postalVerified ? (
                <p id="postal-hint" className="mt-1 text-xs text-green-700">
                  Código postal verificado.
                </p>
              ) : (
                <p id="postal-hint" className="mt-1 text-xs text-steel">
                  Por ejemplo 1043 o C1043AAE.
                </p>
              )}
            </div>
          </div>

          <section aria-labelledby="shipping-title" className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <h2 id="shipping-title" className="font-semibold">Costo de envío</h2>
            <div className="mt-3"><DeliveryOffer /></div>
            <p className="mt-3 text-sm">Completá calle y número, localidad y código postal para confirmar la tarifa. Por ahora entregamos solo dentro de AMBA.</p>
            <button type="button" className="btn-dark mt-3 w-full" disabled={shippingBusy || !buyer.street.trim() || !buyer.locality.trim() || !buyer.postalCode.trim()} onClick={calculateShipping}>
              {shippingBusy ? 'Consultando…' : 'Consultar costo de envío'}
            </button>
            <p role="status" className="mt-3 text-sm">{shippingError || shipping?.message || 'La tarifa se aplica a todo tu pedido y se suma al precio de los productos. Coordinamos el día de entrega por WhatsApp.'}</p>
            {shipping?.amount != null && <p className="mt-2 font-semibold">Costo de envío: {formatPrice(shipping.amount)}</p>}
            {shipping?.status === 'quote_required' && shipping.reference && <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3"><p className="font-semibold">Envío orientativo: {formatPrice(shipping.reference.amount)}</p><p className="mt-1 text-sm">{shipping.reference.message}</p></div>}
            {shipping?.status === 'quote_required' && (
              <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-stone-200 bg-white p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                  checked={payProductsOnly}
                  onChange={(e) => setPayProductsOnly(e.target.checked)}
                />
                <span>
                  Pagar ahora solo los productos ({formatPrice(total)}). El envío se coordina por WhatsApp y no está incluido en este cobro.
                </span>
              </label>
            )}
            {shipping?.status === 'quote_required' && <a className="mt-3 inline-block font-semibold underline" href={buildWhatsAppOrderUrl(items, buyer, shipping)} target="_blank" rel="noopener">Consultar envío por WhatsApp ↗</a>}
          </section>

          <p className="sr-only" aria-live="polite">
            {openList && suggestions.length > 0
              ? `${suggestions.length} sugerencias`
              : addressBusy
                ? 'Buscando coincidencias'
                : ''}
          </p>

          <div>
            <label htmlFor="notes" className="mb-1 block text-sm font-semibold">
              Notas del pedido
            </label>
            <textarea
              id="notes"
              className={`${inputBase} ${showError('notes') ? inputErr : inputOk}`}
              rows={2}
              maxLength={500}
              enterKeyHint="done"
              value={buyer.notes}
              onChange={update('notes')}
              onBlur={blur('notes')}
              aria-invalid={Boolean(showError('notes'))}
              aria-describedby={showError('notes') ? 'notes-error' : undefined}
            />
            {showError('notes') && (
              <p id="notes-error" className="mt-1 text-sm text-red-700">
                {showError('notes')}
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={Boolean(loading) || shippingBusy || !canPayMercadoPago}
            className="btn w-full bg-[#009ee3] text-white hover:bg-[#0086c3]"
          >
            {loading === 'mp' ? 'Redirigiendo…' : 'Pagar con Mercado Pago'}
          </button>
          {!canPayMercadoPago && (
            <p className="text-xs text-steel">
              {shipping?.status === 'quote_required'
                ? 'No hay tarifa automática de envío. Marcá la opción de pagar solo los productos o pedí por WhatsApp.'
                : 'Consultá el costo de envío para habilitar Mercado Pago.'}
            </p>
          )}
          <div className="flex items-center gap-3 text-xs text-stone-400">
            <span className="h-px flex-1 bg-stone-200" /> o <span className="h-px flex-1 bg-stone-200" />
          </div>
          <button
            type="button"
            disabled={Boolean(loading)}
            onClick={orderByWhatsApp}
            className="btn-whatsapp w-full"
          >
            {loading === 'wa' ? 'Abriendo WhatsApp…' : 'Pedir por WhatsApp'}
          </button>
          <p className="text-xs text-steel">
            Usamos tus datos para gestionar el pedido.{' '}
            <a href="/privacidad" className="underline">
              Consultá nuestra política de privacidad
            </a>
            .
          </p>
          <p className="text-center text-xs text-steel">
            Pagá con tarjeta, en cuotas, con dinero en cuenta o efectivo.
          </p>
        </form>
      </div>
    </div>
  );
}
