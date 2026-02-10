import { supabase } from './supabaseClient';

/**
 * Returns true if the current authenticated user is an admin.
 *
 * Best practice:
 * - Do NOT rely on a writable flag in profiles (risk: self-promotion).
 * - Use a SECURITY DEFINER RPC in Postgres: public.is_admin()
 */
export async function getIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) throw error;
  // Supabase can return boolean directly or wrapped depending on configuration
  return !!(Array.isArray(data) ? data[0] : data);
}
