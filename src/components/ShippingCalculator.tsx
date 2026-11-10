import { useStore } from '@nanostores/react';
import { useEffect, useState, type SubmitEvent } from 'react';
import { applySuggestion, localityFormatError, postalCodeError, splitStreetAndNumber, streetFormatError } from '@/lib/address';
import { $cart, lineKey } from '@/lib/cart';
import { isPurchasable, maxQuantity, products } from '@/lib/catalog';
import { formatPrice } from '@/lib/format';
import { whatsappContactUrl } from '@/lib/whatsapp';
import { useShippingQuote } from './useShippingQuote';

const availableProducts = products.filter(isPurchasable);
const inputClass = 'mt-1 block min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 focus:border-brand-500 focus:outline-2 focus:outline-brand-500';

export default function ShippingCalculator() {
  const cart = useStore($cart);
  const [mode, setMode] = useState<'cart' | 'product'>('product');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [destination, setDestination] = useState({ street: '', locality: '', postalCode: '' });
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const requestedProduct = new URLSearchParams(window.location.search).get('producto');
    const match = availableProducts.find(({ id }) => id === requestedProduct);
    if (match) setProductId(match.id);
    else if ($cart.get().length) setMode('cart');
  }, []);

  const product = availableProducts.find(({ id }) => id === productId);
  const count = Number(quantity);
  const validQuantity = product && Number.isSafeInteger(count) && count >= 1 && count <= maxQuantity(product);
  const useCart = mode === 'cart' && cart.length > 0;
  const items = useCart ? cart : product && validQuantity ? [{ id: product.id, variant: product.colors[0], quantity: count }] : [];
  const quote = useShippingQuote(items, destination, requested);
  const shipping = quote.data?.shipping;

  function resetQuote() {
    setRequested(false);
    setError(undefined);
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const { street, locality, postalCode } = destination;
    const validation = streetFormatError(street) ||
      (!splitStreetAndNumber(street).number && 'Indicá el número al final de la calle.') ||
      localityFormatError(locality) || postalCodeError(postalCode);
    if (validation) {
      setError(validation);
      return;
    }
    if (!items.length) {
      setError('Elegí un producto y una cantidad válida para calcular el envío.');
      return;
    }
    setError(undefined);
    setRequested(true);
    quote.retry();
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-6 rounded-xl border border-stone-200 bg-white p-5 sm:p-8">
      <fieldset className="space-y-4">
        <legend className="font-semibold">Productos para cotizar</legend>
        {cart.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="quote-items" checked={useCart} onChange={() => { setMode('cart'); resetQuote(); }} /> Mi carrito</label>
            <label className="flex items-center gap-2"><input type="radio" name="quote-items" checked={!useCart} onChange={() => { setMode('product'); resetQuote(); }} /> Elegir un producto</label>
          </div>
        )}
        {useCart ? (
          <ul className="space-y-1 rounded-lg bg-stone-50 p-3 text-sm text-steel">
            {cart.map((item) => <li key={lineKey(item)}>{item.quantity} × {item.name}{item.variant ? ` (${item.variant})` : ''}</li>)}
          </ul>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <label className="text-sm font-semibold">Producto
              <select className={inputClass} required value={productId} onChange={(event) => { setProductId(event.target.value); setQuantity('1'); resetQuote(); }}>
                <option value="">Seleccioná un producto</option>
                {availableProducts.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold">Cantidad
              <input className={inputClass} type="number" min="1" max={product ? maxQuantity(product) : undefined} required value={quantity} onChange={(event) => { setQuantity(event.target.value); resetQuote(); }} />
            </label>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-semibold">Dirección de entrega</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {([
            ['street', 'Calle y número', 'Av. Corrientes 1234', 'street-address', 200],
            ['locality', 'Localidad', 'CABA', 'address-level2', 200],
            ['postalCode', 'Código postal', '1043 o C1043AAE', 'postal-code', 12],
          ] as const).map(([field, label, placeholder, autoComplete, maxLength]) => (
            <label key={field} className={`text-sm font-semibold ${field === 'street' ? 'sm:col-span-2' : ''}`}>
              {label}
              <input className={inputClass} required placeholder={placeholder} autoComplete={autoComplete} maxLength={maxLength} value={destination[field]} onChange={(event) => {
                setDestination({ ...destination, [field]: event.target.value });
                resetQuote();
              }} />
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" className="btn-primary w-full sm:w-auto" disabled={quote.busy}>
        {quote.busy ? 'Calculando…' : 'Calcular envío'}
      </button>

      <div role="status" className="text-sm">
        {(error || quote.data?.error) && <p className="text-red-700">{error || quote.data?.error}</p>}
        {shipping?.amount != null && (
          <p className="flex flex-wrap justify-between gap-2 rounded-lg bg-brand-50 p-4 text-base font-semibold">
            <span>Costo estimado de envío</span><span>{formatPrice(shipping.amount)}</span>
          </p>
        )}
        {shipping?.status === 'quote_required' && (
          <p>{shipping.message} <a className="font-semibold underline" href={whatsappContactUrl('¡Hola Ferralto! Quiero consultar el costo de un envío.')} target="_blank" rel="noopener">Contactar por WhatsApp</a></p>
        )}
      </div>
      {!!quote.data?.suggestions?.length && (
        <ul className="space-y-1" aria-label="Direcciones sugeridas">
          {quote.data.suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <button type="button" className="min-h-11 text-left text-sm font-semibold underline" onClick={() => {
                setDestination((current) => ({ ...current, ...applySuggestion(current, suggestion) }));
                resetQuote();
              }}>
                {suggestion.title}{suggestion.subtitle ? ` · ${suggestion.subtitle}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
