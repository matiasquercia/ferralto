# Ferrato 🪜

Tienda online de **escaleras Safari, tenders, banquitos** y productos de **ferretería / construcción**.
Construida con [Astro](https://astro.build) + islas de React, Tailwind CSS, carrito persistente y checkout con
**Mercado Pago** o **pedido por WhatsApp**.

## Stack

| Parte          | Tecnología                                                                     |
| -------------- | ------------------------------------------------------------------------------ |
| Framework      | Astro 7 (páginas estáticas + rutas de servidor puntuales)                      |
| Interactividad | Islas React 19 (carrito, botones, checkout)                                    |
| Estilos        | Tailwind CSS 4                                                                 |
| Estado carrito | nanostores, persistido en `localStorage`                                       |
| Pagos          | Mercado Pago Checkout Pro (SDK oficial `mercadopago`) + WhatsApp               |
| Catálogo       | `src/data/catalog.json`                                                        |
| SEO            | Meta/OG por página, JSON-LD (Store, Product, Breadcrumb, FAQ), sitemap, robots |
| Deploy         | Cloudflare Workers (adapter `@astrojs/cloudflare`)                              |

## Empezar

Requisitos: Node 22+.

```bash
npm install
cp .env.example .env     # completá las variables
npm run dev              # http://localhost:4321
```

| Script                    | Qué hace                                |
| ------------------------- | --------------------------------------- |
| `npm run dev`             | Servidor de desarrollo                  |
| `npm run build`           | Build de producción                     |
| `npm run preview`         | Sirve el build localmente               |
| `npm run check`           | Chequeo de tipos (TypeScript + Astro)   |
| `npm run format`          | Formatea el código con Prettier         |
| `npm run images:download` | Descarga las fotos de productos al repo |

## Variables de entorno

| Variable                 | Descripción                                                           |
| ------------------------ | --------------------------------------------------------------------- |
| `PUBLIC_SITE_URL`        | URL pública (canonical, sitemap, URLs de retorno de MP)               |
| `PUBLIC_WHATSAPP_NUMBER` | Número de ventas, formato `5491123456789`                             |
| `MP_ACCESS_TOKEN`        | Access token de Mercado Pago (**secreto**, sólo servidor)             |
| `MP_WEBHOOK_SECRET`      | Clave secreta de webhooks para validar la firma de las notificaciones |
| `NOTION_TOKEN`           | Token de la integración de Notion (**secreto**)                       |
| `NOTION_DATABASE_ID`     | ID de la base de pedidos en Notion (**secreto**)                      |
| `PUBLIC_GA_ID`           | (opcional) Google Analytics 4                                         |
| `PUBLIC_META_PIXEL_ID`   | (opcional) Meta Pixel para campañas en Instagram/Facebook             |

## Estructura

```
src/
├── data/catalog.json          # Categorías y productos
├── lib/
│   ├── catalog.ts             # Tipos y helpers del catálogo
│   ├── cart.ts                # Store del carrito (nanostores)
│   ├── whatsapp.ts            # Arma el mensaje de pedido para WhatsApp
│   ├── mercadopago.server.ts  # Cliente MP (sólo servidor)
│   ├── format.ts / site.ts    # Formato ARS y datos del negocio
├── components/                # Header, Footer, ProductCard, CartDrawer, CheckoutForm…
├── layouts/BaseLayout.astro   # SEO, Open Graph, JSON-LD, analytics
└── pages/
    ├── index.astro
    ├── productos/[slug].astro # Ficha de producto (JSON-LD Product)
    ├── categoria/[slug].astro
    ├── carrito.astro          # Checkout
    ├── checkout/{exito,pendiente,error}.astro
    ├── api/checkout.ts        # POST → crea preferencia de Mercado Pago
    ├── api/webhooks/mercadopago.ts
    └── robots.txt.ts
```

## Catálogo

El catálogo está en `src/data/catalog.json`: **19 productos Safari** en 5 categorías, extraídos de
[safarimetalurgica.com](https://www.safarimetalurgica.com) (septiembre 2026). Los datos crudos del relevamiento están
en `scripts/safari-raw.json`.

| Categoría          | Productos                                                                            |
| ------------------ | ------------------------------------------------------------------------------------ |
| Escaleras Safari   | Fija 2 peldaños (2012) y tijera de 2 a 7 peldaños (2002–2007)                        |
| Banquetas          | Plegable (2001) y plegable reforzada (2011)                                          |
| Tenders            | De pie: Básico, Con alas, Con alas reforzado · Extensibles 45x7 (1051) y 60x7 (1052) |
| Tablas de planchar | Básica (2501), Esencial (2502), Premier (2540), Silver (2550)                        |
| Agarraderas        | Agarradera de seguridad                                                              |

### Precios y stock

El catálogo contiene precios cargados. Mientras un
producto no tenga precio, la tienda muestra **"Precio a consultar"** y un botón de WhatsApp en lugar de "Agregar al
carrito". Para habilitar la venta online, cargá el precio (ARS, entero):

```jsonc
{
  "id": "SAF-2005", // único, no cambiar una vez publicado (usa el código de artículo Safari)
  "slug": "escalera-safari-5-peldanos", // URL: /productos/<slug>
  "sku": "SAF-2005",
  "name": "Escalera Safari 5 peldaños",
  "brand": "Safari",
  "category": "escaleras",
  "price": 89900, // null = "Precio a consultar"
  "compareAtPrice": null, // precio tachado (opcional)
  "stock": null, // null = sin control de stock; un número limita la cantidad
  "featured": true, // aparece en la home
  "colors": ["Blanco brillante", "Negro brillante"], // con 2+ colores el cliente elige al comprar
  "images": ["https://static.wixstatic.com/media/…"],
  "shortDescription": "…",
  "description": "…",
  "specs": { "Peso": "8,8 kg", "Altura abierta": "1,60 m" },
}
```

El servidor **siempre recalcula el total desde el catálogo** y valida el color elegido; nunca confía en lo que manda
el navegador.

### Imágenes

Las fotos apuntan al CDN de Wix de Safari y se sirven redimensionadas (`src/lib/images.ts`). Para no depender de su
sitio, bajalas al repo una vez:

```bash
npm run images:download   # guarda en public/images/productos/ y actualiza catalog.json
```

> Las fotos y descripciones son de Safari Metalúrgica. Confirmá con ellos que las puedas usar como revendedor.

## Pagos

### Mercado Pago (Checkout Pro)

1. Creá una aplicación en el [panel de desarrolladores](https://www.mercadopago.com.ar/developers/panel/app).
2. Usá las **credenciales de prueba** en `.env` para desarrollar y
   [cuentas de prueba](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/test/accounts) para simular
   compras.
3. En producción cargá el access token de **producción** en las variables de entorno del hosting.
4. Configurá el webhook en _Tu aplicación → Webhooks_, evento **Pagos**, URL
   `https://TU-DOMINIO/api/webhooks/mercadopago`, y copiá la clave secreta a `MP_WEBHOOK_SECRET`.

Flujo: carrito → `POST /api/checkout` (valida stock y precios) → redirección a Mercado Pago → vuelve a
`/checkout/exito|pendiente|error` → Mercado Pago notifica al webhook.

> `auto_return` y `notification_url` sólo se envían cuando `PUBLIC_SITE_URL` es `https://`. En local, usá un túnel
> (ngrok / cloudflared) si querés probar el webhook.

### WhatsApp

El botón _Pedir por WhatsApp_ abre un chat con el detalle del pedido y los datos del comprador. También hay un botón
flotante y uno de consulta en cada producto.

## SEO y redes

- HTML pre-renderizado para todas las páginas de catálogo (rápido e indexable).
- `title`, `description`, canonical, Open Graph y Twitter Card por página. Imagen OG por defecto: `public/og-default.png`.
- Datos estructurados: `Store`, `Product` + `Offer` (precio/stock → rich results), `BreadcrumbList`, `FAQPage`.
- `sitemap-index.xml` automático y `robots.txt` (excluye carrito, checkout y API).
- GA4, Google Ads y Meta requieren configuración y consentimiento. Ver [auditoría y conexión de medición](AUDIT-MEASUREMENT.md).

Después del primer deploy: registrá el dominio en [Google Search Console](https://search.google.com/search-console)
y enviá `https://TU-DOMINIO/sitemap-index.xml`.

## Deploy

Cada push a `main` publica el Worker `ferralto` en Cloudflare (`.github/workflows/deploy.yml`).
El dominio es `https://ferralto.com` (`www.ferralto.com` también). URL alternativa:
`https://ferralto.builditlikegod.workers.dev`.

### Secretos de GitHub (obligatorio para el deploy automático)

En el repo: **Settings → Secrets and variables → Actions**. Crear:

| Secret                   | Qué es                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`   | Token de Cloudflare con permiso de editar Workers y rutas del dominio  |
| `CLOUDFLARE_ACCOUNT_ID`  | Account ID (Workers & Pages → Overview, barra lateral derecha)         |
| `MP_ACCESS_TOKEN`        | Access token de **producción** de Mercado Pago                         |
| `MP_WEBHOOK_SECRET`      | Clave secreta del webhook de Mercado Pago                              |
| `NOTION_TOKEN`           | Token de la integración de Notion                                      |
| `NOTION_DATABASE_ID`     | ID de la base de pedidos                                               |
| `SHIPPING_ORIGIN_JSON`   | Opcional en CI. Reemplaza el origen de Caseros configurado en el flujo de despliegue. Ver `SHIPPING-OPERATIONS.md`. |

Token de Cloudflare: [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → *Create token* →
plantilla **Edit Cloudflare Workers**. Incluí la zona `ferralto.com` si el token pide permisos de zona.

Los valores de Mercado Pago y Notion se suben al Worker en cada deploy. Si un secreto queda vacío en GitHub,
no se pisa el valor que ya tenga el Worker.

Webhook de Mercado Pago: evento **Pagos**, URL `https://ferralto.com/api/webhooks/mercadopago`.

`PUBLIC_SITE_URL` y `PUBLIC_WHATSAPP_NUMBER` están en `wrangler.jsonc` (no son secretos).

Deploy local: `npm ci`, `npm run build`, `npm run deploy` con Wrangler autenticado.

Porkbun conserva el registro del dominio. Su delegación DNS está configurada a
`alfred.ns.cloudflare.com` y `blakely.ns.cloudflare.com`; los registros de correo
de Porkbun se conservan en Cloudflare. Universal SSL y Always Use HTTPS están
habilitados; la emisión del certificado depende de la activación de la zona.

**Otro hosting:** cambiá el adapter en `astro.config.mjs` (`@astrojs/node`, `@astrojs/netlify`, etc.).

## Subir a GitHub

```bash
git remote add origin git@github.com:TU-USUARIO/ferrato.git
git push -u origin main
```

GitHub Actions corre tests en cada PR (`.github/workflows/ci.yml`) y publica a Cloudflare
en cada push a `main` (`.github/workflows/deploy.yml`).

## Próximos pasos sugeridos

- [ ] Cargar precios y stock reales en `catalog.json`
- [ ] Guardar pedidos (DB o Google Sheets) y descontar stock desde el webhook
- [ ] Email de confirmación al comprador
- [x] Cálculo de envío por domicilio y productos del pedido
- [ ] Buscador y filtros por precio
- [ ] Panel / CMS para cargar productos sin tocar código
