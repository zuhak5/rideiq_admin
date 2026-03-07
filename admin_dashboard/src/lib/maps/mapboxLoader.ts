'use client';

let mapboxPromise: Promise<any> | null = null;
let drawPromise: Promise<any> | null = null;

export async function loadMapboxGL(): Promise<any> {
  if (typeof window === 'undefined') return null;
  if (!mapboxPromise) {
    mapboxPromise = import('mapbox-gl').then((module) => module.default ?? module);
  }
  return mapboxPromise;
}

export async function loadMapboxDraw(): Promise<any> {
  if (typeof window === 'undefined') return null;
  if (!drawPromise) {
    drawPromise = import('@mapbox/mapbox-gl-draw').then((module) => module.default ?? module);
  }
  return drawPromise;
}
