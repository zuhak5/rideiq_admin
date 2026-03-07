'use client';

type GoogleRendererConfig = {
  provider: 'google';
  config: Record<string, unknown>;
};

let loaderPromise: Promise<void> | null = null;
const requestedLibraries = new Set<string>();

function ensureGoogleBootstrap(args: {
  apiKey: string;
  language: string;
  region: string;
}): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).google?.maps?.importLibrary) return Promise.resolve();
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-google-maps='true']",
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Maps script')),
        { once: true },
      );
      if ((window as any).google?.maps?.importLibrary) resolve();
      return;
    }

    const callbackName = '__rideiqAdminGoogleMapsReady';
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      resolve();
    };

    const params = new URLSearchParams({
      key: args.apiKey,
      language: args.language,
      region: args.region,
      v: 'weekly',
      loading: 'async',
      callback: callbackName,
    });

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = 'true';
    script.addEventListener(
      'error',
      () => {
        delete (window as any)[callbackName];
        reject(new Error('Failed to load Google Maps script'));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return loaderPromise;
}

async function importRequestedLibraries(libraries: string[]): Promise<void> {
  const googleMaps = (window as any).google?.maps;
  if (!googleMaps?.importLibrary) {
    throw new Error('Google Maps loaded but importLibrary is unavailable');
  }

  for (const library of libraries) {
    if (!library || requestedLibraries.has(library)) continue;
    await googleMaps.importLibrary(library);
    requestedLibraries.add(library);
  }
}

export async function loadGoogleMapsWithConfig(
  cfg: GoogleRendererConfig,
  libraries: string[] = [],
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (cfg.provider !== 'google') {
    throw new Error(`Active maps provider is ${cfg.provider}; Google renderer is not loaded`);
  }

  const apiKey = String(cfg.config.apiKey ?? '').trim();
  if (!apiKey) throw new Error('missing_google_api_key');

  const language = String(cfg.config.language ?? 'ar').trim() || 'ar';
  const region = String(cfg.config.region ?? 'IQ').trim() || 'IQ';

  await ensureGoogleBootstrap({ apiKey, language, region });
  await importRequestedLibraries(libraries);

  if (!(window as any).google?.maps) {
    throw new Error('Google Maps loaded but window.google.maps is missing');
  }
}
