export interface AddressMatch {
  label: string;
  street: string;
  number: number;
  locality: string;
  province: string;
  department?: string;
  coordinates?: { lat: number; lon: number };
}

export type AddressSuggestionKind = 'street' | 'locality' | 'address';

export interface AddressSuggestion {
  kind: AddressSuggestionKind;
  id: string;
  title: string;
  subtitle: string;
  value: string;
  street?: string;
  number?: number;
  locality?: string;
  province?: string;
}

const GEOREF_BASE = 'https://apis.datos.gob.ar/georef/api';
const GEOREF_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Ferralto (https://www.ferralto.com)',
};
const lookupTimeoutMs = 6500;

type StreetRow = {
  id?: string;
  nombre?: string;
  categoria?: string;
  nomenclatura?: string;
  localidad_censal?: { nombre?: string };
  provincia?: { nombre?: string };
};

type LocalityRow = {
  id?: string;
  nombre?: string;
  provincia?: { nombre?: string };
};

export function streetFormatError(value: string): string | null {
  const v = value.trim();
  if (v.length < 5) return 'Indicá la calle y el número, por ejemplo Av. Corrientes 1234.';
  if (!/[a-záéíóúüñ]/i.test(v)) return 'Escribí el nombre de la calle.';
  if (!/\d/.test(v)) return 'Falta el número de la calle.';
  return null;
}

export function localityFormatError(value: string): string | null {
  const v = value.trim();
  if (v.length < 2) return 'Indicá la localidad.';
  if (!/[a-záéíóúüñ]/i.test(v)) return 'Escribí el nombre de la localidad.';
  return null;
}

export function postalCodeError(value: string): string | null {
  const v = value.trim().toUpperCase().replace(/\s/g, '');
  if (!v) return 'Indicá el código postal.';
  if (!/^[A-Z]?\d{4}([A-Z]{3})?$/.test(v)) {
    return 'Usá el código postal argentino, por ejemplo 1043 o C1043AAE.';
  }
  return null;
}

export function postalCodeDigits(value: string) {
  const v = value.trim().toUpperCase().replace(/\s/g, '');
  const match = v.match(/^[A-Z]?(\d{4})([A-Z]{3})?$/);
  return match?.[1] ?? null;
}

export function postalCodePrefix(value: string) {
  const v = value.trim().toUpperCase().replace(/\s/g, '');
  const match = v.match(/^([A-Z])\d{4}[A-Z]{3}$/);
  return match?.[1] ?? null;
}

const CPA_PROVINCE: Record<string, string[]> = {
  A: ['salta'],
  B: ['buenos aires'],
  C: ['ciudad autonoma de buenos aires', 'caba'],
  D: ['san luis'],
  E: ['entre rios'],
  F: ['la rioja'],
  G: ['santiago del estero'],
  H: ['chaco'],
  J: ['san juan'],
  K: ['catamarca'],
  L: ['la pampa'],
  M: ['mendoza'],
  N: ['misiones'],
  P: ['formosa'],
  Q: ['neuquen'],
  R: ['rio negro'],
  S: ['santa fe'],
  T: ['tucuman'],
  U: ['chubut'],
  V: ['tierra del fuego'],
  W: ['corrientes'],
  X: ['cordoba'],
  Y: ['jujuy'],
  Z: ['santa cruz'],
};

export interface PostalPlace {
  name: string;
  state: string;
  details: string;
}

export function unitFormatError(value: string): string | null {
  if (value.trim().length > 40) return 'El piso o depto no puede superar los 40 caracteres.';
  return null;
}

export function composeAddressQuery(street: string, locality = '') {
  const direccion = street.trim().replace(/\s+/g, ' ');
  const lugar = locality.trim().replace(/\s+/g, ' ');
  return lugar ? `${direccion}, ${lugar}` : direccion;
}

export function parseAddressQuery(value: string) {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const comma = trimmed.lastIndexOf(',');
  if (comma === -1) return { direccion: trimmed, lugar: '' };
  return {
    direccion: trimmed.slice(0, comma).trim(),
    lugar: trimmed.slice(comma + 1).trim(),
  };
}

