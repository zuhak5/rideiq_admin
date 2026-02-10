import * as React from 'react';
import { loadGoogleMaps } from '../../lib/googleMaps';

type Props = {
  className?: string;
  center: { lat: number; lng: number };
  zoom: number;
  onMapReady?: (map: google.maps.Map) => void;
};

type LoadState = 'loading' | 'ready' | 'unavailable' | 'error';

export function GoogleMapView({ className, center, zoom, onMapReady }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<google.maps.Map | null>(null);
  const [loadState, setLoadState] = React.useState<LoadState>('loading');

  React.useEffect(() => {
    let alive = true;

    const container = containerRef.current;
    if (!container) return undefined;
    if (mapRef.current) return undefined;

    setLoadState('loading');

    (async () => {
      try {
        await loadGoogleMaps([]); // No extra libraries required for current overlays.
        if (!alive) return;

        if (!window.google?.maps) {
          setLoadState('unavailable');
          return;
        }

        const mapInstance = new google.maps.Map(container, { center, zoom });
        mapRef.current = mapInstance;
        setLoadState('ready');
        onMapReady?.(mapInstance);
      } catch (err) {
        console.error('[GoogleMapView] failed to load Google Maps', err);
        if (!alive) return;
        // If the config endpoint is misconfigured, treat as unavailable; otherwise show generic error.
        setLoadState('unavailable');
      }
    })();

    return () => {
      alive = false;
    };
  }, [center, zoom, onMapReady]);

  return (
    <div className={className} style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {loadState !== 'ready' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.70)',
            fontSize: 13,
          }}
        >
          {loadState === 'loading' ? 'Loading map…' : 'Map unavailable'}
        </div>
      ) : null}
    </div>
  );
}
