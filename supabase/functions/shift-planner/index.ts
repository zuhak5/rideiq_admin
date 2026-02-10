import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { logAppEvent } from '../_shared/log.ts';

/**
 * Driver Shift Management
 *
 * Create, update, and manage driver shifts.
 */

type ShiftRequest = {
    scheduled_start: string;
    scheduled_end: string;
    target_earnings_iqd?: number;
    target_trips?: number;
    preferred_zones?: string[];
    reminder_minutes_before?: number;
    notes?: string;
};

Deno.serve((req) => withRequestContext('shift-planner', req, async (ctx) => {

    const { user, error: authError } = await requireUser(req, ctx);
    if (!user) {
        return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
    }

    const service = createServiceClient();

    if (req.method === 'GET') {
        // Get active/upcoming shifts
        const { data: shifts, error } = await service
            .from('driver_shifts')
            .select('*')
            .eq('driver_id', user.id)
            .in('status', ['scheduled', 'active'])
            .order('scheduled_start', { ascending: true })
            .limit(10);

        if (error) {
            return errorJson(error.message, 400, 'FETCH_ERROR', undefined, ctx.headers);
        }

        return json({ shifts }, 200, ctx.headers);
    }

    if (req.method === 'POST') {
        const body: ShiftRequest = await req.json().catch(() => ({} as ShiftRequest));

        if (!body.scheduled_start || !body.scheduled_end) {
            return errorJson('scheduled_start and scheduled_end are required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
        }

        const start = new Date(body.scheduled_start);
        const end = new Date(body.scheduled_end);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return errorJson('Invalid date format', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
        }

        if (end <= start) {
            return errorJson('scheduled_end must be after scheduled_start', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
        }

        const { data, error } = await service
            .from('driver_shifts')
            .insert({
                driver_id: user.id,
                scheduled_start: body.scheduled_start,
                scheduled_end: body.scheduled_end,
                target_earnings_iqd: body.target_earnings_iqd ?? null,
                target_trips: body.target_trips ?? null,
                preferred_zones: body.preferred_zones ?? null,
                reminder_minutes_before: body.reminder_minutes_before ?? 30,
                notes: body.notes ?? null,
                status: 'scheduled',
            })
            .select()
            .single();

        if (error) {
            return errorJson(error.message, 400, 'CREATE_ERROR', undefined, ctx.headers);
        }

        await logAppEvent({
            event_type: 'shift_created',
            actor_id: user.id,
            actor_type: 'driver',
            payload: { shift_id: data.id },
        });

        return json({ shift: data }, 201, ctx.headers);
    }

    if (req.method === 'PATCH') {
        const url = new URL(req.url);
        const shiftId = url.searchParams.get('id');

        if (!shiftId) {
            return errorJson('id query parameter required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
        }

        const body = await req.json().catch(() => ({}));

        const { data, error } = await service
            .from('driver_shifts')
            .update({
                ...body,
                updated_at: new Date().toISOString(),
            })
            .eq('id', shiftId)
            .eq('driver_id', user.id)
            .select()
            .single();

        if (error) {
            return errorJson(error.message, 400, 'UPDATE_ERROR', undefined, ctx.headers);
        }

        return json({ shift: data }, 200, ctx.headers);
    }

    if (req.method === 'DELETE') {
        const url = new URL(req.url);
        const shiftId = url.searchParams.get('id');

        if (!shiftId) {
            return errorJson('id query parameter required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
        }

        const { error } = await service
            .from('driver_shifts')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', shiftId)
            .eq('driver_id', user.id)
            .in('status', ['draft', 'scheduled']);

        if (error) {
            return errorJson(error.message, 400, 'CANCEL_ERROR', undefined, ctx.headers);
        }

        return json({ success: true }, 200, ctx.headers);
    }

    return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
}));
