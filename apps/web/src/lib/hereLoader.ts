// HERE Maps API for JavaScript (v3.1) loader.
//
// Best practices:
//  - Lazy-load scripts only when HERE is selected.
//  - Load UI CSS as well (for default controls).

let _herePromise: Promise<any> | null = null;

const HERE_VERSION = '3.1';
const HERE_BASE = `https://js.api.here.com/v3/${HERE_VERSION}`;

function loadScript(src: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-here='${key}']`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
      // If it already loaded before, resolve immediately.
      if ((existing as any).dataset?.loaded === 'true') resolve();
      return;
    }

    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.dataset.here = key;
    s.addEventListener('load', () => {
      s.dataset.loaded = 'true';
      resolve();
    });
    s.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(s);
  });
}

function ensureCss(href: string, key: string) {
  const existing = document.querySelector<HTMLLinkElement>(`link[data-here='${key}']`);
  if (existing) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  l.dataset.here = key;
  document.head.appendChild(l);
}

export async function loadHereMaps(): Promise<any> {
  if (typeof window === 'undefined') return null;
  if ((window as any).H) return (window as any).H;
  if (_herePromise) return _herePromise;

  _herePromise = (async () => {
    ensureCss(`${HERE_BASE}/mapsjs-ui.css`, 'ui-css');

    // Core + services + events + UI.
    // NOTE: scripts must be loaded in order.
    await loadScript(`${HERE_BASE}/mapsjs-core.js`, 'core');
    await loadScript(`${HERE_BASE}/mapsjs-service.js`, 'service');
    await loadScript(`${HERE_BASE}/mapsjs-mapevents.js`, 'mapevents');
    await loadScript(`${HERE_BASE}/mapsjs-ui.js`, 'ui');

    const H = (window as any).H;
    if (!H) throw new Error('HERE Maps loaded but window.H is missing');
    return H;
  })();

  return _herePromise;
}

export function hasHereLoaded(): boolean {
  return Boolean((window as any).H);
}
