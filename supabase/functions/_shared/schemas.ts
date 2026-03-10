/**
 * Zod validation schemas for Edge Function inputs.
 * Using Zod to REJECT invalid inputs with clear errors, rather than silently
 * sanitizing them (which can hide bugs and security issues).
 */
import { z } from 'npm:zod@3.23.8';

// --- Shared refinements ---

/** Validates latitude is within -90 to 90 */
export const latitudeSchema = z.number().finite().min(-90).max(90);

/** Validates longitude is within -180 to 180 */
export const longitudeSchema = z.number().finite().min(-180).max(180);

/** Non-empty trimmed string with max length. Returns trimmed value. */
export function trimmedString(maxLen: number) {
    return z
        .string()
        .transform((s) => s.trim())
        .pipe(z.string().min(1, 'String cannot be empty').max(maxLen, `String exceeds ${maxLen} characters`));
}

/** Optional trimmed string (null if empty/whitespace). */
export function optionalTrimmedString(maxLen: number) {
    // Prefer preprocess here so `undefined` is treated as "not provided" (null),
    // rather than failing validation when piping schemas.
    return z.preprocess(
        (v) => {
            if (v == null) return null;
            if (typeof v !== 'string') return v;
            const trimmed = v.trim();
            return trimmed.length > 0 ? trimmed : null;
        },
        z.string().max(maxLen, `String exceeds ${maxLen} characters`).nullable(),
    );
}

// --- ride-intent-create schema ---

const ALLOWED_SOURCES = ['callcenter'] as const;

export const rideIntentCreateSchema = z.object({
    pickup_lat: latitudeSchema,
    pickup_lng: longitudeSchema,
    dropoff_lat: latitudeSchema,
    dropoff_lng: longitudeSchema,
    pickup_address: optionalTrimmedString(240),
    dropoff_address: optionalTrimmedString(240),
    product_code: z
        .string()
        .optional()
        .default('standard')
        .transform((s) => s.toLowerCase().slice(0, 32)),
    scheduled_at: z
        .string()
        .optional()
        .nullable()
        .transform((s) => {
            if (!s) return null;
            const d = new Date(s.trim());
            return Number.isNaN(d.getTime()) ? null : d.toISOString();
        }),
    source: z
        .string()
        .optional()
        .default('callcenter')
        .transform((s) => {
            const lower = s.toLowerCase().trim() as (typeof ALLOWED_SOURCES)[number];
            return ALLOWED_SOURCES.includes(lower) ? lower : 'callcenter';
        }),
    preferences: z.record(z.unknown()).optional().default({}),
});

export type RideIntentCreateInput = z.infer<typeof rideIntentCreateSchema>;

export const rideRequestCreateSchema = z.object({
    pickup_lat: latitudeSchema,
    pickup_lng: longitudeSchema,
    dropoff_lat: latitudeSchema,
    dropoff_lng: longitudeSchema,
    pickup_address: optionalTrimmedString(240),
    dropoff_address: optionalTrimmedString(240),
    product_code: z
        .string()
        .optional()
        .default('standard')
        .transform((s) => s.toLowerCase().trim().slice(0, 32)),
    preferences: z.record(z.unknown()).optional().default({}),
    payment_method: z.preprocess(
        (v) => {
            if (typeof v !== 'string') return v;
            return v.trim().toLowerCase();
        },
        z.enum(['wallet', 'cash']).optional().default('wallet'),
    ),
    fare_quote_id: z.string().uuid('fare_quote_id must be a valid UUID'),
    request_id: z.string().uuid('request_id must be a valid UUID').optional().nullable(),
});

export type RideRequestCreateInput = z.infer<typeof rideRequestCreateSchema>;

// --- fare-quote schema (route-based quote; stored for auditing/ML telemetry) ---

const CURRENT_YEAR = new Date().getUTCFullYear();

