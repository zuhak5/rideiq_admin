import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function normalizeBasePath(input?: string): string {
  // Vite's `base` must start and end with `/` for correct asset resolution.
  // For GitHub Pages project sites the base is typically `/<repo>/`.
  if (!input) return '/';
  let s = input.trim();
  if (!s) return '/';
  if (!s.startsWith('/')) s = `/${s}`;
  if (!s.endsWith('/')) s = `${s}/`;
  return s;
}

export default defineConfig(({ mode }) => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, '../..');
  const rootEnv = loadEnv(mode, repoRoot, '');
  const localEnv = loadEnv(mode, '.', '');
  const env = { ...rootEnv, ...localEnv };
  const base = normalizeBasePath(env.VITE_BASE);
  return {
    base,
    plugins: [react()],
    server: {
      port: 5173,
    },
    test: {
      environment: 'node',
    },
  };
});
