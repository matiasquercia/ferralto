import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import GeographicLib from 'geographiclib-geodesic';

function load(path, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText.replaceAll('import.meta.env.DEV', 'development')
    .replaceAll('import.meta.env.PUBLIC_SITE_URL', 'siteUrl');
  const context = { exports: {}, Date, console, ...globals, require(name) {
    if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
    return dependencies[name];
  } };
  vm.runInNewContext(source, context);
  return context.exports;
}
const delivery = load('lib/delivery.ts');
const shipping = load('lib/shipping.ts');
const data = (file) => JSON.parse(readFileSync(new URL(`../src/data/${file}.json`, import.meta.url), 'utf8'));
const catalog = data('catalog');
const safari = data('shipping/safari');
const neighborhoods = load('lib/shipping-neighborhoods.server.ts', {
  '@/data/shipping/caba-boundary.json': data('shipping/caba-boundary'),
  '@/data/shipping/caba-neighborhoods.json': data('shipping/caba-neighborhoods'),
});
const serverFor = (origin, development = false) => load('lib/shipping.server.ts', {
  './delivery': delivery, './shipping-neighborhoods.server': neighborhoods,
  './env.server': { serverSecret: () => origin },
  '@/data/catalog.json': catalog, '@/data/shipping/safari.json': safari, 'geographiclib-geodesic': GeographicLib,
}, { development });
const server = serverFor(undefined, true);
const caba = { province: 'Ciudad Autónoma de Buenos Aires', locality: 'CABA' };
const martelli = { province: 'Buenos Aires', department: 'Vicente López', locality: 'Villa Martelli', coordinates: { lat: -34.56, lon: -58.5 } };
const caseros = { province: 'Buenos Aires', department: 'Tres de Febrero', locality: 'Caseros' };
const WGS84 = GeographicLib.Geodesic.WGS84;
const atDistance = (meters) => {
  const { lat, lon } = safari.pilotOrigin;
  const { lat2, lon2 } = WGS84.Direct(lat, lon, 270, meters);
  return { ...caseros, coordinates: { lat: lat2, lon: lon2 } };
};
const item = (sku, quantity = 1) => ({ sku, quantity });
const quote = (lines, meters = 1000) => server.shippingForOrder(lines, atDistance(meters)).amount;

test('coverage validates the province and AMBA municipality', () => {
  assert.equal(delivery.deliveryZone(caba), 'caba');
  assert.equal(delivery.deliveryZone({ province: 'Capital Federal' }), 'caba');
  assert.equal(delivery.deliveryZone({ province: 'CABA' }), 'caba');
  assert.equal(delivery.deliveryZone(martelli), 'amba');
  assert.equal(delivery.deliveryZone({ province: 'Buenos Aires', department: 'General San Martín' }), 'amba');
  assert.equal(delivery.deliveryZone({ province: 'Buenos Aires', department: 'José C. Paz' }), 'amba');
});

test('outside AMBA, missing municipality and same-name municipalities in other provinces are excluded', () => {
  for (const destination of [
    { province: 'Buenos Aires', department: 'Bahía Blanca' },
    { province: 'Buenos Aires' },
    { province: 'Santa Fe', department: 'San Martín' },
    { province: 'Santa Fe', department: 'Rosario' },
  ]) assert.equal(delivery.deliveryZone(destination), null);
});

test('a mixed cart has one fare and uses the large group when it includes a 6- or 7-step ladder', () => {
  const mixed = [item('SAF-2012'), item('SAF-TP-ALAS'), item('SAF-5035')];
  assert.equal(quote(mixed, 17000), 22000);
  assert.equal(quote([...mixed, item('SAF-TP-ALAS')], 17000), 22000);
  assert.equal(quote([...mixed, item('SAF-2006')], 17000), 25000);
  assert.equal(quote([item('SAF-2007', 2), ...mixed], 17000), 25000);
});

test('all eleven WGS84 bands use the agreed fares and precise boundaries', () => {
  const standard = [6000, 12000, 15000, 22000, 25000, 28000, 30000, 32000, 35000, 38000, 40000];
  const large = [7000, 12000, 15000, 25000, 30000, 33000, 35000, 37000, 40000, 40000, 40000];
  for (const [sku, fares] of [['SAF-2005', standard], ['SAF-2006', large], ['SAF-2007', large]]) {
    const lines = [item(sku)];
    assert.equal(quote(lines, 0), fares[0]);
    for (const [index, fare] of fares.entries()) {
      const boundary = (index + 1) * 5000;
      assert.equal(quote(lines, boundary), fare);
      assert.equal(quote(lines, boundary + 0.001), fares[index + 1] ?? null);
    }
  }
  assert.equal(server.shippingForOrder([item('SAF-2007')], { ...atDistance(55000), department: 'San Vicente' }).amount, 40000);
  assert.equal(server.shippingForOrder([item('SAF-2002')], { ...atDistance(5000), department: 'La Plata' }).amount, null);
});

