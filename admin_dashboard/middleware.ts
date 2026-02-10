import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/rides',
  '/drivers',
  '/users',
  '/fraud',
  '/incidents',
  '/ops',
  '/observability',
  '/runbooks',
  '/payments',
  '/withdrawals',
  '/payouts',
  '/service-areas',
  '/pricing',
  '/promotions',
  '/support',
  '/orders',
  '/merchants',
  '/maps',
  '/agents',
  '/settings',
  '/audit',
  '/admin-access',
];

function originFromEnv(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function generateNonce(): string {
  // Edge-safe nonce generation (Web Crypto + base64).
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';

  const supabaseOrigin = originFromEnv(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? '';
  const supabaseWss = supabaseOrigin ? supabaseOrigin.replace(/^https:/, 'wss:') : '';

  const connectSrc = ["'self'", supabaseOrigin, supabaseWss, 'https:', 'wss:']
    .filter(Boolean)
    .join(' ');

  const imgSrc = ["'self'", 'blob:', 'data:', supabaseOrigin, 'https:']
    .filter(Boolean)
    .join(' ');

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''};
    style-src 'self' 'nonce-${nonce}';
    img-src ${imgSrc};
    font-src 'self' data: https:;
    connect-src ${connectSrc};
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `;

  return cspHeader.replace(/\s{2,}/g, ' ').trim();
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Per-request nonce-based CSP.
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('Content-Security-Policy', csp);

  // Supabase session handling.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users away from protected pages.
  if (!user && isProtected) {
    const redirect = NextResponse.redirect(new URL('/login', request.url));
    redirect.headers.set('Content-Security-Policy', csp);
    return redirect;
  }

  // Redirect authenticated users away from /login.
  if (user && pathname === '/login') {
    const redirect = NextResponse.redirect(new URL('/dashboard', request.url));
    redirect.headers.set('Content-Security-Policy', csp);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    {
      // Match all request paths except for:
      // - api (route handlers)
      // - _next/static, _next/image (Next internals)
      // - favicon.ico
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      // Skip prefetches to reduce overhead.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
