'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guards';
import { setDefaultPricingConfig, updatePricingCaps, clonePricingConfig } from '@/lib/admin/pricing';

const setDefaultSchema = z.object({ id: z.string().uuid() });

export async function setDefaultPricingConfigAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('pricing.manage');
  const parsed = setDefaultSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) throw new Error('Invalid request');
  await setDefaultPricingConfig(supabase, parsed.data.id);
  revalidatePath('/pricing');
}

const updateCapsSchema = z.object({
  id: z.string().uuid(),
  max_surge_multiplier: z.number().finite().min(1).max(20),
});

export async function updatePricingCapsAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('pricing.manage');
  const raw = typeof formData.get('max_surge_multiplier') === 'string' ? String(formData.get('max_surge_multiplier')) : '';
  const parsed = updateCapsSchema.safeParse({
    id: formData.get('id'),
    max_surge_multiplier: Number(raw),
  });
  if (!parsed.success) throw new Error('Invalid request');
  await updatePricingCaps(supabase, {
    pricingConfigId: parsed.data.id,
    maxSurgeMultiplier: parsed.data.max_surge_multiplier,
  });
  revalidatePath('/pricing');
}

const cloneSchema = z.object({
  source_id: z.string().uuid(),
  name: z.string().max(128).optional().nullable(),
  effective_from: z.string().datetime(),
  set_default: z.boolean().optional(),
});

export async function clonePricingConfigAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('pricing.manage');
  const nameRaw = typeof formData.get('name') === 'string' ? String(formData.get('name')).trim() : '';
  const effectiveRaw = typeof formData.get('effective_from') === 'string' ? String(formData.get('effective_from')) : '';
  // input[type=datetime-local] returns no timezone; treat as local and convert to ISO.
  const iso = new Date(effectiveRaw).toISOString();
  const parsed = cloneSchema.safeParse({
    source_id: formData.get('source_id'),
    name: nameRaw ? nameRaw : null,
    effective_from: iso,
    set_default: formData.get('set_default') === 'on' || formData.get('set_default') === 'true',
  });
  if (!parsed.success) throw new Error('Invalid request');

  await clonePricingConfig(supabase, {
    sourceId: parsed.data.source_id,
    name: parsed.data.name ?? undefined,
    effectiveFromIso: parsed.data.effective_from,
    active: true,
    setDefault: parsed.data.set_default ?? false,
  });

  revalidatePath('/pricing');
}
