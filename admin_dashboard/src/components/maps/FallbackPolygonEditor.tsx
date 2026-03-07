'use client';

import React from 'react';
import type { MapsRendererConfig } from '@/lib/admin/maps';
import { ApprovedMapPreview } from './ApprovedMapPreview';

type LatLng = { lat: number; lng: number };

function parsePolygonPoints(geometry: any): LatLng[] {
  const ring =
    geometry?.type === 'Polygon'
      ? geometry.coordinates?.[0]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates?.[0]?.[0]
        : null;

  if (!Array.isArray(ring)) return [];

  return ring
    .filter(
      (point: unknown) =>
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === 'number' &&
        typeof point[1] === 'number',
    )
    .slice(0, -1)
    .map((point: number[]) => ({ lat: Number(point[1]), lng: Number(point[0]) }));
}

function buildPolygonGeometry(points: LatLng[]): any | null {
  if (points.length < 3) return null;
  const ring = points.map((point) => [point.lng, point.lat]);
  ring.push([points[0].lng, points[0].lat]);
  return {
    type: 'Polygon',
    coordinates: [ring],
  };
}

export function FallbackPolygonEditor(props: {
  rendererConfig: MapsRendererConfig;
  center: LatLng;
  zoom?: number;
  initialGeometry?: any | null;
  onGeometryChange: (geometry: any | null) => void;
}): React.JSX.Element {
  const { rendererConfig, center, zoom = 12, initialGeometry, onGeometryChange } = props;

  const [points, setPoints] = React.useState<LatLng[]>(() => parsePolygonPoints(initialGeometry));

  const geometry = React.useMemo(() => buildPolygonGeometry(points), [points]);

  React.useEffect(() => {
    onGeometryChange(geometry);
  }, [geometry, onGeometryChange]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Mapbox Draw is not currently available from the backend, so this editor
        falls back to click-to-draw on the approved renderer. Click the map to add
        polygon points, then use Undo or Clear as needed.
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
        <span>points={points.length}</span>
        <button
          type="button"
          className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50 disabled:opacity-50"
          disabled={points.length === 0}
          onClick={() => setPoints((current) => current.slice(0, -1))}
        >
          Undo point
        </button>
        <button
          type="button"
          className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50 disabled:opacity-50"
          disabled={points.length === 0}
          onClick={() => setPoints([])}
        >
          Clear polygon
        </button>
      </div>

      <ApprovedMapPreview
        rendererConfig={rendererConfig}
        center={center}
        zoom={zoom}
        fitGeojson={Boolean(initialGeometry)}
        geojson={
          geometry
            ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: {} }] }
            : null
        }
        onMapClick={(point) => setPoints((current) => [...current, point])}
        className="h-[520px] w-full rounded-md border"
      />
    </div>
  );
}
