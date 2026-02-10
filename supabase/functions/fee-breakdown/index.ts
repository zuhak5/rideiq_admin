import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

/**
 * Fee Breakdown
 *
 * Returns fee breakdown with explanations for checkout UI.
 */

type FeeBreakdownRequest = {
    subtotal_iqd: number;
    region?: string;
};

type FeeItem = {
    type: string;
    amount_iqd: number;
    waived: boolean;
    title: string;
    explanation: string;
};

Deno.serve((req) => withRequestContext('fee-breakdown', req, async (ctx) => {

    if (req.method !== 'POST') {
        return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    const { user } = await requireUser(req, ctx);
    // Allow anonymous for preview, but membership benefits require auth

    const body: FeeBreakdownRequest = await req.json().catch(() => ({} as FeeBreakdownRequest));

    if (typeof body.subtotal_iqd !== 'number' || body.subtotal_iqd < 0) {
        return errorJson('subtotal_iqd is required and must be non-negative', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    const service = createServiceClient();

    // Basic locale negotiation: prefer Arabic disclosures when the caller requests Arabic.
    // Keep the logic intentionally simple (en/ar) because disclosures are stored per-locale.
    const acceptLanguage = (req.headers.get('accept-language') ?? '').toLowerCase();
    const locale = acceptLanguage.includes('ar') ? 'ar' : 'en';

    // Get applicable pricing rules
    const { data: rules } = await service.rpc('get_applicable_pricing_rules', {
        p_subtotal_iqd: Math.round(body.subtotal_iqd),
        p_region: body.region ?? null,
        p_user_id: user?.id ?? null,
    });

    // Get fee disclosures
    const { data: disclosures } = await service
        .from('fee_disclosures')
        .select('fee_type, title, explanation')
        .eq('locale', locale);

    const disclosureMap = new Map(
        (disclosures ?? []).map(d => [d.fee_type, { title: d.title, explanation: d.explanation }])
    );

    // Calculate fees based on rules
    const topRule = rules?.[0];
    const fees: FeeItem[] = [];

    // Delivery fee
    const deliveryFee = topRule?.delivery_fee_waived
        ? 0
        : (topRule?.delivery_fee_iqd ?? 3000);  // default 3000 IQD
    fees.push({
        type: 'delivery',
        amount_iqd: deliveryFee,
        waived: topRule?.delivery_fee_waived ?? false,
        title: disclosureMap.get('delivery')?.title ?? 'Delivery Fee',
        explanation: disclosureMap.get('delivery')?.explanation ?? '',
    });

    // Service fee
    const serviceFeeRate = topRule?.service_fee_pct ?? 0.15;  // default 15%
    const serviceFee = Math.round(body.subtotal_iqd * Number(serviceFeeRate));
    fees.push({
        type: 'service',
        amount_iqd: serviceFee,
        waived: false,
        title: disclosureMap.get('service')?.title ?? 'Service Fee',
        explanation: disclosureMap.get('service')?.explanation ?? '',
    });

    // Small order fee (if applicable)
    const smallOrderThreshold = 10000;  // 10,000 IQD
    const smallOrderFee = body.subtotal_iqd < smallOrderThreshold
        ? (topRule?.small_order_fee_iqd ?? 2000)
        : 0;
    if (smallOrderFee > 0) {
        fees.push({
            type: 'small_order',
            amount_iqd: smallOrderFee,
            waived: false,
            title: disclosureMap.get('small_order')?.title ?? 'Small Order Fee',
            explanation: disclosureMap.get('small_order')?.explanation ?? '',
        });
    }

    const totalFees = fees.reduce((sum, f) => sum + f.amount_iqd, 0);

    // Get membership info if logged in
    let membership = null;
    if (user) {
        const { data: membershipData } = await service.rpc('get_user_membership', {
            p_user_id: user.id,
        });
        if (membershipData && membershipData.length > 0) {
            membership = membershipData[0];
        }
    }

    return json({
        subtotal_iqd: body.subtotal_iqd,
        fees,
        total_fees_iqd: totalFees,
        grand_total_iqd: body.subtotal_iqd + totalFees,
        membership: membership ? {
            plan: membership.plan_name,
            savings_applied: topRule?.delivery_fee_waived ? deliveryFee : 0,
        } : null,
        upsell: !membership ? {
            message: 'Save on delivery fees with RideIQ Plus!',
            cta: 'Learn more',
        } : null,
    }, 200, ctx.headers);
}));
