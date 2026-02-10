import React from 'react';
import { fetchMapsConfigV2, type MapsConfigV2, type MapsProvider } from '../../lib/mapsConfig';
import { loadGoogleMapsWithConfig } from '../../lib/googleMaps';
import { applyArabicLabelLanguage, loadMapboxGL } from '../../lib/mapboxLoader';
import { loadHereMaps } from '../../lib/hereLoader';
import { loadLeaflet } from '../../lib/leafletLoader';
import { logMapsUsage } from '../../lib/mapsUsage';

export type LatLng = { lat: number; lng: number };

export type MapMarker = {
  id: string;
  position: LatLng;
  title?: string;
  label?: string;
  kind?: 'driver' | 'default';
};

export type MapCircle = {
  id: string;
  center: LatLng;
  radiusMeters: number;
};

export type MapRectangle = {
  id: string;
  bounds: { south: number; west: number; north: number; east: number };
};

export type MapPolyline = {
  id: string;
  path: LatLng[];
  kind?: 'route' | 'default';
};

type MapAdapter = {
  provider: MapsProvider;
  setView: (center: LatLng, zoom: number) => void;
  setMarkers: (markers: MapMarker[]) => void;
  setCircles: (circles: MapCircle[]) => void;
  setRectangles: (rectangles: MapRectangle[]) => void;
  setPolylines: (polylines: MapPolyline[]) => void;
  setOnClick: (handler?: ((pos: LatLng) => void) | null) => void;
  destroy: () => void;
};

type Props = {
  center: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  circles?: MapCircle[];
  rectangles?: MapRectangle[];
  polylines?: MapPolyline[];
  onMapClick?: (pos: LatLng) => void;
  className?: string;
  /** Providers that the current build is capable of rendering. */
  supportedRenderProviders?: MapsProvider[];
  /** Optional callback to observe which renderer is currently active (useful for geo API compliance decisions). */
  onProviderChange?: (provider: MapsProvider) => void;
};

const DEFAULT_SUPPORTED_RENDER_PROVIDERS: MapsProvider[] = ['google', 'mapbox', 'here', 'thunderforest'];

