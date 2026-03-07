let _leafletPromise: Promise<any> | null = null;

export async function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return null;
  if (_leafletPromise) return _leafletPromise;

  _leafletPromise = import('leaflet').then((module) => module.default ?? module);

  return _leafletPromise;
}

export function hasLeafletLoaded(): boolean {
  return _leafletPromise !== null;
}