test('the $10,000 neighborhood fare applies to both groups in the second circle only', () => {
  const urquiza = { lat: -34.573197245349604, lon: -58.49436807168912 };
  const devoto = { lat: -34.600331, lon: -58.514904 };
  const caballito = { lat: -34.6166611410831, lon: -58.4447324283245 };
  for (const sku of ['SAF-2001', 'SAF-2007']) {
    const amount = (zone, coordinates) => server.shippingForOrder([item(sku)], { ...zone, coordinates }).amount;
    assert.equal(amount(caba, urquiza), 10000);
    assert.equal(amount(caseros, urquiza), 12000);
    assert.equal(amount(caba, devoto), 12000);
    assert.equal(amount(caba, caballito), 15000);
  }
});

test('missing coordinates, unsupported products and malformed quantities fail closed', () => {
  for (const coordinates of [undefined, { lat: NaN, lon: -58.5 }, { lat: -34.5, lon: Infinity }, { lat: 91, lon: -58.5 }]) {
    assert.equal(server.shippingForOrder([item('SAF-2012')], { ...caba, coordinates }).amount, null);
  }
  for (const invalid of [item('SAF-AGARRADERA'), item('toString'), item('SAF-2002', 0.5), item('SAF-2002', -1)]) {
    assert.equal(quote([item('SAF-2002'), invalid]), null);
  }
});

test('all 28 priced products use their shipping group and have an existing photo', () => {
  const { products } = catalog;
  assert.equal(products.length, 28);
  assert.equal(new Set(products.map((p) => p.id)).size, products.length);
  assert.equal(new Set(products.map((p) => p.slug)).size, products.length);
  for (const product of products) {
    assert.ok(Number.isSafeInteger(product.price) && product.price > 0, product.sku);
    const expected = ['SAF-2006', 'SAF-2007'].includes(product.sku) ? 7000 : 6000;
    assert.equal(quote([item(product.sku)]), expected, product.sku);
    for (const image of product.images) assert.ok(readFileSync(new URL(`../public${image}`, import.meta.url)).length > 0);
  }
});

test('production needs a configured and confirmed dispatch origin', () => {
  const lines = [item('SAF-2002')];
  const destination = atDistance(1000);
  assert.equal(serverFor(undefined).shippingForOrder(lines, destination).amount, null);
  assert.equal(serverFor(JSON.stringify({ point: safari.pilotOrigin })).shippingForOrder(lines, destination).amount, null);
  const configured = serverFor(JSON.stringify({ point: safari.pilotOrigin, confirmation: 'Fixture' }));
  assert.equal(configured.shippingForOrder(lines, destination).amount, 6000);
});

function orderFor(destination) {
  const product = { id: 'SAF-2012', sku: 'SAF-2012', name: 'Escalera de prueba', price: 33261, colors: [], images: ['/test.jpg'], category: 'escaleras', shortDescription: 'Fixture' };
  return load('lib/order.ts', {
    '@/lib/address': {
      prettyLocality: () => destination.locality,
      verifyLocality: async () => ({ ok: true, locality: destination.locality }),
      verifyAddress: async () => ({ ok: true, match: { street: 'Fixture', number: 100, ...destination } }),
      verifyPostalCode: async () => ({ ok: true }),
    },
    '@/lib/buyer': { validateBuyer: (buyer) => ({ ok: true, buyer }) },
    '@/lib/catalog': { getProductById: () => product, maxQuantity: () => 100 },
    '@/lib/format': { formatPrice: String },
    '@/lib/shipping.server': server, '@/lib/shipping': shipping, '@/lib/delivery': delivery,
  });
}
const input = { items: [{ id: 'SAF-2012', quantity: 2 }], buyer: { street: 'Fixture 100', locality: 'CABA', postalCode: '1043' }, channel: 'mercadopago' };

test('checkout recalculates shipping and rejects altered or stale amounts', async () => {
  for (const [destination, amount] of [[atDistance(4000), 6000], [atDistance(8000), 12000]]) {
    const api = orderFor(destination);
    const result = await api.buildOrder({ ...input, shippingAmount: amount });
    assert.equal(result.ok, true);
    assert.equal(result.order.subtotal, 66522);
    assert.equal(result.order.total, 66522 + amount);
    for (const tampered of [0, 1, undefined, amount + 500]) {
      const rejected = await api.buildOrder({ ...input, shippingAmount: tampered });
      assert.equal(rejected.ok, false);
      assert.equal(rejected.status, 409);
    }
  }
});

