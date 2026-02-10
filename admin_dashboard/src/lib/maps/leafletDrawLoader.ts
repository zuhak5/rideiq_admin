// Leaflet.draw loader (CDN).
//
// NOTE: Leaflet.draw does not publish official SRI hashes in their docs.
// We pin an explicit version to reduce supply-chain risk.

import { loadLeaflet } from './leafletLoader';

let _promise: Promise<any> | null = null;

const DRAW_VERSION = '1.0.4';
const DRAW_CSS = `https://cdn.jsdelivr.net/npm/leaflet-draw@${DRAW_VERSION}/dist/leaflet.draw.css`;
const DRAW_JS = `https://cdn.jsdelivr.net/npm/leaflet-draw@${DRAW_VERSION}/dist/leaflet.draw.js`;

function ensureCss(): void {
  const existing = document.querySelector<HTMLLinkElement>("link[data-leaflet-draw='css']");
  if (existing) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = DRAW_CSS;
  l.crossOrigin = '';
  l.dataset.leafletDraw = 'css';
  document.head.appendChild(l);
}

function ensureScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-leaflet-draw='js']");
    if (existing) {
      if ((window as any).L?.Control?.Draw) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Leaflet.draw')));
      if ((existing as any).dataset?.loaded === 'true') resolve();
      return;
    }

    const s = document.createElement('script');
    s.src = DRAW_JS;
    s.async = true;
    s.defer = true;
    s.crossOrigin = '';
    s.dataset.leafletDraw = 'js';
    s.addEventListener('load', () => {
      s.dataset.loaded = 'true';
      resolve();
    });
    s.addEventListener('error', () => reject(new Error('Failed to load Leaflet.draw')));
    document.head.appendChild(s);
  });
}

export async function loadLeafletDraw(): Promise<any> {
  if (typeof window === 'undefined') return null;
  const L = await loadLeaflet();
  if ((window as any).L?.Control?.Draw) return L;
  if (_promise) return _promise;

  _promise = (async () => {
    ensureCss();
    await ensureScript();
    if (!(window as any).L?.Control?.Draw) {
      throw new Error('Leaflet.draw loaded but L.Control.Draw is missing');
    }
    return (window as any).L;
  })();

  return _promise;
}
