import {
  localityFormatError,
  parseAddressQuery,
  postalCodeError,
  splitStreetAndNumber,
  streetFormatError,
  unitFormatError,
} from '@/lib/address';

export interface Buyer {
  name: string;
  email: string;
  phone: string;
  street: string;
  unit: string;
  locality: string;
  postalCode: string;
  notes: string;
}

export type BuyerField = keyof Buyer;

export const BUYER_FIELDS: { id: BuyerField; label: string; required: boolean }[] = [
  { id: 'name', label: 'Nombre y apellido', required: true },
  { id: 'email', label: 'Email', required: true },
  { id: 'phone', label: 'Teléfono', required: true },
  { id: 'street', label: 'Calle y número', required: true },
  { id: 'unit', label: 'Piso / depto', required: false },
  { id: 'locality', label: 'Localidad', required: true },
  { id: 'postalCode', label: 'Código postal', required: true },
  { id: 'notes', label: 'Notas del pedido', required: false },
];

export const emptyBuyer = (): Buyer => ({
  name: '',
  email: '',
  phone: '',
  street: '',
  unit: '',
  locality: '',
  postalCode: '',
  notes: '',
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function phoneDigits(value: string) {
  return value.replace(/\D/g, '');
}

export function formatBuyerAddress(buyer: Pick<Buyer, 'street' | 'unit' | 'locality' | 'postalCode'>) {
  const parts = [buyer.street.trim()];
  if (buyer.unit.trim()) parts.push(buyer.unit.trim());
  if (buyer.locality.trim()) parts.push(buyer.locality.trim());
  if (buyer.postalCode.trim()) parts.push(`CP ${buyer.postalCode.trim()}`);
  return parts.filter(Boolean).join(', ');
}

export function parseBuyer(input: unknown): Buyer {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const text = (key: string) => (typeof raw[key] === 'string' ? raw[key].trim() : '');
  return {
    name: text('name'),
    email: text('email').toLowerCase(),
    phone: text('phone'),
    street: text('street'),
    unit: text('unit'),
    locality: text('locality'),
    postalCode: text('postalCode').toUpperCase().replace(/\s/g, ''),
    notes: text('notes'),
  };
}

export function hydrateBuyer(input: unknown): Buyer {
  const buyer = parseBuyer(input);
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (buyer.street || typeof raw.address !== 'string' || !raw.address.trim()) return buyer;
  const parsed = parseAddressQuery(raw.address);
  const { street, number } = splitStreetAndNumber(parsed.direccion);
  return {
    ...buyer,
    street: number ? `${street} ${number}` : parsed.direccion,
    locality: buyer.locality || parsed.lugar,
  };
}

export function validateBuyerField(field: BuyerField, buyer: Buyer): string | null {
  const value = buyer[field];
  if (field === 'name') {
    if (value.length < 3) return 'Escribí tu nombre y apellido.';
    if (!/\S+\s+\S+/.test(value)) return 'Incluí nombre y apellido.';
    return null;
  }
  if (field === 'email') {
    if (!EMAIL.test(value)) return 'Ingresá un email válido, por ejemplo nombre@correo.com.';
    return null;
  }
  if (field === 'phone') {
    const digits = phoneDigits(value);
    if (digits.length < 10 || digits.length > 13) {
      return 'Ingresá un teléfono con código de área, por ejemplo 11 2345 6789.';
    }
    return null;
  }
  if (field === 'street') return streetFormatError(value);
  if (field === 'unit') return unitFormatError(value);
  if (field === 'locality') return localityFormatError(value);
  if (field === 'postalCode') return postalCodeError(value);
  if (field === 'notes' && value.length > 500) return 'Las notas no pueden superar los 500 caracteres.';
  return null;
}

export function validateBuyer(input: unknown) {
  const buyer = parseBuyer(input);
  const errors: Partial<Record<BuyerField, string>> = {};
  for (const { id } of BUYER_FIELDS) {
    const message = validateBuyerField(id, buyer);
    if (message) errors[id] = message;
  }
  const first = BUYER_FIELDS.find(({ id }) => errors[id]);
  return {
    buyer,
    errors,
    ok: !first,
    message: first ? 'Revisá los datos del formulario para continuar.' : null,
  };
}