test('Mercado Pago receives one shipping item and the same total as the saved order', async () => {
  const api = orderFor(atDistance(4000));
  const preferences = [];
  const saved = [];
  const checkout = load('pages/api/checkout.ts', {
    '@/lib/buyer': { formatBuyerAddress: () => 'Domicilio de prueba' },
    '@/lib/images': { productImage: (image) => image },
    '@/lib/mercadopago.server': {
      getMercadoPagoClient: () => ({}),
      preferenceApi: () => ({ create: async ({ body }) => { preferences.push(body); return {}; } }),
    },
    '@/lib/notion.server': { saveOrderToNotion: async (order) => { saved.push(order); } },
    '@/lib/order': api,
    '@/lib/site': { SITE: { url: 'https://example.test' } },
    '@/lib/verified-payment.server': { receiptKey: (id) => id },
  }, { URL, Response, siteUrl: 'https://example.test' });
  const post = (shippingAmount) => checkout.POST({
    request: { json: async () => ({ ...input, shippingAmount }) },
    url: new URL('https://example.test/api/checkout'),
  });
  assert.equal((await post(5000)).status, 409);
  assert.equal(preferences.length, 0);
  assert.equal((await post(6000)).status, 200);
  assert.equal(preferences.length, 1);
  assert.equal(saved.length, 1);
  const items = preferences[0].items;
  const shippingItems = items.filter(({ id }) => id.startsWith('shipping-'));
  assert.equal(shippingItems.length, 1);
  assert.equal(shippingItems[0].unit_price, 6000);
  assert.equal(items.reduce((total, line) => total + line.unit_price * line.quantity, 0), saved[0].total);
});

test('order quantities cannot be rounded or split to bypass the per-line limit', () => {
  const api = orderFor(atDistance(1000));
  for (const quantity of [1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(api.resolveOrderLines([{ id: 'SAF-2012', quantity }]).ok, false);
  }
  const split = (a, b) => [a, b].map((quantity) => ({ id: 'SAF-2012', quantity }));
  assert.equal(api.resolveOrderLines(split(99, 2)).status, 409);
  assert.equal(api.resolveOrderLines(split(2, 3)).lines[0].quantity, 5);
});

test('Georef sublocalities such as Villa Martelli are recognized and address coordinates are retained', async () => {
  const api = load('lib/address.ts', {}, { URLSearchParams, AbortSignal, fetch: async (url) => ({ ok: true, json: async () => {
    if (url.includes('/localidades?')) return { localidades: [{ id: '0686101009', nombre: 'Villa Martelli', provincia: { nombre: 'Buenos Aires' } }] };
    if (url.includes('/localidades-censales?')) return { localidades_censales: [{ id: '46077010', nombre: 'Villa Castelli', provincia: { nombre: 'La Rioja' } }] };
    assert.match(url, /departamento.nombre/);
    assert.match(url, /ubicacion.lat/);
    return { direcciones: [{ nomenclatura: 'Fixture 100, Vicente López, Buenos Aires', calle: { nombre: 'Fixture' }, altura: { valor: 100 }, localidad_censal: { nombre: 'Vicente López' }, provincia: { nombre: 'Buenos Aires' }, departamento: { nombre: 'Vicente López' }, ubicacion: martelli.coordinates }] };
  } }) });
  const locality = await api.verifyLocality('Villa Martelli');
  assert.equal(locality.ok, true);
  assert.equal(locality.province, 'Buenos Aires');
  const address = await api.verifyAddress('Fixture 100', 'Villa Martelli');
  assert.equal(address.ok, true);
  assert.equal(address.match.department, 'Vicente López');
  assert.equal(address.match.coordinates.lat, martelli.coordinates.lat);
  const wrongNumber = await api.verifyAddress('Fixture 101', 'Villa Martelli');
  assert.equal(wrongNumber.ok, false);
});

test('address lookup retries a temporary Georef outage before rejecting a quote', async () => {
  let attempts = 0;
  const api = load('lib/address.ts', {}, { URLSearchParams, AbortSignal, fetch: async () => {
    if (++attempts === 1) return new Response(null, { status: 503 });
    return Response.json({ direcciones: [{
      nomenclatura: 'Fixture 100, Vicente López, Buenos Aires',
      calle: { nombre: 'Fixture' }, altura: { valor: 100 },
      localidad_censal: { nombre: 'Vicente López' }, provincia: { nombre: 'Buenos Aires' },
      departamento: { nombre: 'Vicente López' }, ubicacion: martelli.coordinates,
    }] });
  } });
  const address = await api.verifyAddress('Fixture 100', 'Villa Martelli');
  assert.equal(address.ok, true);
  assert.equal(attempts, 2);
});

test('checkout refuses destinations outside AMBA for both payment and WhatsApp orders', async () => {
  const api = orderFor({ province: 'Santa Fe', department: 'Rosario', locality: 'Rosario' });
  for (const channel of ['mercadopago', 'whatsapp']) {
    const result = await api.buildOrder({ ...input, channel, shippingAmount: 7500 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 422);
  }
});
