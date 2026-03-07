'use client';

import React from 'react';
import type { MapsRendererConfig } from '@/lib/admin/maps';
import { loadHereMaps } from '@/lib/maps/hereLoader';
import type { MapboxPreviewMarker, PreviewBBox } from './MapboxMapPreview';

type LatLng = { lat: number; lng: number };

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

function walkGeometryCoordinates(value: unknown, onPoint: (lng: number, lat: number) => void) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    onPoint(Number(value[0]), Number(value[1]));
    return;
  }
  for (const entry of value) walkGeometryCoordinates(entry, onPoint);
}

export function HereMapPreview(props: {
  rendererConfig: MapsRendererConfig & { provider: 'here' };
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
  const HRef = React.useRef<any>(null);
  const markerGroupRef = React.useRef<any>(null);
  const overlayGroupRef = React.useRef<any>(null);
  const markersRef = React.useRef<Map<string, any>>(new Map());
  const fittedInitialGeoJsonRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      const H = await loadHereMaps();
      if (cancelled || !containerRef.current) return;
      HRef.current = H;

      const apiKey = String(rendererConfig.config.apiKey ?? '').trim();
      if (!apiKey) throw new Error('here_api_key_missing');

      if (!mapRef.current) {
        const platform = new H.service.Platform({ apikey: apiKey });
        const language = String(rendererConfig.config.language ?? 'ar').trim() || 'ar';
        const defaultLayers = platform.createDefaultLayers({
          lg: language,
          ppi:
            typeof window !== 'undefined' &&
            window.devicePixelRatio &&
            window.devicePixelRatio > 1
              ? 320
              : 72,
        });
        const baseLayer =
          defaultLayers?.vector?.normal?.map ?? defaultLayers?.raster?.normal?.map;
        if (!baseLayer) throw new Error('here_base_layer_missing');

        const map = new H.Map(containerRef.current, baseLayer, {
          center,
          zoom,
          pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        });
        mapRef.current = map;
        new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
        H.ui.UI.createDefault(map, defaultLayers);

        markerGroupRef.current = new H.map.Group();
        overlayGroupRef.current = new H.map.Group();
        map.addObject(markerGroupRef.current);
        map.addObject(overlayGroupRef.current);

        const updateBounds = () => {
          const bounds = map.getViewModel?.().getLookAtData?.().bounds;
          if (!bounds) {
            onBoundsChange?.(null);
            return;
          }
          onBoundsChange?.({
            min_lat: Number(bounds.getBottom()),
            min_lng: Number(bounds.getLeft()),
            max_lat: Number(bounds.getTop()),
            max_lng: Number(bounds.getRight()),
          });
        };

        map.addEventListener('mapviewchangeend', updateBounds);
        map.addEventListener('tap', (event: any) => {
          const pointer = event?.currentPointer;
          const viewportX = pointer?.viewportX;
          const viewportY = pointer?.viewportY;
          if (typeof viewportX !== 'number' || typeof viewportY !== 'number') return;
          const point = map.screenToGeo(viewportX, viewportY);
          if (!point) return;
          onMapClick?.({ lat: point.lat, lng: point.lng });
        });
        updateBounds();

        const onResize = () => {
          try {
            map.getViewPort()?.resize();
          } catch {
            // ignore resize failures
          }
        };
        window.addEventListener('resize', onResize);
        (map as any).__rideiqOnResize = onResize;
      }
    })().catch((error) => {
      console.error('[HereMapPreview] failed to initialize', error);
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
    const markerGroup = markerGroupRef.current;
    const H = HRef.current;
    if (!markerGroup || !H) return;

    for (const [id, marker] of markersRef.current.entries()) {
      if (!markers.some((entry) => entry.id === id)) {
        markerGroup.removeObject(marker);
        markersRef.current.delete(id);
      }
    }

    for (const marker of markers) {
      const position = { lat: marker.lat, lng: marker.lng };
      const existing = markersRef.current.get(marker.id);
      if (existing) {
        existing.setGeometry(position);
        continue;
      }
      const nextMarker = new H.map.Marker(position);
      markerGroup.addObject(nextMarker);
      markersRef.current.set(marker.id, nextMarker);
    }
  }, [markers]);

  React.useEffect(() => {
    const overlayGroup = overlayGroupRef.current;
    const H = HRef.current;
    const map = mapRef.current;
    if (!overlayGroup || !H || !map) return;

    overlayGroup.removeAll();

    if (geojson?.features) {
      for (const feature of geojson.features) {
        const geometry = feature?.geometry;
        if (!geometry) continue;

        if (geometry.type === 'Polygon') {
          for (const ring of geometry.coordinates ?? []) {
            const strip = new H.geo.LineString();
            for (const point of ring ?? []) {
              if (Array.isArray(point) && point.length >= 2) {
                strip.pushLatLngAlt(Number(point[1]), Number(point[0]), 0);
              }
            }
            overlayGroup.addObject(
              new H.map.Polygon(strip, {
                style: {
                  fillColor: 'rgba(15, 118, 110, 0.12)',
                  strokeColor: 'rgba(15, 118, 110, 0.85)',
                  lineWidth: 2,
                },
              }),
            );
          }
          continue;
        }

        if (geometry.type === 'MultiPolygon') {
          for (const polygon of geometry.coordinates ?? []) {
            for (const ring of polygon ?? []) {
              const strip = new H.geo.LineString();
              for (const point of ring ?? []) {
                if (Array.isArray(point) && point.length >= 2) {
                  strip.pushLatLngAlt(Number(point[1]), Number(point[0]), 0);
                }
              }
              overlayGroup.addObject(
                new H.map.Polygon(strip, {
                  style: {
                    fillColor: 'rgba(15, 118, 110, 0.12)',
                    strokeColor: 'rgba(15, 118, 110, 0.85)',
                    lineWidth: 2,
                  },
                }),
              );
            }
          }
          continue;
        }

        if (geometry.type === 'LineString') {
          const strip = new H.geo.LineString();
          walkGeometryCoordinates(geometry.coordinates, (lng, lat) => {
            strip.pushLatLngAlt(lat, lng, 0);
          });
          overlayGroup.addObject(
            new H.map.Polyline(strip, {
              style: { strokeColor: '#0f766e', lineWidth: 2 },
            }),
          );
          continue;
        }

        if (geometry.type === 'MultiLineString') {
          for (const line of geometry.coordinates ?? []) {
            const strip = new H.geo.LineString();
            walkGeometryCoordinates(line, (lng, lat) => {
              strip.pushLatLngAlt(lat, lng, 0);
            });
            overlayGroup.addObject(
              new H.map.Polyline(strip, {
                style: { strokeColor: '#0f766e', lineWidth: 2 },
              }),
            );
          }
        }
      }
    }

    if (fitGeojson && geojson && !fittedInitialGeoJsonRef.current) {
      const bounds = geoJsonBounds(geojson);
      if (bounds) {
        map.getViewModel()?.setLookAtData?.({
          bounds: new H.geo.Rect(
            bounds.max_lat,
            bounds.min_lng,
            bounds.min_lat,
            bounds.max_lng,
          ),
        });
        fittedInitialGeoJsonRef.current = true;
      }
    }
  }, [fitGeojson, geojson]);

  React.useEffect(() => {
    const markersById = markersRef.current;
    return () => {
      for (const marker of markersById.values()) {
        try {
          markerGroupRef.current?.removeObject(marker);
        } catch {
          // ignore cleanup failures
        }
      }
      markersById.clear();

      const onResize = mapRef.current?.__rideiqOnResize;
      if (onResize) {
        try {
          window.removeEventListener('resize', onResize);
        } catch {
          // ignore cleanup failures
        }
      }

      try {
        mapRef.current?.dispose?.();
      } catch {
        // ignore cleanup failures
      }

      mapRef.current = null;
      markerGroupRef.current = null;
      overlayGroupRef.current = null;
      HRef.current = null;
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
