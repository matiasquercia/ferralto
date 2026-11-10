import boundary from '@/data/shipping/caba-boundary.json';
import neighborhoods from '@/data/shipping/caba-neighborhoods.json';

type Point = { lat: number; lon: number };
type Ring = number[][];
type Polygon = Ring[];
type Geometry = { type: string; coordinates: unknown };
const epsilon = 1e-10;

// GeoJSON uses longitude, latitude. Preserve boundaries and interior holes.
function ringLocation({ lon, lat }: Point, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const length = Math.hypot(bx - ax, by - ay);
    if (length > 0 && Math.abs((lon - ax) * (by - ay) - (lat - ay) * (bx - ax)) <= epsilon * length &&
        lon >= Math.min(ax, bx) - epsilon && lon <= Math.max(ax, bx) + epsilon &&
        lat >= Math.min(ay, by) - epsilon && lat <= Math.max(ay, by) + epsilon) return 'boundary';
    if ((ay > lat) !== (by > lat) && lon < (bx - ax) * (lat - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

function contains(point: Point, geometry: Geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates as Polygon] : geometry.coordinates as Polygon[];
  return polygons.some(([outer, ...holes]) => {
    const location = ringLocation(point, outer);
    return location === 'boundary' ||
      (location === 'inside' && holes.every((hole) => ringLocation(point, hole) !== 'inside'));
  });
}

export function hasNeighborhoodDiscount(point: Point) {
  return contains(point, boundary) && neighborhoods.some(({ geometry }) => contains(point, geometry));
}
