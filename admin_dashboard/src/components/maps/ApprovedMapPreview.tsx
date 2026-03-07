'use client';

import React from 'react';
import type { MapsRendererConfig } from '@/lib/admin/maps';
import {
  MapboxMapPreview,
  type MapboxPreviewMarker,
  type PreviewBBox,
} from './MapboxMapPreview';
import { GoogleMapPreview } from './GoogleMapPreview';
import { HereMapPreview } from './HereMapPreview';

type LatLng = { lat: number; lng: number };

export function ApprovedMapPreview(props: {
  rendererConfig: MapsRendererConfig;
  center: LatLng;
  zoom?: number;
  className?: string;
  geojson?: any;
  markers?: MapboxPreviewMarker[];
  fitGeojson?: boolean;
  onBoundsChange?: (bbox: PreviewBBox | null) => void;
  onMapClick?: (point: LatLng) => void;
}): React.JSX.Element {
  const { rendererConfig } = props;

  if (rendererConfig.provider === 'google') {
    return (
      <GoogleMapPreview
        {...props}
        rendererConfig={rendererConfig as MapsRendererConfig & { provider: 'google' }}
      />
    );
  }

  if (rendererConfig.provider === 'here') {
    return (
      <HereMapPreview
        {...props}
        rendererConfig={rendererConfig as MapsRendererConfig & { provider: 'here' }}
      />
    );
  }

  return (
    <MapboxMapPreview
      {...props}
      rendererConfig={rendererConfig as MapsRendererConfig & { provider: 'mapbox' }}
    />
  );
}

export type { MapboxPreviewMarker as ApprovedMapPreviewMarker, PreviewBBox };
