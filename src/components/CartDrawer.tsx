import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState } from 'react';
import { lineKey, $cart, $cartOpen, $cartTotal, removeFromCart, setQuantity } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { productImage } from '@/lib/images';
import DeliveryOffer from './DeliveryOffer';

export default function CartDrawer() {
  const open = useStore($cartOpen);
  const items = useStore($cart);
  const total = useStore($cartTotal);
  // El carrito vive en localStorage: renderizamos recién en el cliente para evitar errores de hidratación.
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    const scrollY = window.scrollY;
    const { position, top, width, overflow } = document.body.style;
    Object.assign(document.body.style, { position: 'fixed', top: `-${scrollY}px`, width: '100%', overflow: 'hidden' });
    return () => {
      Object.assign(document.body.style, { position, top, width, overflow });
      const scrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, scrollY);
      document.documentElement.style.scrollBehavior = scrollBehavior;
    };
  }, [open, mounted]);

  if (!mounted) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label="Carrito de compras"
      className="cart-modal fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 text-ink backdrop:bg-transparent"
      onCancel={(event) => { event.preventDefault(); $cartOpen.set(false); }}
      onClose={() => $cartOpen.set(false)}
    >
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={() => $cartOpen.set(false)}
      />
      <aside
        className="absolute top-0 right-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-stone-200 p-5">
          <h2 className="panel-title">Tu carrito</h2>
          <button
            type="button"
            onClick={() => $cartOpen.set(false)}
            className="min-h-11 min-w-11 rounded-lg p-2 hover:bg-stone-100"
            aria-label="Cerrar carrito"
          >
            ✕
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-steel">
            <p>Tu carrito está vacío.</p>
            <a href="/productos" className="btn-dark" onClick={() => $cartOpen.set(false)}>
              Ver productos
            </a>
          </div>
        ) : (
          <>
            <ul className="min-h-0 flex-1 divide-y divide-stone-100 overflow-y-auto overscroll-contain p-5">
              {items.map((item) => (
                <li key={lineKey(item)} className="flex flex-wrap gap-4 py-4">
                  <img
                    src={productImage(item.image, 160)}
                    alt=""
                    width={72}
                    height={72}
                    className="h-18 w-18 shrink-0 rounded-lg bg-brand-50 object-cover"
                  />
                  <div className="flex min-w-0 flex-1 basis-36 flex-col gap-1">
                    <a
                      href={`/productos/${item.slug}`}
                      className="text-sm font-semibold leading-snug hover:text-brand-700"
                    >
                      {item.name}
                      {item.variant && (
                        <span className="block text-xs font-normal text-steel">{item.variant}</span>
                      )}
                    </a>
                    <span className="text-sm text-steel">{formatPrice(item.price)}</span>
                    <div className="mt-1 flex items-center gap-3">
                      <div className="flex items-center rounded-md border border-stone-300">
                        <button
                          type="button"
                          className="min-h-11 min-w-11 px-2"
                          onClick={() => setQuantity(lineKey(item), item.quantity - 1)}
                          aria-label="Restar"
                        >
                          −
                        </button>
                        <span className="w-7 text-center text-sm">{item.quantity}</span>
                        <button
                          type="button"
                          className="min-h-11 min-w-11 px-2"
                          onClick={() => setQuantity(lineKey(item), item.quantity + 1)}
                          aria-label="Sumar"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="min-h-11 text-xs text-red-600 hover:underline"
                        onClick={() => removeFromCart(lineKey(item))}
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                  <span className="ml-auto font-semibold">{formatPrice(item.price * item.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="cart-modal-summary shrink-0 space-y-3 border-t border-stone-200 p-5">
              <div className="flex justify-between text-lg font-bold">
                <span>Subtotal productos</span>
                <span>{formatPrice(total)}</span>
              </div>
              <DeliveryOffer />
              <a href="/carrito" className="btn-primary w-full">
                Finalizar compra
              </a>
            </div>
          </>
        )}
      </aside>
    </dialog>
  );
}