function isFiniteLatLng(p: LatLng) {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

function clampZoom(z: number) {
  if (!Number.isFinite(z)) return 12;
  return Math.max(1, Math.min(20, Math.round(z)));
}

function assertContainer(el: HTMLDivElement | null): asserts el is HTMLDivElement {
  if (!el) throw new Error('missing_map_container');
}

function createGoogleAdapter(container: HTMLDivElement, cfg: MapsConfigV2, initial: { center: LatLng; zoom: number }): MapAdapter {
  const g = (window as any).google as any;
  if (!g?.maps) throw new Error('google_maps_missing');

  const map = new g.maps.Map(container, {
    center: initial.center,
    zoom: initial.zoom,
    mapId: (cfg.config.mapId as string | undefined) ?? undefined,
    fullscreenControl: false,
    mapTypeControl: false,
    streetViewControl: false,
  });

  const markersById = new Map<string, any>();
  const circlesById = new Map<string, any>();
  const rectanglesById = new Map<string, any>();
  const polylinesById = new Map<string, any>();
  let clickListener: any | null = null;

  const setOnClick = (handler?: ((pos: LatLng) => void) | null) => {
    if (clickListener?.remove) {
      try {
        clickListener.remove();
      } catch {
        // ignore
      }
    }
    clickListener = null;
    if (!handler) return;
    clickListener = map.addListener('click', (evt: any) => {
      const lat = evt?.latLng?.lat?.();
      const lng = evt?.latLng?.lng?.();
      if (typeof lat === 'number' && typeof lng === 'number') {
        handler({ lat, lng });
      }
    });
  };

  const setMarkers = (markers: MapMarker[]) => {
    const keep = new Set(markers.map((m) => m.id));
    for (const [id, marker] of markersById.entries()) {
      if (!keep.has(id)) {
        marker.setMap(null);
        markersById.delete(id);
      }
    }

    for (const m of markers) {
      if (!isFiniteLatLng(m.position)) continue;
      const existing = markersById.get(m.id);
      const icon = m.kind === 'driver'
        ? {
            path: 'M12 2c-3.9 0-7 3.1-7 7 0 5.3 7 13 7 13s7-7.7 7-13c0-3.9-3.1-7-7-7z',
            fillColor: '#1d4ed8',
            fillOpacity: 1,
            strokeWeight: 0,
            scale: 1,
            anchor: new g.maps.Point(12, 24),
          }
        : undefined;

      if (existing) {
        existing.setPosition(m.position);
        if (m.title !== undefined) existing.setTitle(m.title);
        if (icon) existing.setIcon(icon);
        continue;
      }

      const marker = new g.maps.Marker({
        map,
        position: m.position,
        title: m.title ?? undefined,
        label: m.label ?? undefined,
        icon,
      });
      markersById.set(m.id, marker);
    }
  };

  const setCircles = (circles: MapCircle[]) => {
    const keep = new Set(circles.map((c) => c.id));
    for (const [id, circle] of circlesById.entries()) {
      if (!keep.has(id)) {
        circle.setMap(null);
        circlesById.delete(id);
      }
    }

    for (const c of circles) {
      if (!isFiniteLatLng(c.center)) continue;
      const radius = Math.max(0, Number(c.radiusMeters) || 0);
      const existing = circlesById.get(c.id);
      if (existing) {
        existing.setCenter(c.center);
        existing.setRadius(radius);
        continue;
      }

      const circle = new g.maps.Circle({
        map,
        center: c.center,
        radius,
        strokeColor: '#2563eb',
        strokeOpacity: 0.65,
        strokeWeight: 2,
        fillColor: '#2563eb',
        fillOpacity: 0.08,
      });
      circlesById.set(c.id, circle);
    }
  };

  const setRectangles = (rectangles: MapRectangle[]) => {
    const keep = new Set(rectangles.map((r) => r.id));
    for (const [id, rect] of rectanglesById.entries()) {
      if (!keep.has(id)) {
        rect.setMap(null);
        rectanglesById.delete(id);
      }
    }

    for (const r of rectangles) {
      const b = r.bounds;
      if (!b) continue;
      if (![b.south, b.west, b.north, b.east].every(Number.isFinite)) continue;
      const existing = rectanglesById.get(r.id);
      const bounds = { south: b.south, west: b.west, north: b.north, east: b.east };
      if (existing) {
        existing.setBounds(bounds);
        continue;
      }
      const rect = new g.maps.Rectangle({
        map,
        bounds,
        clickable: false,
        strokeColor: '#2563eb',
        strokeOpacity: 0.5,
        strokeWeight: 2,
        fillColor: '#2563eb',
        fillOpacity: 0.02,
      });
      rectanglesById.set(r.id, rect);
    }
  };

  const setPolylines = (polylines: MapPolyline[]) => {
    const keep = new Set(polylines.map((p) => p.id));
    for (const [id, line] of polylinesById.entries()) {
      if (!keep.has(id)) {
        line.setMap(null);
        polylinesById.delete(id);
      }
    }

    for (const p of polylines) {
      const pts = Array.isArray(p.path) ? p.path.filter(isFiniteLatLng) : [];
      if (pts.length < 2) continue;
      const existing = polylinesById.get(p.id);
      if (existing) {
        existing.setPath(pts);
        continue;
      }

      const line = new g.maps.Polyline({
        map,
        path: pts,
        geodesic: true,
        strokeColor: p.kind === 'route' ? '#1d4ed8' : '#111827',
        strokeOpacity: 0.9,
        strokeWeight: p.kind === 'route' ? 5 : 3,
      });
      polylinesById.set(p.id, line);
    }
  };

  const setView = (center: LatLng, zoom: number) => {
    if (!isFiniteLatLng(center)) return;
    map.setCenter(center);
    map.setZoom(clampZoom(zoom));
  };

  return {
    provider: 'google',
    setView,
    setMarkers,
    setCircles,
    setRectangles,
    setPolylines,
    setOnClick,
    destroy: () => {
      setOnClick(null);
      for (const m of markersById.values()) m.setMap(null);
      for (const c of circlesById.values()) c.setMap(null);
      for (const r of rectanglesById.values()) r.setMap(null);
      for (const l of polylinesById.values()) l.setMap(null);
      markersById.clear();
      circlesById.clear();
      rectanglesById.clear();
      polylinesById.clear();
    },
  };
}

function toRad(d: number) {
  return (d * Math.PI) / 180;
}
function toDeg(r: number) {
  return (r * 180) / Math.PI;
}

function destinationPoint(center: LatLng, distanceMeters: number, bearingDeg: number): LatLng {
  // Spherical law of cosines / haversine forward calculation.
  const R = 6371008.8;
  const δ = distanceMeters / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(center.lat);
  const λ1 = toRad(center.lng);

  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const y = Math.sin(θ) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);

  const lat = toDeg(φ2);
  const lng = ((toDeg(λ2) + 540) % 360) - 180;
  return { lat, lng };
}

