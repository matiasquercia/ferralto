/** Customer tariffs confirmed by the business on 2026-10-09, per whole order.
 * These are sale prices, independent of private carrier cost quotations. */
export const DELIVERY_PRICES = { caba: 15000, nearby: 15000, amba: 35000 } as const;
// Total delivery lead times, including preparation, confirmed by the business on 2026-10-17.
export const LADDER_DELIVERY_TIME = 'Entrega de escaleras: 1 día en CABA y 2 días en el resto de AMBA. Coordiná la fecha por WhatsApp.';
export const NEARBY_RADIUS_KM = 5;
// Georef: OBISPO SAN ALBERTO 3796, Comuna 11, CABA. Verified 2026-10-09.
export const DISPATCH_ORIGIN = { lat: -34.58961592968724, lon: -58.517791248821474 } as const;
export type DeliveryDestination = { province: string; department?: string; coordinates?: { lat: number; lon: number } };
export type DeliveryZone = keyof typeof DELIVERY_PRICES;

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

// AMBA coverage: https://www.argentina.gob.ar/dami/centro/amba
const AMBA_DEPARTMENTS = new Set([
  'Almirante Brown', 'Avellaneda', 'Berazategui', 'Berisso', 'Brandsen',
  'Campana', 'Cañuelas', 'Ensenada', 'Escobar', 'Esteban Echeverría',
  'Exaltación de la Cruz', 'Ezeiza', 'Florencio Varela', 'General Las Heras',
  'General Rodríguez', 'General San Martín', 'Hurlingham', 'Ituzaingó',
  'José C. Paz', 'La Matanza', 'La Plata', 'Lanús', 'Lomas de Zamora',
  'Luján', 'Malvinas Argentinas', 'Marcos Paz', 'Merlo', 'Moreno', 'Morón',
  'Quilmes', 'Pilar', 'Presidente Perón', 'San Fernando', 'San Isidro',
  'San Miguel', 'San Vicente', 'Tigre', 'Tres de Febrero', 'Vicente López', 'Zárate',
].map(normalize));

/** Only call with a destination resolved on the server through Georef. */
export function deliveryZone(destination: DeliveryDestination): 'caba' | 'amba' | null {
  const province = normalize(destination.province);
  if (['caba', 'capital federal', 'ciudad autonoma de buenos aires'].includes(province)) return 'caba';
  if (province === 'buenos aires' && AMBA_DEPARTMENTS.has(normalize(destination.department ?? ''))) return 'amba';
  return null;
}

/** Great-circle distance in km. Never round the distance before choosing a tariff. */
export function distanceFromDispatchKm(coordinates: DeliveryDestination['coordinates']): number | null {
  if (!coordinates || !Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lon) ||
      Math.abs(coordinates.lat) > 90 || Math.abs(coordinates.lon) > 180) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLat = radians(coordinates.lat - DISPATCH_ORIGIN.lat);
  const deltaLon = radians(coordinates.lon - DISPATCH_ORIGIN.lon);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(DISPATCH_ORIGIN.lat)) *
    Math.cos(radians(coordinates.lat)) * Math.sin(deltaLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** CABA always keeps its tariff. Nearby prices require an exact verified address. */
export function deliveryTariff(destination: DeliveryDestination): DeliveryZone | null {
  const zone = deliveryZone(destination);
  if (zone === 'caba') return 'caba';
  if (zone !== 'amba') return null;
  const distance = distanceFromDispatchKm(destination.coordinates);
  if (distance === null) return null;
  return distance <= NEARBY_RADIUS_KM + 1e-9 ? 'nearby' : 'amba';
}
