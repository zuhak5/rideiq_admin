import { supabase } from './supabaseClient';
import type { Database } from './database.types';

export type ActiveRole = Database['public']['Enums']['user_role'];

export type MyProfileBasics = {
  id: string;
  active_role: ActiveRole;
  role_onboarding_completed: boolean;
  locale: string;
};

export type MyAppContext = {
  user_id: string;
  active_role: ActiveRole;
  role_onboarding_completed: boolean;
  locale: string;
  has_driver: boolean;
  driver_vehicle_type: string | null;
  has_merchant: boolean;
  merchant_id: string | null;
  merchant_status: Database['public']['Enums']['merchant_status'] | null;
};

export async function getMyAppContext(): Promise<MyAppContext> {
  const { data, error } = await supabase.rpc('get_my_app_context' as any);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No context returned');
  return {
    user_id: row.user_id,
    active_role: (row.active_role ?? 'rider') as ActiveRole,
    role_onboarding_completed: Boolean(row.role_onboarding_completed),
    locale: (row.locale ?? 'en') as string,
    has_driver: Boolean(row.has_driver),
    driver_vehicle_type: row.driver_vehicle_type ?? null,
    has_merchant: Boolean(row.has_merchant),
    merchant_id: row.merchant_id ?? null,
    merchant_status: row.merchant_status ?? null,
  };
}


export async function getMyProfileBasics(): Promise<MyProfileBasics> {
  const { data: sess, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) throw sessErr;
  const uid = sess.session?.user.id;
  if (!uid) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('profiles')
    .select('id, active_role, role_onboarding_completed, locale')
    .eq('id', uid)
    .single();

  if (error) throw error;

  // Defensive defaults for older rows
  return {
    id: data.id,
    active_role: (data.active_role ?? 'rider') as ActiveRole,
    role_onboarding_completed: Boolean((data as any).role_onboarding_completed),
    locale: (data.locale ?? 'en') as string,
  };
}

export async function setActiveRole(role: ActiveRole) {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) throw new Error('Not signed in');

  // Use the server-side RPC to enforce eligibility (driver/merchant must be setup).
  const { error } = await supabase.rpc('set_my_active_role' as any, { p_role: role });
  if (error) throw error;
}

export async function setRoleOnboardingCompleted(completed: boolean) {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) throw new Error('Not signed in');

  const { error } = await supabase.from('profiles').update({ role_onboarding_completed: completed }).eq('id', uid);
  if (error) throw error;
}

export async function getRoleEligibility(uid: string) {
  const [{ data: driver }, { data: merchant }] = await Promise.all([
    supabase.from('drivers').select('id').eq('id', uid).maybeSingle(),
    supabase.from('merchants').select('id').eq('owner_profile_id', uid).maybeSingle(),
  ]);

  return {
    hasDriver: Boolean(driver?.id),
    hasMerchant: Boolean(merchant?.id),
  };
}
