import * as React from 'react';
import { MapView } from './MapView';

export type NearbyDriverPoint = {
  driver_id: string;
  lat: number;
  lng: number;
  dist_m?: number;
  updated_at?: string;
};

type Props = {
  center: { lat: number; lng: number };
  radius_m: number;
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null;
  drivers: NearbyDriverPoint[];
  onCenterChange?: (c: { lat: number; lng: number }) => void;
};

export function AdminDriversPreviewMap({ center, radius_m, bbox, drivers, onCenterChange }: Props) {
  const markers = React.useMemo(
    () =>
      drivers.map((d) => ({
        id: d.driver_id,
        position: { lat: d.lat, lng: d.lng },
        title: d.driver_id,
        kind: 'driver' as const,
      })),
    [drivers],
  );

  const circles = React.useMemo(
    () => [{ id: 'search_radius', center, radiusMeters: radius_m }],
    [center, radius_m],
  );

  const rectangles = React.useMemo(
    () =>
      bbox
        ? [
            {
              id: 'search_bbox',
              bounds: { south: bbox.minLat, west: bbox.minLng, north: bbox.maxLat, east: bbox.maxLng },
            },
          ]
        : [],
    [bbox],
  );

  return (
    <MapView
      className="w-full h-full"
      center={center}
      zoom={13}
      markers={markers}
      circles={circles}
      rectangles={rectangles}
      onMapClick={onCenterChange}
    />
  );
}
