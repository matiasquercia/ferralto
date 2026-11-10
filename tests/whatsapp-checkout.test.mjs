import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real checkout handler with isolated dependencies; never create a live order.
const source = ts.createSourceFile('CheckoutForm.tsx', readFileSync(new URL('../src/components/CheckoutForm.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function find(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'orderByWhatsApp') handler = node.initializer.getText(source);
  ts.forEachChild(node, find);
}
find(source);
assert.ok(handler, 'WhatsApp checkout handler must exist');

async function run({ valid = true, backupFails = false, repeat = false } = {}) {
  const events = [], navigation = [], requests = [];
  const location = { pathname: '/checkout', set href(value) { navigation.push(value); } };
  const context = {
    submitting: { current: false }, ensureValid: async () => valid, setLoading() {},
    fetch: async (...args) => { requests.push(args); if (backupFails) throw Error('offline backup'); return {}; },
    payload: () => ({ name: 'Private buyer' }), items: [], buyer: {}, shipping: null,
    track: (name, params) => { events.push([name, JSON.parse(JSON.stringify(params))]); },
    buildWhatsAppOrderUrl: () => 'https://wa.me/5491130095909?text=order', window: { location },
  };
  const execute = vm.runInNewContext(`(${handler})`, context);
  await execute();
  if (repeat) await execute();
  return { events, navigation, requests };
}

test('valid WhatsApp checkout measures one opening, not a purchase, and prevents double submit', async () => {
  const result = await run({ repeat: true });
  assert.deepEqual(result.events, [
    ['checkout_submit', { payment_method: 'whatsapp' }],
    ['whatsapp_click', { placement: 'checkout-order', page_path: '/checkout' }],
  ]);
  assert.equal(result.navigation.length, 1);
  assert.equal(result.requests.length, 1);
});

test('invalid checkout emits no opening and does not submit or navigate', async () => {
  const result = await run({ valid: false });
  assert.deepEqual(result, { events: [], navigation: [], requests: [] });
});

test('backup failure still allows the WhatsApp opening and measures it once', async () => {
  const result = await run({ backupFails: true });
  assert.equal(result.navigation.length, 1);
  assert.equal(result.events.filter(([name]) => name === 'whatsapp_click').length, 1);
  assert.ok(!JSON.stringify(result.events).includes('Private buyer'));
});