function circlePolygon(center: LatLng, radiusMeters: number, steps = 64): number[][][] {
  const coords: number[][] = [];
  const r = Math.max(0, radiusMeters);
  const n = Math.max(12, Math.min(256, Math.trunc(steps)));
  for (let i = 0; i <= n; i += 1) {
    const bearing = (i / n) * 360;
    const p = destinationPoint(center, r, bearing);
    coords.push([p.lng, p.lat]);
  }
  return [coords];
}

function rectanglePolygon(b: { south: number; west: number; north: number; east: number }): number[][][] {
  return [
    [
      [b.west, b.south],
      [b.west, b.north],
      [b.east, b.north],
      [b.east, b.south],
      [b.west, b.south],
    ],
  ];
}

function createMapboxAdapter(
  container: HTMLDivElement,
  cfg: MapsConfigV2,
  initial: { center: LatLng; zoom: number },
): Promise<MapAdapter> {
  return (async () => {
    const mapboxgl = await loadMapboxGL();
    const token = cfg.config.token as string | undefined;
    if (!token) throw new Error('missing_mapbox_token');
    mapboxgl.accessToken = token;

    const styleUrl = (cfg.config.styleUrl as string | undefined) ?? 'mapbox://styles/mapbox/streets-v12';

    const map = new mapboxgl.Map({
      container,
      style: styleUrl,
      center: [initial.center.lng, initial.center.lat],
      zoom: initial.zoom,
      attributionControl: true,
    });

    let loaded = false;
    let markers: MapMarker[] = [];
    let circles: MapCircle[] = [];
    let rectangles: MapRectangle[] = [];
    let polylines: MapPolyline[] = [];
    let clickHandler: ((pos: LatLng) => void) | null = null;

    const emptyFC: { type: 'FeatureCollection'; features: any[] } = { type: 'FeatureCollection', features: [] };

    function ensureSourcesAndLayers() {
      if (map.getSource('rideiq_markers')) return;

      map.addSource('rideiq_markers', {
        type: 'geojson',
        data: emptyFC,
      });
      map.addSource('rideiq_circles', {
        type: 'geojson',
        data: emptyFC,
      });
      map.addSource('rideiq_rectangles', {
        type: 'geojson',
        data: emptyFC,
      });

      map.addSource('rideiq_lines', {
        type: 'geojson',
        data: emptyFC,
      });

      map.addLayer({
        id: 'rideiq_circles_fill',
        type: 'fill',
        source: 'rideiq_circles',
        paint: {
          'fill-color': '#2563eb',
          'fill-opacity': 0.08,
        },
      });
      map.addLayer({
        id: 'rideiq_circles_line',
        type: 'line',
        source: 'rideiq_circles',
        paint: {
          'line-color': '#2563eb',
          'line-width': 2,
          'line-opacity': 0.65,
        },
      });

      map.addLayer({
        id: 'rideiq_rectangles_fill',
        type: 'fill',
        source: 'rideiq_rectangles',
        paint: {
          'fill-color': '#2563eb',
          'fill-opacity': 0.02,
        },
      });
      map.addLayer({
        id: 'rideiq_rectangles_line',
        type: 'line',
        source: 'rideiq_rectangles',
        paint: {
          'line-color': '#2563eb',
          'line-width': 2,
          'line-opacity': 0.5,
        },
      });

      map.addLayer({
        id: 'rideiq_lines_route',
        type: 'line',
        source: 'rideiq_lines',
        filter: ['==', ['get', 'kind'], 'route'],
        paint: {
          'line-color': '#1d4ed8',
          'line-width': 5,
          'line-opacity': 0.9,
        },
      });

      map.addLayer({
        id: 'rideiq_lines_default',
        type: 'line',
        source: 'rideiq_lines',
        filter: ['!=', ['get', 'kind'], 'route'],
        paint: {
          'line-color': '#111827',
          'line-width': 3,
          'line-opacity': 0.8,
        },
      });

      map.addLayer({
        id: 'rideiq_markers_driver',
        type: 'circle',
        source: 'rideiq_markers',
        filter: ['==', ['get', 'kind'], 'driver'],
        paint: {
          'circle-color': '#1d4ed8',
          'circle-radius': 6,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.8,
        },
      });

      map.addLayer({
        id: 'rideiq_markers_default',
        type: 'circle',
        source: 'rideiq_markers',
        filter: ['!=', ['get', 'kind'], 'driver'],
        paint: {
          'circle-color': '#111827',
          'circle-stroke-color': '#ffffff',
          'circle-radius': 5,
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.8,
        },
      });

      map.addLayer({
        id: 'rideiq_marker_labels',
        type: 'symbol',
        source: 'rideiq_markers',
        filter: ['all', ['has', 'label'], ['!=', ['get', 'label'], '']],
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 12,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#111827',
          'text-opacity': 0.9,
        },
      });
    }

    function updateMarkers() {
      if (!loaded) return;
      const features = markers
        .filter((m) => isFiniteLatLng(m.position))
        .map((m) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [m.position.lng, m.position.lat] },
          properties: {
            id: m.id,
            title: m.title ?? '',
            label: m.label ?? '',
            kind: m.kind ?? 'default',
          },
        }));
      const src = map.getSource('rideiq_markers') as any;
      src?.setData?.({ type: 'FeatureCollection', features });
    }

    function updateCircles() {
      if (!loaded) return;
      const features = circles
        .filter((c) => isFiniteLatLng(c.center) && Number.isFinite(c.radiusMeters) && c.radiusMeters > 0)
        .map((c) => ({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: circlePolygon(c.center, c.radiusMeters) },
          properties: { id: c.id },
        }));
      const src = map.getSource('rideiq_circles') as any;
      src?.setData?.({ type: 'FeatureCollection', features });
    }

    function updateRectangles() {
      if (!loaded) return;
      const features = rectangles
        .filter((r) => {
          const b = r.bounds;
          return b && [b.south, b.west, b.north, b.east].every(Number.isFinite);
        })
        .map((r) => ({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: rectanglePolygon(r.bounds) },
          properties: { id: r.id },
        }));
      const src = map.getSource('rideiq_rectangles') as any;
      src?.setData?.({ type: 'FeatureCollection', features });
    }

    function updatePolylines() {
      if (!loaded) return;
      const features = polylines
        .filter((p) => Array.isArray(p.path) && p.path.length >= 2)
        .map((p) => {
          const coords = p.path.filter(isFiniteLatLng).map((pt) => [pt.lng, pt.lat]);
          if (coords.length < 2) return null;
          return {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: { id: p.id, kind: p.kind ?? 'default' },
          };
        })
        .filter(Boolean);
      const src = map.getSource('rideiq_lines') as any;
      src?.setData?.({ type: 'FeatureCollection', features });
    }

    function setOnClick(handler?: ((pos: LatLng) => void) | null) {
      clickHandler = handler ?? null;
    }

    function onClick(evt: any) {
      if (!clickHandler) return;
      const lng = evt?.lngLat?.lng;
      const lat = evt?.lngLat?.lat;
      if (typeof lat === 'number' && typeof lng === 'number') {
        clickHandler({ lat, lng });
      }
    }

    map.on('click', onClick);

    await new Promise<void>((resolve, reject) => {
      const onLoad = () => {
        try {
          loaded = true;
          applyArabicLabelLanguage(map);
          ensureSourcesAndLayers();
          updateMarkers();
          updateCircles();
          updateRectangles();
          updatePolylines();
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      const onError = (e: any) => {
        reject(new Error(e?.error?.message || 'mapbox_map_error'));
      };

      map.once('load', onLoad);
      map.once('error', onError);
    });

    const setView = (center: LatLng, zoom: number) => {
      if (!loaded) return;
      if (!isFiniteLatLng(center)) return;
      map.jumpTo({ center: [center.lng, center.lat], zoom: clampZoom(zoom) });
    };

    const setMarkersFn = (next: MapMarker[]) => {
      markers = Array.isArray(next) ? next : [];
      updateMarkers();
    };

    const setCirclesFn = (next: MapCircle[]) => {
      circles = Array.isArray(next) ? next : [];
      updateCircles();
    };

    const setRectanglesFn = (next: MapRectangle[]) => {
      rectangles = Array.isArray(next) ? next : [];
      updateRectangles();
    };

    const setPolylinesFn = (next: MapPolyline[]) => {
      polylines = Array.isArray(next) ? next : [];
      updatePolylines();
    };

    return {
      provider: 'mapbox',
      setView,
      setMarkers: setMarkersFn,
      setCircles: setCirclesFn,
      setRectangles: setRectanglesFn,
      setPolylines: setPolylinesFn,
      setOnClick,
      destroy: () => {
        try {
          map.off('click', onClick);
        } catch {
          // ignore
        }
        try {
          map.remove();
        } catch {
          // ignore
        }
      },
    };
  })();
}


