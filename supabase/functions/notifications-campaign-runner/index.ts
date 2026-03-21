import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { requireCronSecret } from '../_shared/cronAuth.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { executeCampaign, type NotificationCampaignRow } from '../_shared/notifications.ts';

type Body = {
  limit?: number;
};

serve((req) =>
  withRequestContext('notifications-campaign-runner', req, async (ctx) => {
    if (req.method !== 'POST') {
      return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    const cronError = requireCronSecret(req);
    if (cronError) {
      return cronError;
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const limit = Math.max(1, Math.min(50, Number(body.limit ?? 10) || 10));
    const supabase = createServiceClient();

    const { data, error } = await supabase.rpc('notification_campaign_claim_due', {
      p_limit: limit,
    });
    if (error) {
      ctx?.error?.('notifications_campaign_runner.claim_failed', { error: error.message });
      return errorJson('Campaign claim failed', 500, 'CLAIM_FAILED', { error: error.message }, ctx.headers);
    }

    const campaigns = (data ?? []) as NotificationCampaignRow[];
    let completed = 0;
    let failed = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const campaign of campaigns) {
      try {
        const stats = await executeCampaign(supabase as any, campaign);
        completed += 1;
        results.push({
          campaign_id: campaign.id,
          status: 'completed',
          ...stats,
        });
      } catch (campaignError) {
        failed += 1;
        const message = String((campaignError as any)?.message ?? campaignError).slice(0, 500);
        await supabase
          .from('notification_campaigns')
          .update({
            status: 'failed',
            last_error: message,
            completed_at: null,
          })
          .eq('id', campaign.id);
        results.push({
          campaign_id: campaign.id,
          status: 'failed',
          error: message,
        });
      }
    }

    return json(
      {
        ok: true,
        claimed: campaigns.length,
        completed,
        failed,
        results,
      },
      200,
      ctx.headers,
    );
  }),
);
