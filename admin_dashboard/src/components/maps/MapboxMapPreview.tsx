'use client';

import React from 'react';
import type { MapsRendererConfig } from '@/lib/admin/maps';
import { loadMapboxGL } from '@/lib/maps/mapboxLoader';

type LatLng = { lat: number; lng: number };

export type PreviewBBox = {
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
};

export type MapboxPreviewMarker = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
};

function createBounds() {
  return {
    minLat: Number.POSITIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
  };
}

function extendBounds(bounds: ReturnType<typeof createBounds>, lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  bounds.minLat = Math.min(bounds.minLat, lat);
  bounds.minLng = Math.min(bounds.minLng, lng);
  bounds.maxLat = Math.max(bounds.maxLat, lat);
  bounds.maxLng = Math.max(bounds.maxLng, lng);
}

function bboxFromMapBounds(bounds: any): PreviewBBox | null {
  if (!bounds) return null;
  const southWest = bounds.getSouthWest?.();
  const northEast = bounds.getNorthEast?.();
  if (!southWest || !northEast) return null;
  return {
    min_lat: Number(southWest.lat),
    min_lng: Number(southWest.lng),
    max_lat: Number(northEast.lat),
    max_lng: Number(northEast.lng),
  };
}

function geoJsonBounds(geojson: any): ReturnType<typeof createBounds> | null {
  if (!geojson || !Array.isArray(geojson.features) || geojson.features.length === 0) {
    return null;
  }
  const bounds = createBounds();
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      extendBounds(bounds, Number(value[1]), Number(value[0]));
      return;
    }
    for (const entry of value) walk(entry);
  };

  for (const feature of geojson.features) {
    walk(feature?.geometry?.coordinates);
  }

  if (!Number.isFinite(bounds.minLat)) return null;
  return bounds;
}

function markerFeatureCollection(markers: MapboxPreviewMarker[]) {
  return {
    type: 'FeatureCollection',
    features: markers
      .filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng))
      .map((marker) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [marker.lng, marker.lat],
        },
        properties: {
          id: marker.id,
          title: marker.title ?? '',
        },
      })),
  };
}

function fitToGeoJson(map: any, mapboxgl: any, geojson: any) {
  const bounds = geoJsonBounds(geojson);
  if (!bounds) return;
  map.fitBounds(
    new mapboxgl.LngLatBounds(
      [bounds.minLng, bounds.minLat],
      [bounds.maxLng, bounds.maxLat],
    ),
    { padding: 32, duration: 0, maxZoom: 13.5 },
  );
}

export function MapboxMapPreview(props: {
  rendererConfig: MapsRendererConfig & { provider: 'mapbox' };
  center: LatLng;
  zoom?: number;
  className?: string;
  geojson?: any;
  markers?: MapboxPreviewMarker[];
  fitGeojson?: boolean;
  onBoundsChange?: (bbox: PreviewBBox | null) => void;
  onMapClick?: (point: LatLng) => void;
}): React.JSX.Element {
  const {
    rendererConfig,
    center,
    zoom = 12,
    className,
    geojson,
    markers = [],
    fitGeojson = true,
    onBoundsChange,
    onMapClick,
  } = props;
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const mapboxRef = React.useRef<any>(null);
  const fittedInitialGeoJsonRef = React.useRef(false);
  const onBoundsChangeRef = React.useRef(onBoundsChange);
  const onMapClickRef = React.useRef(onMapClick);
  const geojsonRef = React.useRef(geojson);
  const markersRef = React.useRef(markers);
  const fitGeojsonRef = React.useRef(fitGeojson);

  React.useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange;
  }, [onBoundsChange]);

  React.useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  React.useEffect(() => {
    geojsonRef.current = geojson;
  }, [geojson]);

  React.useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  React.useEffect(() => {
    fitGeojsonRef.current = fitGeojson;
  }, [fitGeojson]);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      const mapboxgl = await loadMapboxGL();
      if (!containerRef.current || cancelled) return;
      const token = String(rendererConfig.config.token ?? '').trim();
      if (!token) throw new Error('mapbox_public_token_missing');

      mapboxgl.accessToken = token;
      mapboxRef.current = mapboxgl;

      if (!mapRef.current) {
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style:
            String(rendererConfig.config.styleUrl ?? '').trim() ||
            'mapbox://styles/mapbox/standard',
          center: [center.lng, center.lat],
          zoom,
          attributionControl: true,
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        mapRef.current = map;

        const updateBounds = () => onBoundsChangeRef.current?.(bboxFromMapBounds(map.getBounds?.()));
        map.on('moveend', updateBounds);
        map.on('click', (event: any) => {
          const lng = event?.lngLat?.lng;
          const lat = event?.lngLat?.lat;
          if (typeof lat === 'number' && typeof lng === 'number') {
            onMapClickRef.current?.({ lat, lng });
          }
        });

        map.once('load', () => {
          if (!map.getSource('rideiq-preview-geojson')) {
            map.addSource('rideiq-preview-geojson', {
              type: 'geojson',
              data: geojsonRef.current ?? { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
              id: 'rideiq-preview-fill',
              type: 'fill',
              source: 'rideiq-preview-geojson',
              paint: {
                'fill-color': '#0f766e',
                'fill-opacity': 0.12,
              },
            });
            map.addLayer({
              id: 'rideiq-preview-line',
              type: 'line',
              source: 'rideiq-preview-geojson',
              paint: {
                'line-color': '#0f766e',
                'line-width': 2,
                'line-opacity': 0.8,
              },
            });
          }

          if (!map.getSource('rideiq-preview-markers')) {
            map.addSource('rideiq-preview-markers', {
              type: 'geojson',
              data: markerFeatureCollection(markersRef.current),
            });
            map.addLayer({
              id: 'rideiq-preview-markers-circle',
              type: 'circle',
              source: 'rideiq-preview-markers',
              paint: {
                'circle-color': '#1d4ed8',
                'circle-radius': 5,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1.5,
              },
            });
          }

          if (fitGeojsonRef.current && geojsonRef.current && !fittedInitialGeoJsonRef.current) {
            fitToGeoJson(map, mapboxgl, geojsonRef.current);
            fittedInitialGeoJsonRef.current = true;
          } else {
            updateBounds();
          }
        });
      }
    })().catch((error) => {
      console.error('[MapboxMapPreview] failed to initialize', error);
      onBoundsChangeRef.current?.(null);
    });

    return () => {
      cancelled = true;
    };
  }, [center.lat, center.lng, rendererConfig.config, zoom]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource?.('rideiq-preview-geojson');
    source?.setData?.(geojson ?? { type: 'FeatureCollection', features: [] });
    if (fitGeojson && geojson && !fittedInitialGeoJsonRef.current && mapboxRef.current) {
      fitToGeoJson(map, mapboxRef.current, geojson);
      fittedInitialGeoJsonRef.current = true;
    }
  }, [fitGeojson, geojson]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource?.('rideiq-preview-markers');
    source?.setData?.(markerFeatureCollection(markers));
  }, [markers]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || (fitGeojson && geojson)) return;
    map.jumpTo({ center: [center.lng, center.lat], zoom });
  }, [center.lat, center.lng, fitGeojson, geojson, zoom]);

  React.useEffect(() => {
    return () => {
      try {
        mapRef.current?.remove?.();
      } catch {
        // ignore cleanup failures
      }
      mapRef.current = null;
      mapboxRef.current = null;
      fittedInitialGeoJsonRef.current = false;
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
