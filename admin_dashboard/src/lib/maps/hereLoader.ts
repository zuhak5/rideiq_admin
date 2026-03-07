'use client';

let herePromise: Promise<any> | null = null;

const HERE_VERSION = '3.1';
const HERE_BASE = `https://js.api.here.com/v3/${HERE_VERSION}`;

function loadScript(src: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-here='${key}']`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener(
        'error',
        () => reject(new Error(`Failed to load ${src}`)),
      );
      if ((existing as any).dataset?.loaded === 'true') resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.here = key;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(script);
  });
}

function ensureCss(href: string, key: string) {
  const existing = document.querySelector<HTMLLinkElement>(`link[data-here='${key}']`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.here = key;
  document.head.appendChild(link);
}

export async function loadHereMaps(): Promise<any> {
  if (typeof window === 'undefined') return null;
  if ((window as any).H) return (window as any).H;
  if (herePromise) return herePromise;

  herePromise = (async () => {
    ensureCss(`${HERE_BASE}/mapsjs-ui.css`, 'ui-css');
    await loadScript(`${HERE_BASE}/mapsjs-core.js`, 'core');
    await loadScript(`${HERE_BASE}/mapsjs-service.js`, 'service');
    await loadScript(`${HERE_BASE}/mapsjs-mapevents.js`, 'mapevents');
    await loadScript(`${HERE_BASE}/mapsjs-ui.js`, 'ui');

    const H = (window as any).H;
    if (!H) throw new Error('HERE Maps loaded but window.H is missing');
    return H;
  })();

  return herePromise;
}
