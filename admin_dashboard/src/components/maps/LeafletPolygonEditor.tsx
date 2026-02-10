'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { loadLeaflet } from '@/lib/maps/leafletLoader';
import { loadLeafletDraw } from '@/lib/maps/leafletDrawLoader';
import type { TileLayerConfig } from './LeafletMapPreview';

type LatLng = { lat: number; lng: number };

export function LeafletPolygonEditor(props: {
  center: LatLng;
  zoom?: number;
  className?: string;
  tileLayer?: TileLayerConfig;
  initialGeometry?: any;
  onGeometryChange: (geometry: any | null) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const drawnRef = useRef<any>(null);
  const drawCtlRef = useRef<any>(null);
  const tile = useMemo<TileLayerConfig>(
    () =>
      props.tileLayer ?? {
        urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors',
      },
    [props.tileLayer],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = await loadLeafletDraw();
      if (!divRef.current || cancelled) return;

      if (!mapRef.current) {
        const map = L.map(divRef.current, { zoomControl: true, attributionControl: true });
        L.tileLayer(tile.urlTemplate, { attribution: tile.attribution }).addTo(map);
        mapRef.current = map;

        const drawnItems = new L.FeatureGroup();
        drawnItems.addTo(map);
        drawnRef.current = drawnItems;

        const drawControl = new L.Control.Draw({
          draw: props.disabled
            ? false
            : {
                polygon: true,
                rectangle: false,
                circle: false,
                circlemarker: false,
                marker: false,
                polyline: false,
              },
          edit: props.disabled ? false : { featureGroup: drawnItems, remove: true },
        });
        drawCtlRef.current = drawControl;
        if (!props.disabled) map.addControl(drawControl);

        const extract = (fc: any): any | null => {
          const feats = Array.isArray(fc?.features) ? fc.features : [];
          if (feats.length === 0) return null;
          if (feats.length === 1) return feats[0]?.geometry ?? null;

          // Multiple polygon layers => collapse to MultiPolygon.
          const polys: any[] = [];
          for (const f of feats) {
            const g = f?.geometry;
            if (!g) continue;
            if (g.type === 'Polygon') polys.push(g.coordinates);
            if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
              for (const p of g.coordinates) polys.push(p);
            }
          }
          if (polys.length === 0) return null;
          return { type: 'MultiPolygon', coordinates: polys };
        };

        const sync = () => props.onGeometryChange(extract(drawnItems.toGeoJSON()));

        map.on(L.Draw.Event.CREATED, (e: any) => {
          // Single-geometry editor: replace existing.
          drawnItems.clearLayers();
          drawnItems.addLayer(e.layer);
          sync();
        });

        map.on(L.Draw.Event.EDITED, sync);
        map.on(L.Draw.Event.DELETED, sync);
      }

      mapRef.current.setView([props.center.lat, props.center.lng], props.zoom ?? 12);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.center.lat, props.center.lng, props.zoom, props.disabled, tile.urlTemplate, tile.attribution]);

  useEffect(() => {
    (async () => {
      const L = await loadLeaflet();
      const map = mapRef.current;
      const drawnItems = drawnRef.current;
      if (!map || !drawnItems) return;

      drawnItems.clearLayers();
      if (!props.initialGeometry) return;

      try {
        const layer = L.geoJSON(props.initialGeometry);
        layer.eachLayer((l: any) => drawnItems.addLayer(l));
        const bounds = drawnItems.getBounds?.();
        if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: [12, 12] });
      } catch {
        // ignore invalid geometry
      }
    })();
  }, [props.initialGeometry]);

  useEffect(() => {
    return () => {
      try {
        mapRef.current?.remove?.();
      } catch {
        // ignore
      }
      mapRef.current = null;
      drawnRef.current = null;
      drawCtlRef.current = null;
    };
  }, []);

  // Keep the visual style consistent with LeafletMapPreview.
  return (
    <div className={props.className ?? 'h-[520px] w-full rounded-md border'} ref={divRef} aria-label="map" />
  );
}
