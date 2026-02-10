import * as React from 'react';
import { GoogleMapView } from './GoogleMapView';

type Props = {
  featureCollection: any;
};

function iterCoords(geo: any, cb: (lat: number, lng: number) => void) {
  if (!geo) return;
  const t = geo.type;
  if (t === 'Polygon') {
    for (const ring of geo.coordinates || []) {
      for (const [lng, lat] of ring || []) cb(lat, lng);
    }
    return;
  }
  if (t === 'MultiPolygon') {
    for (const poly of geo.coordinates || []) {
      for (const ring of poly || []) {
        for (const [lng, lat] of ring || []) cb(lat, lng);
      }
    }
    return;
  }
  if (t === 'GeometryCollection') {
    for (const g of geo.geometries || []) iterCoords(g, cb);
  }
}

export function AdminServiceAreaGeoJsonMap({ featureCollection }: Props) {
  const mapRef = React.useRef<google.maps.Map | null>(null);

  const handleMapReady = React.useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;

    // Clear old features.
    map.data.forEach((f) => map.data.remove(f));
    try {
      map.data.addGeoJson(featureCollection as any);
      map.data.setStyle({
        strokeColor: '#2563eb',
        strokeOpacity: 0.7,
        strokeWeight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
      } as any);

      const bounds = new google.maps.LatLngBounds();
      for (const f of featureCollection.features) {
        iterCoords(f.geometry as any, (lat, lng) => bounds.extend({ lat, lng }));
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds);
    } catch {
      // Ignore; validation happens upstream.
    }
  }, [featureCollection]);

  // A neutral initial center; we fit bounds once loaded.
  return <GoogleMapView className="h-[320px] w-full" center={{ lat: 33.3152, lng: 44.3661 }} zoom={11} onMapReady={handleMapReady} />;
}