export const fareQuoteSchema = z.object({
    pickup_lat: latitudeSchema,
    pickup_lng: longitudeSchema,
    dropoff_lat: latitudeSchema,
    dropoff_lng: longitudeSchema,
    product_code: z
        .string()
        .optional()
        .default('standard')
        .transform((s) => s.toLowerCase().trim().slice(0, 32)),

    // Optional metadata for future ML features. Keep permissive and non-identifying.
    vehicle_class: z
        .string()
        .optional()
        .nullable()
        .transform((s) => {
            if (!s) return null;
            const t = s.trim().toLowerCase();
            return t.length ? t.slice(0, 32) : null;
        })
        .pipe(z.string().max(32).nullable()),

    // Optional vehicle model-year; allow a small forward buffer.
    vehicle_year: z
        .number()
        .int()
        .min(1980)
        .max(CURRENT_YEAR + 1)
        .optional()
        .nullable(),

    // Optional deadhead distance (driver-to-pickup) if dispatch can compute it.
    pickup_deadhead_m: z
        .number()
        .finite()
        .min(0)
        .max(200_000)
        .optional()
        .nullable(),

    // Reserved for additional non-identifying context (e.g., app version).
    context: z.record(z.unknown()).optional().default({}),
});

export type FareQuoteInput = z.infer<typeof fareQuoteSchema>;


// --- admin-users-grant schema ---

export const adminUsersGrantSchema = z.object({
    user_id: z.string().uuid('user_id must be a valid UUID'),
    note: optionalTrimmedString(400),
});

export type AdminUsersGrantInput = z.infer<typeof adminUsersGrantSchema>;

// --- common admin list input schema ---

function intParam(defaultValue: number, min: number, max: number) {
    return z
        .union([z.number(), z.string()])
        .optional()
        .transform((v) => {
            if (v === undefined || v === null || v === '') return defaultValue;
            const n = typeof v === 'string' ? Number(v) : v;
            return Number.isFinite(n) ? Math.floor(n) : defaultValue;
        })
        .pipe(z.number().int().min(min).max(max));
}

export const adminListBodySchema = z.object({
    q: optionalTrimmedString(120),
    status: optionalTrimmedString(40),
    limit: intParam(25, 1, 200),
    offset: intParam(0, 0, 1_000_000),
});

export type AdminListBodyInput = z.infer<typeof adminListBodySchema>;

// --- promotions (Next admin) ---

export const adminGiftCodesListBodySchema = adminListBodySchema.pick({
    q: true,
    status: true,
    limit: true,
    offset: true,
});

export type AdminGiftCodesListBodyInput = z.infer<typeof adminGiftCodesListBodySchema>;

export const adminGiftCodesGenerateBodySchema = z.object({
    count: intParam(1, 1, 500),
    amount_iqd: intParam(0, 1, 10_000_000),
    prefix: optionalTrimmedString(12),
    length: intParam(12, 8, 24),
    memo: optionalTrimmedString(200),
});

export type AdminGiftCodesGenerateBodyInput = z.infer<typeof adminGiftCodesGenerateBodySchema>;

export const adminGiftCodeVoidBodySchema = z.object({
    code: trimmedString(24),
    reason: optionalTrimmedString(200),
});

export type AdminGiftCodeVoidBodyInput = z.infer<typeof adminGiftCodeVoidBodySchema>;

export const adminMerchantPromotionsListBodySchema = z.object({
    q: optionalTrimmedString(120),
    only_active: z.boolean().nullable().optional(),
    limit: intParam(25, 1, 200),
    offset: intParam(0, 0, 1_000_000),
});

export type AdminMerchantPromotionsListBodyInput = z.infer<typeof adminMerchantPromotionsListBodySchema>;

export const adminMerchantPromotionToggleBodySchema = z.object({
    id: z.string().uuid('id must be a UUID'),
    is_active: z.boolean(),
    note: optionalTrimmedString(200),
});

export type AdminMerchantPromotionToggleBodyInput = z.infer<typeof adminMerchantPromotionToggleBodySchema>;

export const adminReferralCampaignUpdateBodySchema = z.object({
    key: trimmedString(80),
    referrer_reward_iqd: z.number().int().min(0).max(10_000_000),
    referred_reward_iqd: z.number().int().min(0).max(10_000_000),
    active: z.boolean(),
});

export type AdminReferralCampaignUpdateBodyInput = z.infer<typeof adminReferralCampaignUpdateBodySchema>;

// --- support (Next admin) ---

