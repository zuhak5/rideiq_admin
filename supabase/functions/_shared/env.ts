import { envTrim } from './config.ts';

export type AppEnv = 'production' | 'staging' | 'development' | 'test' | 'local' | 'unknown';

/**
 * Determine the current runtime environment.
 *
 * Sources (in priority order):
 * - APP_ENV (recommended)
 * - NODE_ENV
 * - SUPABASE_ENV (if set by hosting)
 */
export function getAppEnv(): AppEnv {
  const raw = (envTrim('APP_ENV') || envTrim('NODE_ENV') || envTrim('SUPABASE_ENV')).toLowerCase();
  if (!raw) return 'unknown';
  if (raw === 'prod' || raw === 'production') return 'production';
  if (raw === 'stage' || raw === 'staging') return 'staging';
  if (raw === 'dev' || raw === 'development') return 'development';
  if (raw === 'test' || raw === 'testing') return 'test';
  if (raw === 'local' || raw === 'localhost') return 'local';
  return 'unknown';
}

export function isProduction(): boolean {
  return getAppEnv() === 'production';
}
