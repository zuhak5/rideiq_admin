'use client';

import React from 'react';
import type { MapsRendererConfig } from '@/lib/admin/maps';
import { loadMapboxDraw, loadMapboxGL } from '@/lib/maps/mapboxLoader';

type LatLng = { lat: number; lng: number };

function geometryToFeatureCollection(geometry: any) {
  if (!geometry) return { type: 'FeatureCollection', features: [] };
  if (geometry.type === 'FeatureCollection') return geometry;
  if (geometry.type === 'Feature') {
    return { type: 'FeatureCollection', features: [geometry] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry,
      },
    ],
  };
}

function normalizeDrawGeometry(draw: any): any | null {
  const collection = draw.getAll();
  const features = Array.isArray(collection?.features) ? collection.features : [];
  if (features.length === 0) return null;
  if (features.length === 1) return features[0]?.geometry ?? null;

  const polygons: any[] = [];
  for (const feature of features) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    if (geometry.type === 'Polygon') polygons.push(geometry.coordinates);
    if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
      polygons.push(...geometry.coordinates);
    }
  }
  return polygons.length > 0 ? { type: 'MultiPolygon', coordinates: polygons } : null;
}

export function MapboxPolygonEditor(props: {
  rendererConfig: MapsRendererConfig & { provider: 'mapbox' };
  center: LatLng;
  zoom?: number;
  className?: string;
  initialGeometry?: any;
  onGeometryChange: (geometry: any | null) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const {
    rendererConfig,
    center,
    zoom = 12,
    className,
    initialGeometry,
    onGeometryChange,
    disabled = false,
  } = props;
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const drawRef = React.useRef<any>(null);
  const onGeometryChangeRef = React.useRef(onGeometryChange);

  React.useEffect(() => {
    onGeometryChangeRef.current = onGeometryChange;
  }, [onGeometryChange]);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      const [mapboxgl, MapboxDraw] = await Promise.all([
        loadMapboxGL(),
        loadMapboxDraw(),
      ]);
      if (!containerRef.current || cancelled) return;

      const token = String(rendererConfig.config.token ?? '').trim();
      if (!token) throw new Error('mapbox_public_token_missing');

      mapboxgl.accessToken = token;

      if (!mapRef.current) {
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style:
            String(rendererConfig.config.styleUrl ?? '').trim() ||
            'mapbox://styles/mapbox/standard',
          center: [center.lng, center.lat],
          zoom,
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

        const draw = new MapboxDraw({
          displayControlsDefault: false,
          controls: disabled
            ? {}
            : {
                polygon: true,
                trash: true,
              },
        });

        mapRef.current = map;
        drawRef.current = draw;

        map.once('load', () => {
          map.addControl(draw, 'top-left');

          const syncGeometry = () => {
            onGeometryChangeRef.current(normalizeDrawGeometry(draw));
          };

          map.on('draw.create', (event: any) => {
            const createdId = event?.features?.[0]?.id;
            const all = draw.getAll();
            for (const feature of all.features ?? []) {
              if (feature.id !== createdId) {
                draw.delete(feature.id);
              }
            }
            syncGeometry();
          });
          map.on('draw.update', syncGeometry);
          map.on('draw.delete', syncGeometry);
        });
      }
    })().catch((error) => {
      console.error('[MapboxPolygonEditor] failed to initialize', error);
    });

    return () => {
      cancelled = true;
    };
  }, [center.lat, center.lng, disabled, rendererConfig.config, zoom]);

  React.useEffect(() => {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map?.loaded?.()) return;
    draw.deleteAll();
    const featureCollection = geometryToFeatureCollection(initialGeometry);
    if ((featureCollection.features ?? []).length > 0) {
      draw.add(featureCollection);
    }
  }, [initialGeometry]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.jumpTo({ center: [center.lng, center.lat], zoom });
  }, [center.lat, center.lng, zoom]);

  React.useEffect(() => {
    return () => {
      try {
        mapRef.current?.remove?.();
      } catch {
        // ignore cleanup failures
      }
      mapRef.current = null;
      drawRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className ?? 'h-[520px] w-full rounded-md border'}
      aria-label="map"
    />
  );
}
