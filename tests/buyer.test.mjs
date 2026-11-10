import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(fileUrl) {
  const source = ts.transpileModule(readFileSync(fileUrl, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = {
    exports: {},
    module: { exports: {} },
    console,
    fetch,
    URLSearchParams,
    require(spec) {
      if (spec === '@/lib/address') return load(new URL('../src/lib/address.ts', import.meta.url));
      throw new Error(`Unexpected import: ${spec}`);
    },
  };
  context.module.exports = context.exports;
  vm.runInNewContext(source, context);
  return context.exports;
}

const api = load(new URL('../src/lib/buyer.ts', import.meta.url));
const address = load(new URL('../src/lib/address.ts', import.meta.url));

const valid = {
  name: 'Matías Quercia',
  email: 'ventas@ferrato.com.ar',
  phone: '11 2345 6789',
  street: 'Av. Corrientes 1234',
  unit: '4° B',
  locality: 'CABA',
  postalCode: '1043',
  notes: '',
};

test('acepta un comprador completo', () => {
  const result = api.validateBuyer(valid);
  assert.equal(result.ok, true);
  assert.equal(result.buyer.email, 'ventas@ferrato.com.ar');
  assert.equal(result.buyer.postalCode, '1043');
});

test('pide nombre y apellido', () => {
  const result = api.validateBuyer({ ...valid, name: 'Matías' });
  assert.equal(result.ok, false);
  assert.match(result.errors.name, /apellido/i);
});

test('rechaza un email inválido', () => {
  const result = api.validateBuyer({ ...valid, email: 'hola@' });
  assert.equal(result.ok, false);
  assert.match(result.errors.email, /email válido/i);
});

test('exige teléfono con código de área', () => {
  const result = api.validateBuyer({ ...valid, phone: '1234' });
  assert.equal(result.ok, false);
  assert.match(result.errors.phone, /código de área/i);
});

test('acepta teléfono internacional argentino', () => {
  const result = api.validateBuyer({ ...valid, phone: '+54 9 11 2345-6789' });
  assert.equal(result.ok, true);
});

test('exige calle y número', () => {
  const result = api.validateBuyer({ ...valid, street: 'CABA' });
  assert.equal(result.ok, false);
  assert.match(result.errors.street, /número|calle/i);
});

test('exige el número de la calle', () => {
  const result = api.validateBuyer({ ...valid, street: 'Avenida Corrientes' });
  assert.equal(result.ok, false);
  assert.match(result.errors.street, /número/i);
});

test('permite omitir piso o depto', () => {
  const result = api.validateBuyer({ ...valid, unit: '' });
  assert.equal(result.ok, true);
});

test('exige localidad', () => {
  const result = api.validateBuyer({ ...valid, locality: '' });
  assert.equal(result.ok, false);
  assert.match(result.errors.locality, /localidad/i);
});

test('exige un código postal argentino', () => {
  const result = api.validateBuyer({ ...valid, postalCode: '12' });
  assert.equal(result.ok, false);
  assert.match(result.errors.postalCode, /código postal/i);
});

test('acepta CPA', () => {
  const result = api.validateBuyer({ ...valid, postalCode: 'c1043aae' });
  assert.equal(result.ok, true);
  assert.equal(result.buyer.postalCode, 'C1043AAE');
});

test('arma la dirección completa', () => {
  assert.equal(api.formatBuyerAddress(valid), 'Av. Corrientes 1234, 4° B, CABA, CP 1043');
});

test('migra un borrador con un solo campo de dirección', () => {
  const buyer = api.hydrateBuyer({
    name: 'Matías Quercia',
    address: 'Av. Corrientes 1234, CABA',
  });
  assert.equal(buyer.street, 'Av. Corrientes 1234');
  assert.equal(buyer.locality, 'CABA');
});

test('separa calle y localidad', () => {
  const parsed = address.parseAddressQuery('Av. Corrientes 1234, CABA');
  assert.equal(parsed.direccion, 'Av. Corrientes 1234');
  assert.equal(parsed.lugar, 'CABA');
});

test('resuelve una coincidencia única', () => {
  const match = {
    label: 'AV CORRIENTES 1234, Comuna 1, Ciudad Autónoma de Buenos Aires',
    street: 'AV CORRIENTES',
    number: 1234,
    locality: 'Ciudad Autónoma de Buenos Aires',
    province: 'Ciudad Autónoma de Buenos Aires',
  };
  const resolved = address.resolveAddress('Av. Corrientes 1234, CABA', [match]);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.match.label, match.label);
});

test('pide elegir cuando hay varias coincidencias', () => {
  const matches = [
    { label: 'AV CORRIENTES 1234, Rosario, Santa Fe', street: 'AV CORRIENTES', number: 1234, locality: 'Rosario', province: 'Santa Fe' },
    { label: 'AV CORRIENTES 1234, Comuna 1, Ciudad Autónoma de Buenos Aires', street: 'AV CORRIENTES', number: 1234, locality: 'CABA', province: 'CABA' },
  ];
  const resolved = address.resolveAddress('Av. Corrientes 1234', matches);
  assert.equal(resolved.ok, false);
  assert.match(resolved.error, /varias coincidencias/i);
});

test('separa el número al final de la calle', () => {
  const parsed = address.splitStreetAndNumber('Av. Corrientes 1234');
  assert.equal(parsed.street, 'Av. Corrientes');
  assert.equal(parsed.number, '1234');
});

test('resume CABA como localidad', () => {
  assert.equal(address.prettyLocality('Ciudad Autónoma de Buenos Aires'), 'CABA');
  assert.equal(address.prettyLocality('Comuna 5', 'Ciudad Autónoma de Buenos Aires'), 'CABA');
  assert.equal(address.prettyLocality('Rosario', 'Santa Fe'), 'Rosario');
});

test('sugiere CABA al escribir el alias', () => {
  const aliases = address.aliasLocalities('caba');
  assert.equal(aliases[0].locality, 'CABA');
});

test('al elegir una calle deja lugar para el número', () => {
  const next = address.applySuggestion({ street: '', locality: '' }, {
    kind: 'street',
    id: 'street:av-corrientes:caba',
    title: 'AV CORRIENTES',
    subtitle: 'CABA',
    value: 'AV CORRIENTES ',
    street: 'AV CORRIENTES',
    locality: 'CABA',
  });
  assert.equal(next.street, 'AV CORRIENTES ');
  assert.equal(next.locality, 'CABA');
});

test('al elegir una calle con número completa la localidad', () => {
  const next = address.applySuggestion({ street: 'corrientes 1234', locality: '' }, {
    kind: 'street',
    id: 'street:av-corrientes:caba',
    title: 'AV CORRIENTES',
    subtitle: 'CABA',
    value: 'AV CORRIENTES ',
    street: 'AV CORRIENTES',
    locality: 'CABA',
  });
  assert.equal(next.street, 'AV CORRIENTES 1234');
  assert.equal(next.locality, 'CABA');
});

test('al elegir una localidad no pisa la calle', () => {
  const next = address.applySuggestion({ street: 'AV CORRIENTES 1234', locality: 'pal' }, {
    kind: 'locality',
    id: 'locality:rosario',
    title: 'Rosario',
    subtitle: 'Santa Fe',
    value: 'Rosario',
    locality: 'Rosario',
  });
  assert.equal(next.street, 'AV CORRIENTES 1234');
  assert.equal(next.locality, 'Rosario');
});

test('rechaza una localidad inventada en la resolución', () => {
  const resolved = address.resolveLocality('fdsdfg', []);
  assert.equal(resolved.ok, false);
  assert.match(resolved.error, /localidad/i);
});

test('acepta CABA como localidad real', () => {
  const resolved = address.resolveLocality('caba', address.aliasLocalities('caba'));
  assert.equal(resolved.ok, true);
  assert.equal(resolved.locality, 'CABA');
});

test('elige Rosario cuando el nombre coincide exacto', () => {
  const resolved = address.resolveLocality('Rosario', [
    { kind: 'locality', id: '1', title: 'Monte del Rosario', subtitle: 'Córdoba', value: 'Monte del Rosario', locality: 'Monte del Rosario', province: 'Córdoba' },
    { kind: 'locality', id: '2', title: 'Rosario', subtitle: 'Santa Fe', value: 'Rosario', locality: 'Rosario', province: 'Santa Fe' },
  ]);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.locality, 'Rosario');
});

