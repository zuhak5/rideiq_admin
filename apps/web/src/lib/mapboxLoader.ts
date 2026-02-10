// Mapbox GL JS loader utilities.
//
// Best practices:
//  - Lazy-load the library to avoid inflating initial bundle.
//  - Enable RTL text shaping via Mapbox's RTL plugin in lazy mode.
//    (Loads only when Arabic/Hebrew is encountered.)

type MapboxGLModule = typeof import('mapbox-gl');
type MapboxGL = MapboxGLModule['default'];

let mapboxPromise: Promise<MapboxGL> | null = null;
let rtlConfigured = false;

export async function loadMapboxGL(): Promise<MapboxGL> {
  if (!mapboxPromise) {
    mapboxPromise = import('mapbox-gl').then((mod) => mod.default);
  }
  const mapboxgl = await mapboxPromise;
  configureRtlTextPlugin(mapboxgl);
  return mapboxgl;
}

function configureRtlTextPlugin(mapboxgl: any) {
  if (rtlConfigured) return;
  rtlConfigured = true;

  try {
    // Per Mapbox GL JS docs, use the rtl-text plugin for Arabic/Hebrew.
    // The third param (`true`) enables lazy loading.
    mapboxgl.setRTLTextPlugin(
      'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.2.3/mapbox-gl-rtl-text.js',
      null,
      true,
    );
  } catch {
    // Best-effort: if plugin setup fails, map still renders (labels may be degraded).
  }
}

export function applyArabicLabelLanguage(map: any) {
  // For Mapbox Streets styles, many label layers use a `name` field.
  // We attempt to override label layers to prefer Arabic (name_ar) with a safe fallback.
  try {
    const style = map.getStyle?.();
    const layers = style?.layers ?? [];
    for (const layer of layers) {
      if (!layer || layer.type !== 'symbol') continue;
      const layout = layer.layout;
      if (!layout || !('text-field' in layout)) continue;

      const tf = layout['text-field'];
      // Only adjust layers that look like they are driven by feature names.
      const s = JSON.stringify(tf);
      if (!s.includes('name')) continue;

      map.setLayoutProperty(layer.id, 'text-field', [
        'coalesce',
        ['get', 'name_ar'],
        ['get', 'name:ar'],
        ['get', 'name'],
        ['get', 'name_en'],
      ]);
    }
  } catch {
    // ignore
  }
}
