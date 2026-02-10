import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.ADMIN_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Prevent Next/Turbopack from inferring the workspace root based on unrelated lockfiles
// outside this repo (a common monorepo footgun on developer machines).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    root: repoRoot,
  },
  ...(allowedOrigins.length
    ? {
        // Server Actions are invoked via POST and rely on Origin checks.
        // If your deployment uses a reverse proxy or alternate domain, set:
        // ADMIN_ALLOWED_ORIGINS="admin.example.com,*.example.com"
        experimental: {
          serverActions: {
            allowedOrigins,
          },
        },
      }
    : {}),
  async headers() {
    // NOTE: CSP is set in middleware to support per-request nonces.
    // Keep other security headers here so they also apply to static assets.
    const securityHeaders: { key: string; value: string }[] = [
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ];

    if (isProd) {
      // Only set HSTS for production HTTPS deployments.
      securityHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains; preload',
      });
    }

    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
