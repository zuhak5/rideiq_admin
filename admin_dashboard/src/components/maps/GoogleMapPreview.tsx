'use client';

import React from 'react';
import type { MapsRendererConfig } from '@/lib/admin/maps';
import { loadGoogleMapsWithConfig } from '@/lib/maps/googleMapsLoader';
import type { MapboxPreviewMarker, PreviewBBox } from './MapboxMapPreview';

type LatLng = { lat: number; lng: number };

function bboxFromBounds(bounds: any): PreviewBBox | null {
  if (!bounds) return null;
  const southWest = bounds.getSouthWest?.();
  const northEast = bounds.getNorthEast?.();
  if (!southWest || !northEast) return null;
  return {
    min_lat: Number(southWest.lat()),
    min_lng: Number(southWest.lng()),
    max_lat: Number(northEast.lat()),
    max_lng: Number(northEast.lng()),
  };
}

function geoJsonBounds(geojson: any): PreviewBBox | null {
  if (!geojson || !Array.isArray(geojson.features)) return null;

  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      minLng = Math.min(minLng, Number(value[0]));
      minLat = Math.min(minLat, Number(value[1]));
      maxLng = Math.max(maxLng, Number(value[0]));
      maxLat = Math.max(maxLat, Number(value[1]));
      return;
    }
    for (const entry of value) walk(entry);
  };

  for (const feature of geojson.features) {
    walk(feature?.geometry?.coordinates);
  }

  if (!Number.isFinite(minLat)) return null;
  return {
    min_lat: minLat,
    min_lng: minLng,
    max_lat: maxLat,
    max_lng: maxLng,
  };
}

export function GoogleMapPreview(props: {
  rendererConfig: MapsRendererConfig & { provider: 'google' };
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
  const markersRef = React.useRef<Map<string, any>>(new Map());
  const listenersRef = React.useRef<any[]>([]);
  const fittedInitialGeoJsonRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      await loadGoogleMapsWithConfig(rendererConfig, []);
      if (cancelled || !containerRef.current) return;

      const googleMaps = (window as any).google?.maps;
      if (!googleMaps) throw new Error('google_maps_missing');

      if (!mapRef.current) {
        const map = new googleMaps.Map(containerRef.current, {
          center,
          zoom,
          mapId: String(rendererConfig.config.mapId ?? '').trim() || undefined,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
        });
        mapRef.current = map;
        map.data.setStyle({
          fillColor: '#0f766e',
          fillOpacity: 0.12,
          strokeColor: '#0f766e',
          strokeOpacity: 0.8,
          strokeWeight: 2,
        });

        listenersRef.current.push(
          map.addListener('idle', () => onBoundsChange?.(bboxFromBounds(map.getBounds?.()))),
        );
        listenersRef.current.push(
          map.addListener('click', (event: any) => {
            const lat = event?.latLng?.lat?.();
            const lng = event?.latLng?.lng?.();
            if (typeof lat === 'number' && typeof lng === 'number') {
              onMapClick?.({ lat, lng });
            }
          }),
        );
      }
    })().catch((error) => {
      console.error('[GoogleMapPreview] failed to initialize', error);
      onBoundsChange?.(null);
    });

    return () => {
      cancelled = true;
    };
  }, [center, onBoundsChange, onMapClick, rendererConfig, zoom]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.setCenter(center);
    map.setZoom(zoom);
  }, [center, zoom]);

  React.useEffect(() => {
    const map = mapRef.current;
    const googleMaps = (window as any).google?.maps;
    if (!map || !googleMaps) return;

    for (const [id, marker] of markersRef.current.entries()) {
      if (!markers.some((entry) => entry.id === id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    }

    for (const marker of markers) {
      const position = { lat: marker.lat, lng: marker.lng };
      const existing = markersRef.current.get(marker.id);
      if (existing) {
        existing.setPosition(position);
        if (marker.title !== undefined) existing.setTitle(marker.title);
        continue;
      }
      markersRef.current.set(
        marker.id,
        new googleMaps.Marker({
          map,
          position,
          title: marker.title ?? undefined,
        }),
      );
    }
  }, [markers]);

  React.useEffect(() => {
    const map = mapRef.current;
    const googleMaps = (window as any).google?.maps;
    if (!map || !googleMaps) return;

    map.data.forEach((feature: any) => {
      map.data.remove(feature);
    });

    if (geojson) {
      map.data.addGeoJson(geojson);
    }

    if (fitGeojson && geojson && !fittedInitialGeoJsonRef.current) {
      const bounds = geoJsonBounds(geojson);
      if (bounds) {
        const nextBounds = new googleMaps.LatLngBounds(
          { lat: bounds.min_lat, lng: bounds.min_lng },
          { lat: bounds.max_lat, lng: bounds.max_lng },
        );
        map.fitBounds(nextBounds);
        fittedInitialGeoJsonRef.current = true;
      }
    }
  }, [fitGeojson, geojson]);

  React.useEffect(() => {
    const markersById = markersRef.current;
    const listeners = listenersRef.current;
    return () => {
      for (const listener of listeners) {
        try {
          listener?.remove?.();
        } catch {
          // ignore cleanup failures
        }
      }
      listenersRef.current = [];

      for (const marker of markersById.values()) {
        try {
          marker.setMap(null);
        } catch {
          // ignore cleanup failures
        }
      }
      markersById.clear();
      mapRef.current = null;
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