const SUPPORT_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;

export const adminSupportTicketsListBodySchema = z.object({
    q: optionalTrimmedString(120),
    status: optionalTrimmedString(40),
    priority: optionalTrimmedString(40),
    assigned_to: z.string().uuid('assigned_to must be a valid UUID').nullable().optional(),
    limit: intParam(25, 1, 200),
    offset: intParam(0, 0, 1_000_000),
});

export type AdminSupportTicketsListBodyInput = z.infer<typeof adminSupportTicketsListBodySchema>;

export const adminSupportTicketGetQuerySchema = z.object({
    ticket_id: z.string().uuid('ticket_id must be a valid UUID'),
});

export type AdminSupportTicketGetQueryInput = z.infer<typeof adminSupportTicketGetQuerySchema>;

export const adminSupportTicketAssignBodySchema = z.object({
    ticket_id: z.string().uuid('ticket_id must be a valid UUID'),
    assigned_to: z.string().uuid('assigned_to must be a valid UUID').nullable().optional(),
    note: optionalTrimmedString(300),
});

export type AdminSupportTicketAssignBodyInput = z.infer<typeof adminSupportTicketAssignBodySchema>;

export const adminSupportTicketSetStatusBodySchema = z.object({
    ticket_id: z.string().uuid('ticket_id must be a valid UUID'),
    status: z.enum(SUPPORT_STATUSES as unknown as [string, ...string[]]),
    note: optionalTrimmedString(300),
});

export type AdminSupportTicketSetStatusBodyInput = z.infer<typeof adminSupportTicketSetStatusBodySchema>;

export const adminSupportTicketReplyBodySchema = z.object({
    ticket_id: z.string().uuid('ticket_id must be a valid UUID'),
    message: trimmedString(4000),
    attachments: z.array(z.record(z.unknown())).optional().default([]),
});

export type AdminSupportTicketReplyBodyInput = z.infer<typeof adminSupportTicketReplyBodySchema>;

export const adminSupportTicketAddNoteBodySchema = z.object({
    ticket_id: z.string().uuid('ticket_id must be a valid UUID'),
    note: trimmedString(4000),
});

export type AdminSupportTicketAddNoteBodyInput = z.infer<typeof adminSupportTicketAddNoteBodySchema>;

export const adminSupportSectionUpsertBodySchema = z.object({
    id: z.string().uuid('id must be a valid UUID').nullable().optional(),
    key: trimmedString(80),
    title: trimmedString(120),
    sort_order: intParam(0, 0, 10_000).optional(),
    enabled: z.boolean().optional(),
});

export type AdminSupportSectionUpsertBodyInput = z.infer<typeof adminSupportSectionUpsertBodySchema>;

export const adminSupportArticlesListBodySchema = z.object({
    q: optionalTrimmedString(120),
    section_id: z.string().uuid('section_id must be a valid UUID').nullable().optional(),
    enabled: z.boolean().nullable().optional(),
    limit: intParam(25, 1, 200),
    offset: intParam(0, 0, 1_000_000),
});

export type AdminSupportArticlesListBodyInput = z.infer<typeof adminSupportArticlesListBodySchema>;

export const adminSupportArticleGetQuerySchema = z.object({
    id: z.string().uuid('id must be a valid UUID'),
});

export type AdminSupportArticleGetQueryInput = z.infer<typeof adminSupportArticleGetQuerySchema>;

export const adminSupportArticleUpsertBodySchema = z.object({
    id: z.string().uuid('id must be a valid UUID').nullable().optional(),
    section_id: z.string().uuid('section_id must be a valid UUID').nullable().optional(),
    slug: trimmedString(120),
    title: trimmedString(180),
    summary: optionalTrimmedString(400),
    body_md: z.string().optional().default(''),
    tags: z
        .array(
            z
                .string()
                .transform((s) => s.trim())
                .pipe(z.string().min(1).max(40)),
        )
        .optional()
        .default([]),
    enabled: z.boolean().optional().default(true),
});

export type AdminSupportArticleUpsertBodyInput = z.infer<typeof adminSupportArticleUpsertBodySchema>;

// --- service areas (Next admin) ---