export function splitStreetAndNumber(direccion: string) {
  const trimmed = direccion.trim().replace(/\s+/g, ' ');
  const match = trimmed.match(/^(.*?)(?:\s+(\d{1,6}))$/);
  if (!match) return { street: trimmed, number: '' };
  const street = match[1].trim();
  const letters = street.replace(/[^a-záéíóúüñ]/gi, '').length;
  if (letters < 3) return { street: trimmed, number: '' };
  return { street, number: match[2] };
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function labelsMatch(a: string, b: string) {
  return normalize(a) === normalize(b);
}

export function prettyLocality(locality: string, province = '') {
  const loc = locality.trim();
  const haystack = normalize(`${loc} ${province}`);
  if (
    /ciudad autonoma de buenos aires/.test(haystack) ||
    /capital federal/.test(haystack) ||
    /^comuna \d+/.test(haystack)
  ) {
    return 'CABA';
  }
  return loc;
}

export function isCabaAlias(query: string) {
  const q = normalize(query);
  return (
    q === 'caba' ||
    q === 'c a b a' ||
    q === 'cap fed' ||
    q === 'capital federal' ||
    q.startsWith('ciudad autonoma')
  );
}

export function resolveLocality(query: string, suggestions: AddressSuggestion[]) {
  const formatError = localityFormatError(query);
  if (formatError) return { ok: false as const, error: formatError, suggestions };

  if (isCabaAlias(query) || labelsMatch(prettyLocality(query), 'CABA')) {
    return {
      ok: true as const,
      locality: 'CABA',
      province: 'Ciudad Autónoma de Buenos Aires',
      suggestions,
    };
  }

  const exact = suggestions.filter(
    (row) => labelsMatch(row.locality ?? '', query) || labelsMatch(row.title, query),
  );
  if (exact.length === 1) {
    return {
      ok: true as const,
      locality: exact[0].locality ?? exact[0].title,
      province: exact[0].province ?? '',
      suggestions,
    };
  }
  if (exact.length > 1) {
    return {
      ok: false as const,
      error: 'Hay varias localidades con ese nombre. Elegí una de la lista.',
      suggestions: exact,
    };
  }
  if (suggestions.length === 0) {
    return {
      ok: false as const,
      error: 'No encontramos esa localidad. Elegí una de la lista.',
      suggestions,
    };
  }
  return {
    ok: false as const,
    error: 'Hay varias localidades. Elegí una de la lista.',
    suggestions,
  };
}

export function localityMatchesPostalPlace(
  locality: string,
  province: string,
  place: PostalPlace,
) {
  const loc = prettyLocality(locality, province);
  const locNorm = normalize(loc);
  const haystack = normalize([place.name, place.state, place.details, province].filter(Boolean).join(' '));
  if (!locNorm) return false;
  if (labelsMatch(loc, prettyLocality(place.name, place.state))) return true;
  if (locNorm === 'caba') {
    return /ciudad autonoma|capital federal|comuna \d+/.test(haystack);
  }
  if (locNorm.length >= 4 && haystack.includes(locNorm)) return true;
  const provinceNorm = normalize(prettyLocality(province) === 'CABA' ? 'ciudad autonoma de buenos aires' : province);
  return locNorm.length >= 6 && Boolean(provinceNorm) && haystack.includes(provinceNorm) && haystack.includes(locNorm);
}

export function postalPrefixMatches(code: string, locality: string, province = '') {
  const prefix = postalCodePrefix(code);
  if (!prefix) return true;
  const allowed = CPA_PROVINCE[prefix];
  if (!allowed) return true;
  const haystack = normalize(`${prettyLocality(locality, province)} ${province}`);
  return allowed.some((name) => haystack.includes(name) || name.includes(haystack));
}

export function aliasLocalities(query: string): AddressSuggestion[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const caba = normalize('Ciudad Autónoma de Buenos Aires');
  const aliases = ['caba', 'c a b a', 'capital federal', 'cap fed'];
  const hitsCaba =
    aliases.some((alias) => alias.startsWith(q) || (q.length >= 3 && q.startsWith(alias))) ||
    (q.length >= 4 && (caba.startsWith(q) || q.startsWith('ciudad autonoma')));
  if (!hitsCaba) return [];
  return [
    {
      kind: 'locality',
      id: 'locality:caba',
      title: 'CABA',
      subtitle: 'Ciudad Autónoma de Buenos Aires',
      value: 'CABA',
      locality: 'CABA',
      province: 'Ciudad Autónoma de Buenos Aires',
    },
  ];
}

export function applySuggestion(
  current: { street: string; locality: string },
  suggestion: AddressSuggestion,
): { street: string; locality: string } {
  if (suggestion.kind === 'address') {
    return {
      street: `${suggestion.street} ${suggestion.number}`,
      locality: suggestion.locality ?? current.locality,
    };
  }
  if (suggestion.kind === 'street') {
    const { number } = splitStreetAndNumber(current.street);
    const name = suggestion.street ?? suggestion.title;
    return {
      street: number ? `${name} ${number}` : `${name} `,
      locality: current.locality || suggestion.locality || '',
    };
  }
  return {
    street: current.street,
    locality: suggestion.locality ?? suggestion.title,
  };
}

function cityScore(locality: string, province: string) {
  const haystack = normalize(`${locality} ${province}`);
  if (haystack.includes('ciudad autonoma de buenos aires') || haystack === 'caba' || haystack.startsWith('caba ')) {
    return 100;
  }
  if (haystack.includes('rosario')) return 72;
  if (haystack.includes('cordoba')) return 70;
  if (haystack.includes('mendoza')) return 60;
  if (haystack.includes('la plata')) return 55;
  if (haystack.includes('mar del plata')) return 50;
  return 0;
}

export function rankAndDedupeStreets(rows: StreetRow[]): StreetRow[] {
  const seen = new Set<string>();
  const unique: StreetRow[] = [];
  for (const row of rows) {
    const street = row.nombre?.trim() ?? '';
    const locality = prettyLocality(row.localidad_censal?.nombre ?? '', row.provincia?.nombre ?? '');
    if (!street || !locality) continue;
    const key = `${normalize(street)}|${normalize(locality)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique.sort((a, b) => {
    const aLoc = prettyLocality(a.localidad_censal?.nombre ?? '', a.provincia?.nombre ?? '');
    const bLoc = prettyLocality(b.localidad_censal?.nombre ?? '', b.provincia?.nombre ?? '');
    const aScore =
      cityScore(aLoc, a.provincia?.nombre ?? '') + (/^av\b/i.test(a.nombre ?? '') || a.categoria === 'AV' ? 8 : 0);
    const bScore =
      cityScore(bLoc, b.provincia?.nombre ?? '') + (/^av\b/i.test(b.nombre ?? '') || b.categoria === 'AV' ? 8 : 0);
    return bScore - aScore;
  });
}

function uniqueSuggestions(rows: AddressSuggestion[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function kindLabel(kind: AddressSuggestionKind) {
  if (kind === 'street') return 'Calle';
  if (kind === 'locality') return 'Localidad';
  return 'Dirección';
}

export function suggestionKindLabel(kind: AddressSuggestionKind) {
  return kindLabel(kind);
}

function streetToSuggestion(row: StreetRow): AddressSuggestion | null {
  const street = row.nombre?.trim() ?? '';
  const province = row.provincia?.nombre?.trim() ?? '';
  const locality = prettyLocality(row.localidad_censal?.nombre ?? '', province);
  if (!street || !locality) return null;
  return {
    kind: 'street',
    id: `street:${normalize(street)}:${normalize(locality)}`,
    title: street,
    subtitle: province && locality !== 'CABA' && locality !== province ? `${locality}, ${province}` : locality,
    value: `${street} `,
    street,
    locality,
    province,
  };
}

function localityToSuggestion(row: LocalityRow): AddressSuggestion | null {
  const name = row.nombre?.trim() ?? '';
  const province = row.provincia?.nombre?.trim() ?? '';
  if (!name) return null;
  const locality = prettyLocality(name, province);
  return {
    kind: 'locality',
    id: `locality:${row.id ?? normalize(locality)}`,
    title: locality,
    subtitle: province && locality !== province ? province : '',
    value: locality,
    locality,
    province,
  };
}

export function matchToSuggestion(match: AddressMatch): AddressSuggestion {
  const locality = prettyLocality(match.locality, match.province);
  return {
    kind: 'address',
    id: `address:${match.label}`,
    title: `${match.street} ${match.number}`,
    subtitle: locality === match.province ? locality : `${locality}, ${match.province}`,
    value: match.label,
    street: match.street,
    number: match.number,
    locality,
    province: match.province,
  };
}

async function georefGet<T>(path: string, params: URLSearchParams): Promise<T> {
  const url = `${GEOREF_BASE}/${path}?${params}`;
  const request = () => fetch(url, { headers: GEOREF_HEADERS, signal: AbortSignal.timeout(lookupTimeoutMs) });
  const firstResponse = await request().catch(() => undefined);
  const response = firstResponse && ![502, 503, 504].includes(firstResponse.status)
    ? firstResponse
    : await request();
  if (!response.ok) throw new Error(`Georef ${response.status}`);
  return response.json() as Promise<T>;
}

function toMatch(row: {
  nomenclatura?: string;
  calle?: { nombre?: string };
  altura?: { valor?: number | null };
  localidad_censal?: { nombre?: string };
  provincia?: { nombre?: string };
  departamento?: { nombre?: string };
  ubicacion?: { lat?: number; lon?: number };
}): AddressMatch | null {
  const number = row.altura?.valor;
  const street = row.calle?.nombre?.trim();
  const locality = row.localidad_censal?.nombre?.trim();
  const province = row.provincia?.nombre?.trim();
  const label = row.nomenclatura?.trim();
  if (!label || !street || !locality || !province || number == null) return null;
  const lat = row.ubicacion?.lat, lon = row.ubicacion?.lon;
  const coordinates = typeof lat === 'number' && Number.isFinite(lat) && typeof lon === 'number' && Number.isFinite(lon) ? { lat, lon } : undefined;
  return { label, street, number, locality, province, department: row.departamento?.nombre?.trim(), coordinates };
}

export async function lookupAddress(query: string): Promise<AddressMatch[]> {
  const { direccion, lugar } = parseAddressQuery(query);
  const params = new URLSearchParams({
    direccion,
    max: '6',
    campos: 'nomenclatura,calle.nombre,altura.valor,localidad_censal.nombre,provincia.nombre,departamento.nombre,ubicacion.lat,ubicacion.lon',
  });
  if (lugar) params.set('localidad', lugar);

  const data = await georefGet<{ direcciones?: Parameters<typeof toMatch>[0][] }>('direcciones', params);
  const matches = (data.direcciones ?? []).map(toMatch).filter((row): row is AddressMatch => row !== null);
  const seen = new Set<string>();
  return matches.filter((row) => {
    if (seen.has(row.label)) return false;
    seen.add(row.label);
    return true;
  });
}

async function searchStreets(nombre: string, provincia?: string): Promise<AddressSuggestion[]> {
  if (nombre.trim().length < 3) return [];
  const params = new URLSearchParams({
    nombre,
    max: provincia ? '8' : '15',
    campos: 'id,nombre,categoria,nomenclatura,localidad_censal.nombre,provincia.nombre',
  });
  if (provincia) params.set('provincia', provincia);
  const data = await georefGet<{ calles?: StreetRow[] }>('calles', params);
  return rankAndDedupeStreets(data.calles ?? [])
    .map(streetToSuggestion)
    .filter((row): row is AddressSuggestion => row !== null);
}

async function searchLocalities(nombre: string): Promise<AddressSuggestion[]> {
  if (nombre.trim().length < 2) return [];
  const params = new URLSearchParams({
    nombre,
    max: '8',
    campos: 'id,nombre,provincia.nombre',
  });
  // Neighborhoods such as Villa Martelli are localidades within a census locality.
  const results = await Promise.allSettled([
    georefGet<{ localidades?: LocalityRow[] }>('localidades', params).then((data) => data.localidades ?? []),
    georefGet<{ localidades_censales?: LocalityRow[] }>('localidades-censales', params).then((data) => data.localidades_censales ?? []),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  if (!fulfilled.length) throw new Error('Georef locality lookup failed');
  const seen = new Set<string>();
  return fulfilled.flatMap((result) => result.value)
    .filter((row) => {
      const key = normalize(`${row.nombre} ${row.provincia?.nombre}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(localityToSuggestion)
    .filter((row): row is AddressSuggestion => row !== null);
}

export async function suggestStreets(street: string, locality = ''): Promise<AddressSuggestion[]> {
  const trimmed = street.trim();
  if (trimmed.length < 3) return [];
  const { street: name, number } = splitStreetAndNumber(trimmed);
  if (number) {
    return (await lookupAddress(composeAddressQuery(trimmed, locality))).map(matchToSuggestion);
  }
  const [cabaStreets, streets] = await Promise.all([searchStreets(name, 'caba'), searchStreets(name)]);
  return uniqueSuggestions([...cabaStreets, ...streets]).slice(0, 8);
}

export async function suggestLocalities(query: string): Promise<AddressSuggestion[]> {
  if (query.trim().length < 2) return [];
  const rows = await searchLocalities(query);
  return uniqueSuggestions([...aliasLocalities(query), ...rows]).slice(0, 8);
}

export function resolveAddress(query: string, matches: AddressMatch[]) {
  const exact = matches.find((row) => labelsMatch(query, row.label));
  if (exact) return { ok: true as const, match: exact, matches };
  if (matches.length === 1) return { ok: true as const, match: matches[0], matches };
  if (matches.length === 0) {
    return {
      ok: false as const,
      matches,
      error: 'No encontramos esa calle y número. Revisá los datos o elegí una sugerencia.',
    };
  }
  return {
    ok: false as const,
    matches,
    error: 'Hay varias coincidencias. Elegí tu localidad de la lista.',
  };
}

export async function verifyAddress(street: string, locality: string) {
  const streetError = streetFormatError(street);
  if (streetError) return { ok: false as const, error: streetError, matches: [] as AddressMatch[] };
  const localityError = localityFormatError(locality);
  if (localityError) return { ok: false as const, error: localityError, matches: [] as AddressMatch[] };
  try {
    const query = composeAddressQuery(street, locality);
    const { number } = splitStreetAndNumber(street);
    if (!number) return { ok: false as const, error: 'Indicá el número de la calle.', matches: [] as AddressMatch[] };
    const matches = (await lookupAddress(query)).filter((match) => match.number === Number(number));
    const resolved = resolveAddress(query, matches);
    if (!resolved.ok) return resolved;
    return { ok: true as const, match: resolved.match, matches };
  } catch (err) {
    console.error('[address] No se pudo verificar la dirección', err);
    return {
      ok: false as const,
      matches: [] as AddressMatch[],
      error: 'No pudimos verificar la dirección en este momento. Probá de nuevo en unos segundos.',
    };
  }
}

export async function verifyLocality(query: string) {
  const formatError = localityFormatError(query);
  if (formatError) return { ok: false as const, error: formatError, suggestions: [] as AddressSuggestion[] };
  if (isCabaAlias(query) || labelsMatch(prettyLocality(query), 'CABA')) {
    return {
      ok: true as const,
      locality: 'CABA',
      province: 'Ciudad Autónoma de Buenos Aires',
      suggestions: aliasLocalities('caba'),
    };
  }
  try {
    const suggestions = await suggestLocalities(query);
    return resolveLocality(query, suggestions);
  } catch (err) {
    console.error('[address] No se pudo verificar la localidad', err);
    return {
      ok: false as const,
      suggestions: [] as AddressSuggestion[],
      error: 'No pudimos verificar la localidad en este momento. Probá de nuevo en unos segundos.',
    };
  }
}

type NominatimRow = {
  display_name?: string;
  address?: {
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    state_district?: string;
  };
};

type ZippopotamPlace = {
  'place name'?: string;
  state?: string;
};

const postalCache = new Map<string, PostalPlace[]>();

async function lookupNominatimPostal(digits: string): Promise<PostalPlace[]> {
  const params = new URLSearchParams({
    postalcode: digits,
    country: 'Argentina',
    format: 'json',
    addressdetails: '1',
    limit: '8',
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: GEOREF_HEADERS,
    signal: AbortSignal.timeout(lookupTimeoutMs),
  });
  if (!response.ok) throw new Error(`Nominatim ${response.status}`);
  const rows = (await response.json()) as NominatimRow[];
  return rows.map((row) => {
    const address = row.address ?? {};
    const name = address.suburb || address.city || address.town || address.village || address.state || digits;
    return {
      name,
      state: address.state ?? '',
      details: [address.state_district, address.city, row.display_name].filter(Boolean).join(' '),
    };
  });
}

async function lookupZippopotamPostal(digits: string): Promise<PostalPlace[]> {
  const response = await fetch(`https://api.zippopotam.us/AR/${digits}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(lookupTimeoutMs),
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Zippopotam ${response.status}`);
  const data = (await response.json()) as { places?: ZippopotamPlace[] };
  return (data.places ?? []).map((place) => ({
    name: place['place name'] ?? digits,
    state: place.state ?? '',
    details: `${place['place name'] ?? ''} ${place.state ?? ''}`,
  }));
}

export async function lookupPostalPlaces(digits: string): Promise<PostalPlace[]> {
  const cached = postalCache.get(digits);
  if (cached) return cached;
  const settled = await Promise.allSettled([lookupNominatimPostal(digits), lookupZippopotamPostal(digits)]);
  const places: PostalPlace[] = [];
  let failed = 0;
  for (const result of settled) {
    if (result.status === 'fulfilled') places.push(...result.value);
    else failed += 1;
  }
  if (failed === settled.length) throw new Error('postal lookup failed');
  const unique: PostalPlace[] = [];
  const seen = new Set<string>();
  for (const place of places) {
    const key = `${normalize(place.name)}|${normalize(place.state)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(place);
  }
  if (unique.length > 0 || failed === 0) postalCache.set(digits, unique);
  if (postalCache.size > 200) postalCache.clear();
  return unique;
}

export async function verifyPostalCode(code: string, locality = '', province = '') {
  const formatError = postalCodeError(code);
  if (formatError) return { ok: false as const, error: formatError, places: [] as PostalPlace[] };
  const digits = postalCodeDigits(code);
  if (!digits) return { ok: false as const, error: postalCodeError(code) ?? 'Indicá el código postal.', places: [] as PostalPlace[] };

  if (locality && !postalPrefixMatches(code, locality, province)) {
    return {
      ok: false as const,
      error: `Ese código postal no corresponde a ${prettyLocality(locality, province)}.`,
      places: [] as PostalPlace[],
    };
  }

  try {
    const places = await lookupPostalPlaces(digits);
    if (places.length === 0) {
      const n = Number(digits);
      if (prettyLocality(locality, province) === 'CABA' && n >= 1000 && n <= 1499) {
        return {
          ok: true as const,
          postalCode: digits,
          places: [{ name: 'CABA', state: 'Ciudad Autónoma de Buenos Aires', details: 'CABA' }],
        };
      }
      return {
        ok: false as const,
        error: 'No encontramos ese código postal. Revisá los números o usá el CPA.',
        places,
      };
    }
    if (!locality.trim()) return { ok: true as const, postalCode: digits, places };
    const matches = places.filter((place) => localityMatchesPostalPlace(locality, province, place));
    if (matches.length === 0) {
      return {
        ok: false as const,
        error: `Ese código postal no corresponde a ${prettyLocality(locality, province)}.`,
        places,
      };
    }
    return { ok: true as const, postalCode: digits, places: matches };
  } catch (err) {
    console.error('[address] No se pudo verificar el código postal', err);
    return {
      ok: false as const,
      places: [] as PostalPlace[],
      error: 'No pudimos verificar el código postal en este momento. Probá de nuevo en unos segundos.',
    };
  }
}