async function createHereAdapter(
  container: HTMLDivElement,
  cfg: MapsConfigV2,
  initial: { center: LatLng; zoom: number },
): Promise<MapAdapter> {
  const H = await loadHereMaps();
  if (!H?.service?.Platform) throw new Error('here_maps_missing');

  const apiKey = String((cfg.config as any).apiKey ?? '');
  if (!apiKey) throw new Error('here_api_key_missing');

  const language = String((cfg.config as any).language ?? 'ar');

  const platform = new H.service.Platform({ apikey: apiKey });
  const defaultLayers = platform.createDefaultLayers({
    lg: language,
    ppi: typeof window !== 'undefined' && window.devicePixelRatio && window.devicePixelRatio > 1 ? 320 : 72,
  });

  const baseLayer = defaultLayers?.vector?.normal?.map ?? defaultLayers?.raster?.normal?.map;
  if (!baseLayer) throw new Error('here_base_layer_missing');

  const map = new H.Map(container, baseLayer, {
    center: initial.center,
    zoom: initial.zoom,
    pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  });

  // Enable interactions (pan/zoom) and default UI controls.
  const behavior = new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
  void behavior; // avoid unused
  H.ui.UI.createDefault(map, defaultLayers);

  const group = new H.map.Group();
  map.addObject(group);

  const markersById = new Map<string, any>();
  const circlesById = new Map<string, any>();
  const rectanglesById = new Map<string, any>();
  const polylinesById = new Map<string, any>();

  let tapHandler: any | null = null;

  const setOnClick = (handler?: ((pos: LatLng) => void) | null) => {
    if (tapHandler) {
      try {
        map.removeEventListener('tap', tapHandler);
      } catch {
        // ignore
      }
      tapHandler = null;
    }
    if (!handler) return;
    tapHandler = (evt: any) => {
      try {
        const cp = evt?.currentPointer;
        const x = cp?.viewportX;
        const y = cp?.viewportY;
        if (typeof x !== 'number' || typeof y !== 'number') return;
        const coord = map.screenToGeo(x, y);
        if (!coord) return;
        handler({ lat: coord.lat, lng: coord.lng });
      } catch {
        // ignore
      }
    };
    map.addEventListener('tap', tapHandler);
  };

  const setMarkers = (markers: MapMarker[]) => {
    const keep = new Set(markers.map((m) => m.id));
    for (const [id, marker] of markersById.entries()) {
      if (!keep.has(id)) {
        group.removeObject(marker);
        markersById.delete(id);
      }
    }

    for (const m of markers) {
      if (!isFiniteLatLng(m.position)) continue;
      const existing = markersById.get(m.id);
      if (existing) {
        existing.setGeometry(m.position);
        continue;
      }
      const marker = new H.map.Marker(m.position);
      if (m.title) marker.setData(m.title);
      group.addObject(marker);
      markersById.set(m.id, marker);
    }
  };

  const setCircles = (circles: MapCircle[]) => {
    const keep = new Set(circles.map((c) => c.id));
    for (const [id, circle] of circlesById.entries()) {
      if (!keep.has(id)) {
        group.removeObject(circle);
        circlesById.delete(id);
      }
    }

    for (const c of circles) {
      if (!isFiniteLatLng(c.center)) continue;
      const existing = circlesById.get(c.id);
      if (existing) {
        existing.setCenter(c.center);
        existing.setRadius(c.radiusMeters);
        continue;
      }
      const circle = new H.map.Circle(c.center, c.radiusMeters);
      group.addObject(circle);
      circlesById.set(c.id, circle);
    }
  };

  const setRectangles = (rectangles: MapRectangle[]) => {
    const keep = new Set(rectangles.map((r) => r.id));
    for (const [id, rect] of rectanglesById.entries()) {
      if (!keep.has(id)) {
        group.removeObject(rect);
        rectanglesById.delete(id);
      }
    }

    for (const r of rectangles) {
      const b = r.bounds;
      if (!Number.isFinite(b.north) || !Number.isFinite(b.south) || !Number.isFinite(b.east) || !Number.isFinite(b.west)) continue;
      const existing = rectanglesById.get(r.id);
      if (existing) {
        group.removeObject(existing);
        rectanglesById.delete(r.id);
      }
      const rect = new H.map.Rect(new H.geo.Rect(b.north, b.west, b.south, b.east));
      group.addObject(rect);
      rectanglesById.set(r.id, rect);
    }
  };

  const setPolylines = (polylines: MapPolyline[]) => {
    const keep = new Set(polylines.map((p) => p.id));
    for (const [id, pl] of polylinesById.entries()) {
      if (!keep.has(id)) {
        group.removeObject(pl);
        polylinesById.delete(id);
      }
    }

    for (const p of polylines) {
      const existing = polylinesById.get(p.id);
      if (existing) {
        group.removeObject(existing);
        polylinesById.delete(p.id);
      }

      const lineString = new H.geo.LineString();
      for (const pt of p.path) {
        if (!isFiniteLatLng(pt)) continue;
        lineString.pushPoint(pt);
      }
      const polyline = new H.map.Polyline(lineString, { style: { lineWidth: 5 } });
      group.addObject(polyline);
      polylinesById.set(p.id, polyline);
    }
  };

  const setView = (center: LatLng, zoom: number) => {
    if (!isFiniteLatLng(center)) return;
    map.setCenter(center);
    map.setZoom(clampZoom(zoom));
  };

  const onResize = () => {
    try {
      map.getViewPort()?.resize();
    } catch {
      // ignore
    }
  };
  window.addEventListener('resize', onResize);

  return {
    provider: 'here',
    setView,
    setMarkers,
    setCircles,
    setRectangles,
    setPolylines,
    setOnClick,
    destroy: () => {
      try {
        window.removeEventListener('resize', onResize);
      } catch {
        // ignore
      }
      try {
        if (tapHandler) map.removeEventListener('tap', tapHandler);
      } catch {
        // ignore
      }
      try {
        map.dispose();
      } catch {
        // ignore
      }
    },
  };
}