const geojsonGeometrySchema = z
    .object({
        type: z.enum(['Polygon', 'MultiPolygon']),
        coordinates: z.unknown(),
    })
    .passthrough();

export const adminServiceAreasListBodySchema = adminListBodySchema.pick({
    q: true,
    limit: true,
    offset: true,
});

export type AdminServiceAreasListBodyInput = z.infer<typeof adminServiceAreasListBodySchema>;

export const adminServiceAreaUpsertBodySchema = z.object({
    id: z.string().uuid('id must be a UUID').nullable().optional(),
    name: trimmedString(120),
    governorate: trimmedString(80),
    geojson: geojsonGeometrySchema,
    is_active: z.boolean().optional().default(true),
    priority: z.number().int().min(0).max(10_000).optional().default(0),
    pricing_config_id: z.string().uuid('pricing_config_id must be a UUID').nullable().optional(),
    min_base_fare_iqd: z.number().int().min(0).max(10_000_000).nullable().optional(),
    surge_multiplier: z.number().finite().min(1).max(20).nullable().optional(),
    surge_reason: optionalTrimmedString(120),
    match_radius_m: z.number().int().min(10).max(200_000).nullable().optional(),
    driver_loc_stale_after_seconds: z.number().int().min(10).max(3600).nullable().optional(),
    cash_rounding_step_iqd: z.number().int().min(1).max(100_000).nullable().optional(),
});

export type AdminServiceAreaUpsertBodyInput = z.infer<typeof adminServiceAreaUpsertBodySchema>;

export const adminServiceAreaDeleteBodySchema = z.object({
    id: z.string().uuid('id must be a UUID'),
});

export type AdminServiceAreaDeleteBodyInput = z.infer<typeof adminServiceAreaDeleteBodySchema>;

// --- pricing (Next admin) ---

export const adminPricingListBodySchema = adminListBodySchema.pick({
    q: true,
    limit: true,
    offset: true,
});

export type AdminPricingListBodyInput = z.infer<typeof adminPricingListBodySchema>;

export const adminPricingSetDefaultBodySchema = z.object({
    pricing_config_id: z.string().uuid('pricing_config_id must be a UUID'),
});

export type AdminPricingSetDefaultBodyInput = z.infer<typeof adminPricingSetDefaultBodySchema>;

export const adminPricingUpdateCapsBodySchema = z.object({
    pricing_config_id: z.string().uuid('pricing_config_id must be a UUID'),
    max_surge_multiplier: z.number().finite().min(1).max(20).nullable().optional(),
});

export type AdminPricingUpdateCapsBodyInput = z.infer<typeof adminPricingUpdateCapsBodySchema>;

export const adminPricingCloneBodySchema = z.object({
    pricing_config_id: z.string().uuid('pricing_config_id must be a UUID'),
    name: trimmedString(128).optional(),
    effective_from: z.string().datetime().optional(),
    active: z.boolean().optional(),
    set_default: z.boolean().optional(),
});

export type AdminPricingCloneBodyInput = z.infer<typeof adminPricingCloneBodySchema>;

// --- maps (Next admin) ---

export const adminLiveDriversBodySchema = z.object({
    min_lat: latitudeSchema.optional(),
    min_lng: longitudeSchema.optional(),
    max_lat: latitudeSchema.optional(),
    max_lng: longitudeSchema.optional(),
    max_age_seconds: z.number().int().min(10).max(3600).optional().default(300),
    limit: z.number().int().min(1).max(5000).optional().default(1000),
});

export type AdminLiveDriversBodyInput = z.infer<typeof adminLiveDriversBodySchema>;

// --- fraud module schemas (Next admin uses query params for list ops) ---

export const fraudCasesListQuerySchema = z.object({
    op: z.string().optional().default('list'),
    status: z.enum(['open', 'closed']).optional().default('open'),
    limit: intParam(50, 1, 200),
});

export const fraudActionsListQuerySchema = z.object({
    op: z.string().optional().default('list'),
    status: z.enum(['active', 'expired', 'resolved']).optional().default('active'),
    limit: intParam(50, 1, 200),
});

