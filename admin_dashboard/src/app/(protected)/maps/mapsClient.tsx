'use client';

import React from 'react';
import { createClient } from '@/lib/supabase/browser';
import { LeafletMapPreview, type LeafletMarker } from '@/components/maps/LeafletMapPreview';
import { fetchLiveDrivers } from '@/lib/admin/maps';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

type BBox = { min_lat: number; min_lng: number; max_lat: number; max_lng: number };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function bboxFromLeafletBounds(bounds: any): BBox | null {
  try {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const min_lat = clamp(Number(sw.lat), -90, 90);
    const max_lat = clamp(Number(ne.lat), -90, 90);
    const min_lng = clamp(Number(sw.lng), -180, 180);
    const max_lng = clamp(Number(ne.lng), -180, 180);
    return { min_lat, min_lng, max_lat, max_lng };
  } catch {
    return null;
  }
}

export default function MapsClient(): React.JSX.Element {
  const supabase = React.useMemo(() => createClient(), []);
  const [map, setMap] = React.useState<any>(null);
  const [bbox, setBbox] = React.useState<BBox | null>(null);

  const [showAreas, setShowAreas] = React.useState(true);
  const [showDrivers, setShowDrivers] = React.useState(true);

  const [areasGeojson, setAreasGeojson] = React.useState<any | null>(null);
  const [drivers, setDrivers] = React.useState<LeafletMarker[]>([]);
  const [driversSince, setDriversSince] = React.useState<string | null>(null);
  const [driversUpdatedAt, setDriversUpdatedAt] = React.useState<string | null>(null);

  // Service areas overlay (refresh infrequently).
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await invokeEdgeFunction<{ ok: boolean; geojson: any }>(supabase, 'admin-api', {
          path: 'admin-service-areas-list',
          method: 'POST',
          body: { q: '', limit: 500, offset: 0 },
        });
        if (!cancelled) setAreasGeojson(res.geojson ?? null);
      } catch {
        if (!cancelled) setAreasGeojson(null);
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [supabase]);

  // Track bounds for bbox queries.
  React.useEffect(() => {
    if (!map) return;
    const update = () => {
      const b = bboxFromLeafletBounds(map.getBounds());
      if (!b) return;
      setBbox(b);
    };
    update();
    map.on('moveend', update);
    map.on('zoomend', update);
    return () => {
      map.off('moveend', update);
      map.off('zoomend', update);
    };
  }, [map]);

  // Live drivers polling.
  React.useEffect(() => {
    if (!showDrivers) {
      setDrivers([]);
      return;
    }
    if (!bbox) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetchLiveDrivers(supabase, { ...bbox, max_age_seconds: 300, limit: 2000 });
        if (cancelled) return;
        setDriversSince(res.since);
        setDriversUpdatedAt(new Date().toISOString());
        setDrivers(
          (res.drivers ?? []).map((d) => ({
            id: d.driver_id,
            lat: d.lat,
            lng: d.lng,
            title: `driver ${d.driver_id.slice(0, 8)}… • ${new Date(d.updated_at).toLocaleTimeString()}`,
          })),
        );
      } catch {
        if (cancelled) return;
        setDrivers([]);
      }
    };

    tick();
    const id = window.setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [supabase, bbox, showDrivers]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showAreas} onChange={(e) => setShowAreas(e.target.checked)} />
          Service areas
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showDrivers} onChange={(e) => setShowDrivers(e.target.checked)} />
          Live drivers
        </label>
        <div className="text-xs text-neutral-500">
          {showDrivers ? `drivers=${drivers.length}` : 'drivers=hidden'}
          {driversUpdatedAt ? ` • updated=${new Date(driversUpdatedAt).toLocaleTimeString()}` : ''}
          {driversSince ? ` • window=${driversSince}` : ''}
        </div>
      </div>

      <LeafletMapPreview
        center={{ lat: 33.3152, lng: 44.3661 }}
        zoom={11}
        onMapReady={(m) => setMap(m)}
        fitGeojson={false}
        geojson={showAreas ? areasGeojson : null}
        markers={showDrivers ? drivers : []}
        className="h-[74vh] w-full rounded-xl border"
      />
    </div>
  );
}