async function createThunderforestAdapter(
  container: HTMLDivElement,
  cfg: MapsConfigV2,
  initial: { center: LatLng; zoom: number },
): Promise<MapAdapter> {
  const L = await loadLeaflet();
  if (!L?.map) throw new Error('leaflet_missing');

  const apiKey = String((cfg.config as any).apiKey ?? '');
  if (!apiKey) throw new Error('thunderforest_api_key_missing');

  const style = String((cfg.config as any).style ?? 'atlas');

  const map = L.map(container, {
    center: [initial.center.lat, initial.center.lng],
    zoom: initial.zoom,
    zoomControl: true,
    attributionControl: true,
  });

  const tileUrl = `https://{s}.tile.thunderforest.com/${encodeURIComponent(style)}/{z}/{x}/{y}.png?apikey=${encodeURIComponent(apiKey)}`;
  const attribution =
    'Maps © <a href="https://www.thunderforest.com/">Thunderforest</a>, Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  L.tileLayer(tileUrl, {
    maxZoom: 22,
    subdomains: 'abc',
    attribution,
  }).addTo(map);

  const markersById = new Map<string, any>();
  const circlesById = new Map<string, any>();
  const rectanglesById = new Map<string, any>();
  const polylinesById = new Map<string, any>();
  let clickHandler: any | null = null;

  const setOnClick = (handler?: ((pos: LatLng) => void) | null) => {
    if (clickHandler) {
      try {
        map.off('click', clickHandler);
      } catch {
        // ignore
      }
      clickHandler = null;
    }
    if (!handler) return;
    clickHandler = (evt: any) => {
      const ll = evt?.latlng;
      if (!ll) return;
      handler({ lat: ll.lat, lng: ll.lng });
    };
    map.on('click', clickHandler);
  };

  const setMarkers = (markers: MapMarker[]) => {
    const keep = new Set(markers.map((m) => m.id));
    for (const [id, marker] of markersById.entries()) {
      if (!keep.has(id)) {
        marker.remove();
        markersById.delete(id);
      }
    }

    for (const m of markers) {
      if (!isFiniteLatLng(m.position)) continue;
      const existing = markersById.get(m.id);
      if (existing) {
        existing.setLatLng([m.position.lat, m.position.lng]);
        continue;
      }
      const marker = L.marker([m.position.lat, m.position.lng], { title: m.title ?? '' });
      marker.addTo(map);
      markersById.set(m.id, marker);
    }
  };

  const setCircles = (circles: MapCircle[]) => {
    const keep = new Set(circles.map((c) => c.id));
    for (const [id, circle] of circlesById.entries()) {
      if (!keep.has(id)) {
        circle.remove();
        circlesById.delete(id);
      }
    }

    for (const c of circles) {
      if (!isFiniteLatLng(c.center)) continue;
      const existing = circlesById.get(c.id);
      if (existing) {
        existing.setLatLng([c.center.lat, c.center.lng]);
        existing.setRadius(c.radiusMeters);
        continue;
      }
      const circle = L.circle([c.center.lat, c.center.lng], { radius: c.radiusMeters });
      circle.addTo(map);
      circlesById.set(c.id, circle);
    }
  };

  const setRectangles = (rectangles: MapRectangle[]) => {
    const keep = new Set(rectangles.map((r) => r.id));
    for (const [id, rect] of rectanglesById.entries()) {
      if (!keep.has(id)) {
        rect.remove();
        rectanglesById.delete(id);
      }
    }

    for (const r of rectangles) {
      const b = r.bounds;
      if (!Number.isFinite(b.north) || !Number.isFinite(b.south) || !Number.isFinite(b.east) || !Number.isFinite(b.west)) continue;
      const bounds = [
        [b.south, b.west],
        [b.north, b.east],
      ];
      const existing = rectanglesById.get(r.id);
      if (existing) {
        existing.setBounds(bounds);
        continue;
      }
      const rect = L.rectangle(bounds as any);
      rect.addTo(map);
      rectanglesById.set(r.id, rect);
    }
  };

  const setPolylines = (polylines: MapPolyline[]) => {
    const keep = new Set(polylines.map((p) => p.id));
    for (const [id, pl] of polylinesById.entries()) {
      if (!keep.has(id)) {
        pl.remove();
        polylinesById.delete(id);
      }
    }

    for (const p of polylines) {
      const latlngs = p.path.filter(isFiniteLatLng).map((pt) => [pt.lat, pt.lng]);
      const existing = polylinesById.get(p.id);
      if (existing) {
        existing.setLatLngs(latlngs);
        continue;
      }
      const pl = L.polyline(latlngs as any);
      pl.addTo(map);
      polylinesById.set(p.id, pl);
    }
  };

  const setView = (center: LatLng, zoom: number) => {
    if (!isFiniteLatLng(center)) return;
    map.setView([center.lat, center.lng], clampZoom(zoom));
  };

  return {
    provider: 'thunderforest',
    setView,
    setMarkers,
    setCircles,
    setRectangles,
    setPolylines,
    setOnClick,
    destroy: () => {
      try {
        if (clickHandler) map.off('click', clickHandler);
      } catch {
        // ignore
      }
      try {
        map.remove();
      } catch {
        // ignore
      }
    },
  };
}