export const fraudCaseCloseBodySchema = z.object({
    case_id: z.string().uuid('case_id must be a UUID').optional(),
    caseId: z.string().uuid('caseId must be a UUID').optional(),
    resolution_reason: z
        .string()
        .transform((s) => s.trim())
        .pipe(z.string().min(3, 'resolution_reason must be 3..200 chars').max(200))
        .optional(),
    resolutionReason: z
        .string()
        .transform((s) => s.trim())
        .pipe(z.string().min(3, 'resolutionReason must be 3..200 chars').max(200))
        .optional(),
});

export const fraudActionResolveBodySchema = z.object({
    action_id: z.string().uuid('action_id must be a UUID').optional(),
    actionId: z.string().uuid('actionId must be a UUID').optional(),
    resolution_reason: z
        .string()
        .transform((s) => s.trim())
        .pipe(z.string().min(3, 'resolution_reason must be 3..200 chars').max(200))
        .optional(),
    resolutionReason: z
        .string()
        .transform((s) => s.trim())
        .pipe(z.string().min(3, 'resolutionReason must be 3..200 chars').max(200))
        .optional(),
});

// --- additional admin schemas (Next admin) ---

const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'canceled', 'refunded'] as const;
const WITHDRAWAL_STATUSES = ['requested', 'approved', 'rejected', 'paid', 'cancelled'] as const;
const PAYOUT_JOB_STATUSES = ['queued', 'sent', 'confirmed', 'failed', 'canceled'] as const;
const PAYOUT_KINDS = ['qicard', 'asiapay', 'zaincash'] as const;
const PAYOUT_JOB_ACTIONS = ['cancel', 'retry_now', 'force_confirm'] as const;
const MERCHANT_STATUSES = ['draft', 'pending', 'approved', 'suspended'] as const;
const MERCHANT_ORDER_STATUSES = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'fulfilled', 'cancelled'] as const;

function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
    return z.preprocess(
        (v) => {
            if (v == null) return null;
            const s = typeof v === 'string' ? v.trim() : String(v);
            return s ? s : null;
        },
        z.enum(values).nullable(),
    );
}

export const alertingStatusQuerySchema = z.object({
    limit: intParam(100, 10, 500),
});

export const adminDriverDetailQuerySchema = z.object({
    driver_id: z.string().uuid('driver_id must be a valid UUID'),
});

export const adminRideDetailQuerySchema = z.object({
    ride_id: z.string().uuid('ride_id must be a valid UUID'),
});

export const adminPaymentDetailQuerySchema = z.object({
    payment_id: z.string().uuid('payment_id must be a valid UUID'),
});

export const adminWithdrawalDetailQuerySchema = z.object({
    request_id: z.string().uuid('request_id must be a valid UUID'),
});

export const adminPayoutJobDetailQuerySchema = z.object({
    job_id: z.string().uuid('job_id must be a valid UUID'),
});

export const adminMerchantDetailQuerySchema = z.object({
    merchant_id: z.string().uuid('merchant_id must be a valid UUID'),
});

export const adminOrderDetailQuerySchema = z.object({
    order_id: z.string().uuid('order_id must be a valid UUID'),
});

export const paymentsListBodySchema = z.object({
    q: optionalTrimmedString(120),
    status: optionalEnum(PAYMENT_STATUSES as unknown as [string, ...string[]]),
    provider: optionalTrimmedString(80),
    limit: intParam(25, 1, 200),
    offset: intParam(0, 0, 1_000_000),
});

export const withdrawalsListBodySchema = z.object({
    q: optionalTrimmedString(120),
    status: optionalEnum(WITHDRAWAL_STATUSES as unknown as [string, ...string[]]),
    payout_kind: optionalEnum(PAYOUT_KINDS as unknown as [string, ...string[]]),
    limit: intParam(25, 1, 100),
    offset: intParam(0, 0, 1_000_000),
});

export const payoutJobsListBodySchema = z.object({
    q: optionalTrimmedString(120),
    status: optionalEnum(PAYOUT_JOB_STATUSES as unknown as [string, ...string[]]),
    payout_kind: optionalEnum(PAYOUT_KINDS as unknown as [string, ...string[]]),
    limit: intParam(25, 1, 100),
    offset: intParam(0, 0, 1_000_000),
});

