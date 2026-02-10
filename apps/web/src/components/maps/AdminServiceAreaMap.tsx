import * as React from 'react';
import { GoogleMapView } from './GoogleMapView';

export type BBox = { minLat: number; minLng: number; maxLat: number; maxLng: number };

type Props = {
  initialBBox: BBox;
  onBBoxChange: (bbox: BBox) => void;
};

function toBoundsLiteral(bbox: BBox): google.maps.LatLngBoundsLiteral {
  return {
    south: bbox.minLat,
    west: bbox.minLng,
    north: bbox.maxLat,
    east: bbox.maxLng,
  };
}

function fromBounds(bounds: google.maps.LatLngBounds): BBox {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return { minLat: sw.lat(), minLng: sw.lng(), maxLat: ne.lat(), maxLng: ne.lng() };
}

export function AdminServiceAreaMap({ initialBBox, onBBoxChange }: Props) {
  const rectRef = React.useRef<google.maps.Rectangle | null>(null);
  const mapRef = React.useRef<google.maps.Map | null>(null);

  React.useEffect(() => {
    const rect = rectRef.current;
    if (!rect) return;
    rect.setBounds(toBoundsLiteral(initialBBox));
  }, [initialBBox]);

  const handleMapReady = React.useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      const bounds = toBoundsLiteral(initialBBox);
      if (!rectRef.current) {
        rectRef.current = new google.maps.Rectangle({
          map,
          bounds,
          editable: true,
          draggable: true,
          strokeOpacity: 0.6,
          strokeWeight: 2,
          strokeColor: '#2563eb',
          fillOpacity: 0.08,
          fillColor: '#3b82f6',
        });

        rectRef.current.addListener('bounds_changed', () => {
          const rectBounds = rectRef.current?.getBounds();
          if (!rectBounds) return;
          onBBoxChange(fromBounds(rectBounds));
        });
      } else {
        rectRef.current.setMap(map);
        rectRef.current.setEditable(true);
        rectRef.current.setBounds(bounds);
      }
      map.fitBounds(bounds);
    },
    [initialBBox, onBBoxChange],
  );

  return <GoogleMapView className="h-[320px] w-full" center={{ lat: initialBBox.minLat, lng: initialBBox.minLng }} zoom={12} onMapReady={handleMapReady} />;
}