async function initAdapter(args: {
  container: HTMLDivElement;
  supportedProviders: MapsProvider[];
  initialCenter: LatLng;
  initialZoom: number;
  markers: MapMarker[];
  circles: MapCircle[];
  rectangles: MapRectangle[];
  polylines: MapPolyline[];
  onClick?: ((pos: LatLng) => void) | null;
  renderSessionId: string;
}): Promise<MapAdapter> {
  const { container, supportedProviders, renderSessionId } = args;
  const exclude: MapsProvider[] = [];

  // Try providers in DB priority order, with runtime fallback on failure.
  for (let i = 0; i < Math.max(1, supportedProviders.length); i += 1) {
    const attemptNumber = i + 1;
    const cfg = await fetchMapsConfigV2({
      capability: 'render',
      supported: supportedProviders,
      exclude,
      request_id: renderSessionId,
    });
    const provider = cfg.provider;
    exclude.push(provider);
    const triedProviders = exclude.slice();

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      let adapter: MapAdapter;

      if (provider === 'google') {
        await loadGoogleMapsWithConfig(cfg, ['places']);
        adapter = createGoogleAdapter(container, cfg, { center: args.initialCenter, zoom: args.initialZoom });
      } else if (provider === 'mapbox') {
        adapter = await createMapboxAdapter(container, cfg, { center: args.initialCenter, zoom: args.initialZoom });
      } else if (provider === 'here') {
        adapter = await createHereAdapter(container, cfg, { center: args.initialCenter, zoom: args.initialZoom });
      } else if (provider === 'thunderforest') {
        adapter = await createThunderforestAdapter(container, cfg, { center: args.initialCenter, zoom: args.initialZoom });
      } else {
        throw new Error(`renderer_not_supported_${provider}`);
      }

      adapter.setMarkers(args.markers);
      adapter.setCircles(args.circles);
      adapter.setRectangles(args.rectangles);
      adapter.setPolylines(args.polylines);
      adapter.setOnClick(args.onClick ?? null);

      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const latencyMs = Math.max(0, Math.round(t1 - t0));
      void logMapsUsage('render', 1, provider, {
        event: 'render_success',
        request_id: renderSessionId,
        telemetry_token: cfg.telemetry_token,
        attempt_number: attemptNumber,
        tried_providers: triedProviders,
        latency_ms: latencyMs,
      });

      return adapter;
    } catch (e) {
      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const latencyMs = Math.max(0, Math.round(t1 - t0));
      const errorDetail = e instanceof Error ? e.message : String(e);

      void logMapsUsage('render', 1, provider, {
        event: 'render_failure',
        request_id: renderSessionId,
        telemetry_token: cfg.telemetry_token,
        attempt_number: attemptNumber,
        tried_providers: triedProviders,
        latency_ms: latencyMs,
        error_detail: errorDetail,
      });

      console.warn('Map renderer init failed; falling back', { provider, error: e });
      continue;
    }
  }

  throw new Error('no_render_provider_available');
}


