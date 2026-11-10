// Total delivery lead times, including preparation, confirmed by the business on 2026-10-17.
export const LADDER_DELIVERY_TIME = 'Entrega de escaleras: 1 día en CABA y 2 días en el resto de AMBA. Coordiná la fecha por WhatsApp.';
export type DeliveryDestination = { province: string; department?: string; coordinates?: { lat: number; lon: number } };

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
