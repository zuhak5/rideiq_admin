import { fetchMapsConfigV2, type MapsConfigV2 } from './mapsConfig';

// Re-export for backward compatibility with older imports.
export type { MapsProvider, MapsCapability, MapsConfigV2 } from './mapsConfig';

let _loaderPromise: Promise<void> | null = null;

function buildUrl(apiKey: string, libraries: string[], language: string, region: string) {
  const libs = Array.from(new Set(libraries.filter(Boolean))).join(',');
  const params = new URLSearchParams({
    key: apiKey,
    v: 'weekly',
    language,
    region,
  });
  if (libs) params.set('libraries', libs);
  return `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
}

export async function loadGoogleMaps(libraries: string[] = ['places']): Promise<void> {
  if (typeof window === 'undefined') return;
  if ((window as any).google?.maps) return;

  if (_loaderPromise) return _loaderPromise;

  _loaderPromise = (async () => {
    const cfg = await fetchMapsConfigV2({ capability: 'render', supported: ['google'] });

    if (cfg.provider !== 'google') {
      throw new Error(`Active maps provider is ${cfg.provider}; Google renderer is not loaded`);
    }

    const apiKey = cfg.config.apiKey as string | undefined;
    if (!apiKey) throw new Error('missing_google_api_key');

    const language = (cfg.config.language || 'ar') as string;
    const region = (cfg.config.region || 'IQ') as string;

    const url = buildUrl(apiKey, libraries, language, region);

    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[data-google-maps='true']`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed to load Google Maps script')));
        return;
      }

      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.defer = true;
      s.dataset.googleMaps = 'true';
      s.addEventListener('load', () => resolve());
      s.addEventListener('error', () => reject(new Error('Failed to load Google Maps script')));
      document.head.appendChild(s);
    });

    if (!(window as any).google?.maps) {
      throw new Error('Google Maps loaded but window.google.maps is missing');
    }
  })();

  return _loaderPromise;
}

export async function loadGoogleMapsWithConfig(cfg: MapsConfigV2, libraries: string[] = ['places']): Promise<void> {
  if (typeof window === 'undefined') return;
  if ((window as any).google?.maps) return;

  if (cfg.provider !== 'google') {
    throw new Error(`Active maps provider is ${cfg.provider}; Google renderer is not loaded`);
  }

  const apiKey = cfg.config.apiKey as string | undefined;
  if (!apiKey) throw new Error('missing_google_api_key');

  const language = (cfg.config.language || 'ar') as string;
  const region = (cfg.config.region || 'IQ') as string;

  const url = buildUrl(apiKey, libraries, language, region);

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-google-maps='true']`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Maps script')));
      return;
    }

    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.defer = true;
    s.dataset.googleMaps = 'true';
    s.addEventListener('load', () => resolve());
    s.addEventListener('error', () => reject(new Error('Failed to load Google Maps script')));
    document.head.appendChild(s);
  });

  if (!(window as any).google?.maps) {
    throw new Error('Google Maps loaded but window.google.maps is missing');
  }
}

export function hasGoogleMapsLoaded(): boolean {
  return Boolean((window as any).google?.maps);
}