test('pide elegir si hay dos localidades con el mismo nombre', () => {
  const resolved = address.resolveLocality('La Lucila', [
    { kind: 'locality', id: '1', title: 'La Lucila', subtitle: 'Buenos Aires', value: 'La Lucila', locality: 'La Lucila', province: 'Buenos Aires' },
    { kind: 'locality', id: '2', title: 'La Lucila', subtitle: 'Santa Fe', value: 'La Lucila', locality: 'La Lucila', province: 'Santa Fe' },
  ]);
  assert.equal(resolved.ok, false);
  assert.match(resolved.error, /varias localidades/i);
});

test('extrae el CPA numérico', () => {
  assert.equal(address.postalCodeDigits('C1043AAE'), '1043');
  assert.equal(address.postalCodeDigits('1043'), '1043');
  assert.equal(address.postalCodeDigits('12'), null);
});

test('el prefijo CPA de CABA no vale para Rosario', () => {
  assert.equal(address.postalPrefixMatches('C1043AAE', 'CABA'), true);
  assert.equal(address.postalPrefixMatches('C1043AAE', 'Rosario', 'Santa Fe'), false);
  assert.equal(address.postalPrefixMatches('1043', 'Rosario', 'Santa Fe'), true);
});

test('el código postal tiene que coincidir con la localidad', () => {
  const cabaPlace = { name: 'Buenos Aires', state: 'Ciudad Autónoma de Buenos Aires', details: 'Comuna 1' };
  const rosarioPlace = { name: 'ROSARIO', state: 'SANTA FE', details: 'ROSARIO SANTA FE' };
  assert.equal(address.localityMatchesPostalPlace('CABA', '', cabaPlace), true);
  assert.equal(address.localityMatchesPostalPlace('CABA', '', rosarioPlace), false);
  assert.equal(address.localityMatchesPostalPlace('Rosario', 'Santa Fe', rosarioPlace), true);
});

test('prioriza CABA y evita duplicar la misma calle', () => {
  const ranked = address.rankAndDedupeStreets([
    { nombre: 'CORRIENTES', localidad_censal: { nombre: 'Ayacucho' }, provincia: { nombre: 'Buenos Aires' } },
    { nombre: 'AV CORRIENTES', categoria: 'AV', localidad_censal: { nombre: 'Ciudad Autónoma de Buenos Aires' }, provincia: { nombre: 'Ciudad Autónoma de Buenos Aires' } },
    { nombre: 'AV CORRIENTES', categoria: 'AV', localidad_censal: { nombre: 'Ciudad Autónoma de Buenos Aires' }, provincia: { nombre: 'Ciudad Autónoma de Buenos Aires' } },
  ]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].nombre, 'AV CORRIENTES');
});
