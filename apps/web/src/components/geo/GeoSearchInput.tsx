import React from 'react';
import type { MapsProvider } from '../../lib/mapsConfig';
import type { GeoSearchResult } from '../../lib/geo';
import { geoGeocode } from '../../lib/geo';

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = React.useState<T>(value);

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}

type Props = {
  label: string;
  value: string;
  placeholder?: string;
  renderer?: MapsProvider | null;
  onChange: (value: string) => void;
  onSelect: (result: GeoSearchResult) => void;
  disabled?: boolean;
};

export function GeoSearchInput({
  label,
  value,
  placeholder,
  renderer,
  onChange,
  onSelect,
  disabled,
}: Props) {
  const debounced = useDebouncedValue(value, 300);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [results, setResults] = React.useState<GeoSearchResult[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const reqId = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      const q = debounced?.trim();
      if (!q || q.length < 2) {
        setResults([]);
        setErr(null);
        setLoading(false);
        return;
      }

      const current = ++reqId.current;
      setLoading(true);
      setErr(null);

      try {
        const out = await geoGeocode(q, { limit: 6, renderer: renderer ?? null, language: 'ar', region: 'IQ' });
        if (cancelled || current !== reqId.current) return;
        setResults(out);
      } catch (e) {
        if (cancelled || current !== reqId.current) return;
        setResults([]);
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled && current === reqId.current) {
          setLoading(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [debounced, renderer]);

  const onPick = (r: GeoSearchResult) => {
    onSelect(r);
    setOpen(false);
  };

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input
        disabled={disabled}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so click on dropdown registers.
          window.setTimeout(() => setOpen(false), 150);
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        dir="rtl"
        inputMode="search"
      />
      <div className="absolute top-2 left-2 text-[11px] text-gray-500">
        {loading ? '...' : ''}
      </div>

      {open && (results.length > 0 || err) ? (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-64 overflow-auto">
          {err ? (
            <div className="px-3 py-2 text-xs text-red-600" dir="ltr">
              {err}
            </div>
          ) : null}

          {results.map((r) => (
            <button
              key={`${r.provider_place_id ?? ''}:${r.label}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(r)}
              className="w-full text-right px-3 py-2 text-sm hover:bg-gray-50"
              dir="rtl"
            >
              <div className="text-gray-900">{r.label}</div>
              <div className="text-[11px] text-gray-500" dir="ltr">
                {r.location.lat.toFixed(5)}, {r.location.lng.toFixed(5)}
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
