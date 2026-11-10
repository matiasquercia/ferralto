export default function DeliveryOffer({ productId }: { productId?: string }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm">
      <p className="flex items-start gap-3 font-semibold">
        <svg className="shrink-0 text-brand-700" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M14 18V6H2v12h3m4 0h6m-1-10h4l4 5v5h-3"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>
        <span>Envío a domicilio en AMBA</span>
      </p>
      <p className="mt-2 text-steel">El costo depende de tu dirección y de los productos del pedido.</p>
      <a href={productId ? `/calcular-envio?producto=${encodeURIComponent(productId)}` : '/calcular-envio'} className="mt-2 inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-4">Calculá tu envío →</a>
    </div>
  );
}
