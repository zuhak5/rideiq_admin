import { createServiceClient } from './supabase.ts';

export const AI_ASSISTANT_PROFILE_ID = (Deno.env.get('AI_ASSISTANT_PROFILE_ID') ?? '00000000-0000-0000-0000-00000000a111').trim();
export const AI_ASSISTANT_DISPLAY_NAME = (Deno.env.get('AI_ASSISTANT_DISPLAY_NAME') ?? 'مساعد RideIQ').trim();

export async function ensureAiAssistantProfile(): Promise<void> {
  const svc = createServiceClient();
  const { data, error } = await svc.from('profiles').select('id').eq('id', AI_ASSISTANT_PROFILE_ID).maybeSingle();
  if (error) throw error;
  if (data?.id) return;

  const { error: insErr } = await svc.from('profiles').insert({
    id: AI_ASSISTANT_PROFILE_ID,
    display_name: AI_ASSISTANT_DISPLAY_NAME,
  });
  if (insErr) throw insErr;
}
