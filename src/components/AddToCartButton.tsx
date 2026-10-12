import { useState } from 'react';
import { addToCart } from '@/lib/cart';
import { whatsappContactUrl } from '@/lib/whatsapp';

export interface AddToCartProduct {
  id: string;
  slug: string;
  name: string;
  /** null = sin precio publicado → se consulta por WhatsApp */
  price: number | null;
  image: string;
  maxStock: number;
  colors: string[];
  /** Fotos de cada color. Al elegirlo, la ficha cambia la galería. */
  imagesByColor?: Record<string, string[]>;
}

interface Props {
  product: AddToCartProduct;
  compact?: boolean;
  withQuantity?: boolean;
}

export default function AddToCartButton({ product, compact = false, withQuantity = false }: Props) {
  const [qty, setQty] = useState(1);
  const [color, setColor] = useState(product.colors[0]);
  const [added, setAdded] = useState(false);
  const outOfStock = product.maxStock <= 0;
  const needsColorChoice = product.colors.length > 1;

  if (product.price === null) {
    return (
      <a
        href={whatsappContactUrl(`¡Hola! Quiero consultar el precio de: ${product.name}`)}
        target="_blank"
        rel="noopener"
        className={`btn-whatsapp w-full ${compact ? 'mt-2 py-2 text-sm' : 'mt-6'}`}
      >
        Consultar precio
      </a>
    );
  }
  const price = product.price;

  // En la tarjeta del listado, si hay que elegir color mandamos a la ficha del producto.
  if (compact && needsColorChoice) {
    return (
      <a href={`/productos/${product.slug}`} className="btn-primary mt-2 w-full py-2 text-sm">
        Elegir color
      </a>
    );
  }

  const onAdd = () => {
    addToCart(
      {
        id: product.id,
        slug: product.slug,
        name: product.name,
        price,
        image: product.imagesByColor?.[color]?.[0] ?? product.image,
        maxStock: product.maxStock,
        variant: color,
      },
      qty,
    );
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className={compact ? 'mt-2' : 'mt-6'}>
      {!compact && product.colors.length > 0 && (
        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-semibold">Color: {color}</legend>
          {needsColorChoice && (
            <div className="flex flex-wrap gap-2">
              {product.colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setColor(c);
                    const images = product.imagesByColor?.[c];
                    if (images?.length) {
                      window.dispatchEvent(new CustomEvent('ferrato:color', { detail: { images } }));
                    }
                  }}
                  aria-pressed={c === color}
                  className={`pressable rounded-lg border px-4 py-2 text-sm font-medium ${
                    c === color ? 'border-ink bg-ink text-white' : 'border-stone-300 bg-white'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}
      <div className={withQuantity ? 'product-purchase-controls' : 'flex gap-3'}>
        {withQuantity && !outOfStock && (
          <div className="flex items-center rounded-lg border border-stone-300 bg-white">
            <button
              type="button"
              className="pressable min-h-11 min-w-11 px-3 py-2 text-lg"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              aria-label="Restar"
            >
              −
            </button>
            <span className="w-8 text-center font-semibold" aria-live="polite">
              {qty}
            </span>
            <button
              type="button"
              className="pressable min-h-11 min-w-11 px-3 py-2 text-lg"
              onClick={() => setQty((q) => Math.min(product.maxStock, q + 1))}
              aria-label="Sumar"
            >
              +
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onAdd}
          disabled={outOfStock}
          className={`btn-primary min-w-0 flex-1 ${compact ? 'py-2 text-sm' : ''}`}
        >
          <span className={added ? 'btn-label is-confirm' : 'btn-label'}>
            {outOfStock ? 'Sin stock' : added ? '¡Agregado! ✓' : 'Agregar al carrito'}
          </span>
        </button>
      </div>
    </div>
  );
}
