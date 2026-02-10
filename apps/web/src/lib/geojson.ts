export type GeoJsonGeometry = {
  type: string;
  [k: string]: any;
};

function isRecord(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Extracts a GeoJSON Geometry object from common GeoJSON containers:
 * - Geometry
 * - Feature
 * - FeatureCollection
 *
 * PostGIS's ST_GeomFromGeoJSON accepts only Geometry objects, not Features/Collections.
 */
export function extractGeoJsonGeometry(input: unknown): GeoJsonGeometry | null {
  if (!isRecord(input)) return null;
  const type = String(input.type ?? '').trim();
  if (!type) return null;

  if (type === 'Feature') {
    const geom = (input as any).geometry;
    return isRecord(geom) ? (geom as GeoJsonGeometry) : null;
  }

  if (type === 'FeatureCollection') {
    const features = Array.isArray((input as any).features) ? (input as any).features : [];
    const geoms = features
      .map((f: any) => (isRecord(f) ? f.geometry : null))
      .filter((g: any) => isRecord(g));
    if (geoms.length === 0) return null;
    return { type: 'GeometryCollection', geometries: geoms } as any;
  }

  // Assume it's already a Geometry object.
  return input as GeoJsonGeometry;
}

export function toFeatureCollection(geometry: GeoJsonGeometry): any {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry, properties: {} }],
  };
}
