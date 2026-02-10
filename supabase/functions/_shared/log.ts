
import { createServiceClient } from './supabase.ts';
import type { Database } from './database.types.ts';

type LogLevel = Database['public']['Enums']['app_event_level'];
type ActorType = Database['public']['Enums']['ride_actor_type'];

export async function logAppEvent(e: {
  event_type: string;
  level?: LogLevel;
  actor_id?: string | null;
  actor_type?: ActorType | null;
  request_id?: string | null;
  ride_id?: string | null;
  payment_intent_id?: string | null;
  payload?: Record<string, unknown>;
}) {
  try {
    const service = createServiceClient();
    await service.from('app_events').insert({
      event_type: e.event_type,
      level: e.level ?? 'info',
      actor_id: e.actor_id ?? null,
      actor_type: e.actor_type ?? null,
      request_id: e.request_id ?? null,
      ride_id: e.ride_id ?? null,
      payment_intent_id: e.payment_intent_id ?? null,
      payload: e.payload ?? {},
    });
  } catch {
    // Best-effort only.
  }
}