export const merchantsListBodySchema = z.object({
    q: optionalTrimmedString(120),
    status: optionalEnum(MERCHANT_STATUSES as unknown as [string, ...string[]]),
    limit: intParam(25, 1, 200),
    offset: intParam(0, 0, 1_000_000),
});

export const ordersListBodySchema = z.object({
    q: optionalTrimmedString(120),
    status: optionalEnum(MERCHANT_ORDER_STATUSES as unknown as [string, ...string[]]),
    merchant_id: z
        .preprocess(
            (v) => {
                if (v == null) return null;
                const s = typeof v === 'string' ? v.trim() : String(v);
                return s ? s : null;
            },
            z.string().uuid('merchant_id must be a valid UUID').nullable(),
        )
        .optional(),
    limit: intParam(25, 1, 200),
    offset: intParam(0, 0, 1_000_000),
});

export const merchantSetStatusBodySchema = z.object({
    merchant_id: z.string().uuid('merchant_id must be a valid UUID'),
    to_status: z.enum(MERCHANT_STATUSES as unknown as [string, ...string[]]),
    note: optionalTrimmedString(500),
});

export const orderSetStatusBodySchema = z.object({
    order_id: z.string().uuid('order_id must be a valid UUID'),
    to_status: z.enum(MERCHANT_ORDER_STATUSES as unknown as [string, ...string[]]),
    note: optionalTrimmedString(500),
});

export const paymentRefundBodySchema = z
    .object({
        payment_id: z.string().uuid('payment_id must be a valid UUID').optional(),
        ride_id: z.string().uuid('ride_id must be a valid UUID').optional(),
        refund_amount_iqd: z.number().int().nonnegative().nullable().optional(),
        reason: trimmedString(500),
        idempotency_key: trimmedString(120),
    })
    .refine((d) => Boolean((d as any).payment_id) || Boolean((d as any).ride_id), {
        message: 'payment_id or ride_id is required',
        path: ['payment_id'],
    });

export const driverTransitionBodySchema = z.object({
    driver_id: z.string().uuid('driver_id must be a valid UUID'),
    to_status: trimmedString(40),
    reason: z.string().trim().min(3).max(500),
});

export const rideCancelBodySchema = z.object({
    ride_id: z.string().uuid('ride_id must be a valid UUID'),
    expected_version: z
        .union([z.number(), z.string()])
        .optional()
        .transform((v) => {
            if (v === undefined || v === null || v === '') return undefined;
            const n = typeof v === 'string' ? Number(v) : v;
            return Number.isFinite(n) ? Math.floor(n) : undefined;
        })
        .pipe(z.number().int().nonnegative().optional()),
    reason: z.string().trim().min(3).max(500),
});

export const rideIntentConvertBodySchema = z.object({
    intent_id: z.string().uuid('intent_id must be a valid UUID'),
});

export const withdrawDecisionBodySchema = z.object({
    request_id: z.string().uuid('request_id must be a valid UUID'),
    note: optionalTrimmedString(500),
});

export const withdrawMarkPaidBodySchema = z.object({
    request_id: z.string().uuid('request_id must be a valid UUID'),
    payout_reference: optionalTrimmedString(120),
    note: optionalTrimmedString(500),
});

export const payoutJobCreateBodySchema = z.object({
    withdraw_request_id: z.string().uuid('withdraw_request_id must be a valid UUID'),
    idempotency_key: trimmedString(120),
});

export const payoutJobActionBodySchema = z.object({
    job_id: z.string().uuid('job_id must be a valid UUID'),
    action: z.enum(PAYOUT_JOB_ACTIONS as unknown as [string, ...string[]]),
    provider_ref: optionalTrimmedString(120),
    note: optionalTrimmedString(500),
});

export const observabilityBodySchema = z.object({
    window_minutes: intParam(60, 5, 24 * 60),
    recent_limit: intParam(50, 1, 200),
    sample_limit: intParam(1000, 50, 5000),
});

export const sloSummaryBodySchema = z.object({
    window_minutes: intParam(60, 5, 24 * 60),
    limit: intParam(50, 1, 200),
});
