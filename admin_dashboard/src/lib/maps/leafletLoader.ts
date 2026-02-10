// Leaflet loader (CDN) with SRI hashes.
//
// We use the official Leaflet CDN example (unpkg + integrity) to avoid adding a
// build-time dependency and keep the initial bundle small.

let _leafletPromise: Promise<any> | null = null;

const LEAFLET_VERSION = '1.9.4';
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;

// Hashes from https://leafletjs.com/download.html
const LEAFLET_CSS_INTEGRITY = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
const LEAFLET_JS_INTEGRITY = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';

function ensureCss(): void {
  const existing = document.querySelector<HTMLLinkElement>("link[data-leaflet='css']");
  if (existing) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = LEAFLET_CSS;
  l.integrity = LEAFLET_CSS_INTEGRITY;
  l.crossOrigin = '';
  l.dataset.leaflet = 'css';
  document.head.appendChild(l);
}

function ensureScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-leaflet='js']");
    if (existing) {
      if ((window as any).L) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Leaflet')));
      if ((existing as any).dataset?.loaded === 'true') resolve();
      return;
    }

    const s = document.createElement('script');
    s.src = LEAFLET_JS;
    s.async = true;
    s.defer = true;
    s.integrity = LEAFLET_JS_INTEGRITY;
    s.crossOrigin = '';
    s.dataset.leaflet = 'js';
    s.addEventListener('load', () => {
      s.dataset.loaded = 'true';
      resolve();
    });
    s.addEventListener('error', () => reject(new Error('Failed to load Leaflet')));
    document.head.appendChild(s);
  });
}

export async function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return null;
  if ((window as any).L) return (window as any).L;
  if (_leafletPromise) return _leafletPromise;

  _leafletPromise = (async () => {
    ensureCss();
    await ensureScript();
    const L = (window as any).L;
    if (!L) throw new Error('Leaflet loaded but window.L is missing');
    return L;
  })();

  return _leafletPromise;
}

export function hasLeafletLoaded(): boolean {
  return Boolean((window as any).L);
}