export function MapView({
  center,
  zoom = 12,
  markers = [],
  circles = [],
  rectangles = [],
  polylines = [],
  onMapClick,
  className,
  supportedRenderProviders,
  onProviderChange,
}: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const adapterRef = React.useRef<MapAdapter | null>(null);
  const [activeProvider, setActiveProvider] = React.useState<MapsProvider | null>(null);
  const [failed, setFailed] = React.useState(false);

  const supported = (supportedRenderProviders?.length
    ? supportedRenderProviders
    : DEFAULT_SUPPORTED_RENDER_PROVIDERS
  ).filter((p) => ['google', 'mapbox', 'here', 'thunderforest'].includes(p)) as MapsProvider[];

  // Initialize the adapter once.
  React.useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const renderSessionId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        assertContainer(containerRef.current);
        const adapter = await initAdapter({
          container: containerRef.current,
          supportedProviders: supported,
          initialCenter: center,
          initialZoom: clampZoom(zoom),
          markers,
          circles,
          rectangles,
          polylines,
          onClick: onMapClick ?? null,
          renderSessionId,
        });
        if (!mounted) {
          adapter.destroy();
          return;
        }
        adapterRef.current = adapter;
        setActiveProvider(adapter.provider);
        setFailed(false);
      } catch {
        if (!mounted) return;
        setFailed(true);
        setActiveProvider(null);
      }
    })();

    return () => {
      mounted = false;
      const a = adapterRef.current;
      adapterRef.current = null;
      if (a) a.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync view.
  React.useEffect(() => {
    adapterRef.current?.setView(center, clampZoom(zoom));
  }, [center, zoom]);

  // Sync markers.
  React.useEffect(() => {
    adapterRef.current?.setMarkers(markers);
  }, [markers]);

  // Sync circles.
  React.useEffect(() => {
    adapterRef.current?.setCircles(circles);
  }, [circles]);

  // Sync rectangles.
  React.useEffect(() => {
    adapterRef.current?.setRectangles(rectangles);
  }, [rectangles]);

  // Sync polylines.
  React.useEffect(() => {
    adapterRef.current?.setPolylines(polylines);
  }, [polylines]);

  // Sync clicks.
  React.useEffect(() => {
    adapterRef.current?.setOnClick(onMapClick ?? null);
  }, [onMapClick]);

  // Inform parent which renderer is currently active.
  React.useEffect(() => {
    if (activeProvider && onProviderChange) onProviderChange(activeProvider);
  }, [activeProvider, onProviderChange]);

  return (
    <div className={className ?? 'w-full h-full'} style={{ position: 'relative' }}>
      <div ref={containerRef} className="w-full h-full" />
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70">
          <div className="text-sm text-gray-700">Map failed to load</div>
        </div>
      ) : null}
      {activeProvider ? (
        <div className="absolute bottom-2 right-2 text-[11px] px-2 py-1 rounded-md bg-white/80 border border-gray-200 text-gray-700">
          {activeProvider.toUpperCase()}
        </div>
      ) : null}
    </div>
  );
}
