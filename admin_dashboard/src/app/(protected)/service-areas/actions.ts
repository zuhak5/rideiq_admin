'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guards';
import { upsertServiceArea, deleteServiceArea } from '@/lib/admin/serviceAreas';

function toInt(v: FormDataEntryValue | null): number | null {
  if (typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNum(v: FormDataEntryValue | null): number | null {
  if (typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2).max(120),
  governorate: z.string().min(2).max(80),
  priority: z.number().int().min(-1000).max(1000),
  is_active: z.boolean(),
  pricing_config_id: z.string().uuid().optional().nullable(),
  min_base_fare_iqd: z.number().int().min(0).max(5_000_000).optional().nullable(),
  surge_multiplier: z.number().finite().min(1).max(20).optional().nullable(),
  surge_reason: z.string().max(200).optional().nullable(),
  match_radius_m: z.number().int().min(10).max(200_000).optional().nullable(),
  driver_loc_stale_after_seconds: z.number().int().min(10).max(3600).optional().nullable(),
  cash_rounding_step_iqd: z.number().int().min(1).max(100_000).optional().nullable(),
  geojson: z.any(),
});

export async function upsertServiceAreaAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('service_areas.manage');

  const rawGeo = formData.get('geojson');
  if (typeof rawGeo !== 'string' || !rawGeo.trim()) {
    throw new Error('Missing geometry');
  }

  let geojson: any;
  try {
    geojson = JSON.parse(rawGeo);
  } catch {
    throw new Error('Invalid GeoJSON');
  }

  const parsed = upsertSchema.safeParse({
    id: typeof formData.get('id') === 'string' && formData.get('id') ? String(formData.get('id')) : undefined,
    name: String(formData.get('name') ?? '').trim(),
    governorate: String(formData.get('governorate') ?? '').trim(),
    priority: toInt(formData.get('priority')) ?? 0,
    is_active: formData.get('is_active') === 'on' || formData.get('is_active') === 'true',
    pricing_config_id: typeof formData.get('pricing_config_id') === 'string' && String(formData.get('pricing_config_id'))
      ? String(formData.get('pricing_config_id'))
      : null,
    min_base_fare_iqd: toInt(formData.get('min_base_fare_iqd')),
    surge_multiplier: toNum(formData.get('surge_multiplier')),
    surge_reason: typeof formData.get('surge_reason') === 'string' ? String(formData.get('surge_reason')).trim() : null,
    match_radius_m: toInt(formData.get('match_radius_m')),
    driver_loc_stale_after_seconds: toInt(formData.get('driver_loc_stale_after_seconds')),
    cash_rounding_step_iqd: toInt(formData.get('cash_rounding_step_iqd')),
    geojson,
  });
  if (!parsed.success) {
    throw new Error('Invalid request');
  }

  await upsertServiceArea(supabase, {
    id: parsed.data.id ?? null,
    name: parsed.data.name,
    governorate: parsed.data.governorate,
    geojson: parsed.data.geojson,
    priority: parsed.data.priority,
    is_active: parsed.data.is_active,
    pricing_config_id: parsed.data.pricing_config_id ?? null,
    min_base_fare_iqd: parsed.data.min_base_fare_iqd ?? null,
    surge_multiplier: parsed.data.surge_multiplier ?? null,
    surge_reason: parsed.data.surge_reason ?? null,
    match_radius_m: parsed.data.match_radius_m ?? null,
    driver_loc_stale_after_seconds: parsed.data.driver_loc_stale_after_seconds ?? null,
    cash_rounding_step_iqd: parsed.data.cash_rounding_step_iqd ?? null,
  });

  revalidatePath('/service-areas');
  revalidatePath('/maps');
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteServiceAreaAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('service_areas.manage');

  const parsed = deleteSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) throw new Error('Invalid request');

  await deleteServiceArea(supabase, parsed.data.id);

  revalidatePath('/service-areas');
  revalidatePath('/maps');
}
