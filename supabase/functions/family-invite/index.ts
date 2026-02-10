import { createUserClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { logAppEvent } from '../_shared/log.ts';

type InviteTeenBody = {
    family_id: string;
    invite_email: string;
};

function generateSecureToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve((req) => withRequestContext('family-invite', req, async (ctx) => {

    if (req.method !== 'POST') {
        return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    const { user, error: authError } = await requireUser(req, ctx);
    if (!user) {
        return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
    }

    const body: InviteTeenBody = await req.json().catch(() => ({} as InviteTeenBody));

    if (!body.family_id) {
        return errorJson('family_id is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }
    if (!body.invite_email) {
        return errorJson('invite_email is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    const inviteToken = generateSecureToken();
    // Use the caller's JWT so the SECURITY DEFINER RPC binds to auth.uid() correctly.
    const db = createUserClient(req);

    const { data, error } = await db.rpc('family_invite_teen', {
        p_family_id: body.family_id,
        p_invite_email: body.invite_email,
        p_invite_token: inviteToken,
    });

    if (error) {
        if (error.message?.includes('forbidden')) {
            return errorJson('You are not authorized to invite members to this family', 403, 'FORBIDDEN', undefined, ctx.headers);
        }
        await logAppEvent({
            event_type: 'family_invite_error',
            actor_id: user.id,
            actor_type: 'rider',
            payload: { family_id: body.family_id, error: error.message },
        });
        return errorJson(error.message, 400, 'INVITE_ERROR', undefined, ctx.headers);
    }

    await logAppEvent({
        event_type: 'family_invite_sent',
        actor_id: user.id,
        actor_type: 'rider',
        payload: { family_id: body.family_id, invite_email: body.invite_email },
    });

    // Return the invite token to the caller (they'll send it via email/SMS)
    return json({
        invite: data,
        invite_token: inviteToken,  // Caller sends this to the teen
        invite_link: `rideiq://family/accept?token=${inviteToken}`,
    }, 201, ctx.headers);
}));
