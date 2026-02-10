'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { loadLeaflet } from '@/lib/maps/leafletLoader';

type LatLng = { lat: number; lng: number };

export type LeafletMarker = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
};

export type TileLayerConfig = {
  urlTemplate: string;
  attribution: string;
};

const DEFAULT_TILE_LAYER: TileLayerConfig = {
  urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
};

function safeNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function LeafletMapPreview(props: {
  center: LatLng;
  zoom?: number;
  className?: string;
  tileLayer?: TileLayerConfig;
  geojson?: any;
  markers?: LeafletMarker[];
  fitGeojson?: boolean;
  onMapReady?: (map: any) => void;
}): React.JSX.Element {
  const { center, zoom, className, tileLayer, geojson, markers, fitGeojson, onMapReady } = props;
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const geoRef = useRef<any>(null);
  const markersRef = useRef<any>(null);
  const tile = useMemo(() => tileLayer ?? DEFAULT_TILE_LAYER, [tileLayer]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await loadLeaflet();
      if (!divRef.current || cancelled) return;

      if (!mapRef.current) {
        const map = L.map(divRef.current, {
          zoomControl: true,
          attributionControl: true,
         });
         L.tileLayer(tile.urlTemplate, { attribution: tile.attribution }).addTo(map);
         mapRef.current = map;
         onMapReady?.(map);
         geoRef.current = L.geoJSON(undefined, { interactive: false });
         geoRef.current.addTo(map);
         markersRef.current = L.layerGroup().addTo(map);
       }

       const map = mapRef.current;
       map.setView([center.lat, center.lng], safeNumber(zoom, 12));
     })();

    return () => {
      cancelled = true;
    };
  }, [center.lat, center.lng, zoom, onMapReady, tile.urlTemplate, tile.attribution]);

  useEffect(() => {
    return () => {
      try {
        mapRef.current?.remove?.();
      } catch {
        // ignore
      }
      mapRef.current = null;
      geoRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    (async () => {
      const L = await loadLeaflet();
      const geoLayer = geoRef.current;
      if (!geoLayer) return;
      geoLayer.clearLayers();
      if (geojson) {
        try {
          geoLayer.addData(geojson);
          const bounds = geoLayer.getBounds?.();
          if (fitGeojson !== false) {
            if (bounds?.isValid?.() && mapRef.current) {
              mapRef.current.fitBounds(bounds, { padding: [12, 12] });
            }
          }
        } catch {
          // ignore invalid geojson
        }
      }
    })();
  }, [geojson, fitGeojson]);

  useEffect(() => {
    (async () => {
      const L = await loadLeaflet();
      const layer = markersRef.current;
      if (!layer) return;
      layer.clearLayers();
      for (const m of markers ?? []) {
        const marker = L.marker([m.lat, m.lng]);
        if (m.title) marker.bindTooltip(m.title);
        marker.addTo(layer);
      }
    })();
  }, [markers]);

  return <div ref={divRef} className={className ?? 'h-[520px] w-full rounded-md border'} />;
}
