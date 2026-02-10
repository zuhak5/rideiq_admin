export function buildShareUrl(token: string): string {
  const t = String(token ?? '').trim();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // Prefer Vite base (set via VITE_BASE in CI) e.g. "/RideIQ/"
  let base = (import.meta as any)?.env?.BASE_URL as string | undefined;
  let prefix = '';

  if (base && base !== '/' && base.trim() !== '') {
    // drop trailing slash
    prefix = String(base).replace(/\/+$/, '');
  } else if (typeof window !== 'undefined') {
    // Fallback: infer GitHub Pages project base from current pathname, e.g. "/RideIQ/..."
    const seg = window.location.pathname.split('/').filter(Boolean)[0];
    if (seg && seg !== 'share') prefix = `/${seg}`;
  }

  return `${origin}${prefix}/share/${t}`;
}

export function buildTripShareMessage(url: string): string {
  return `RideIQ: Track my trip in real time: ${url}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
