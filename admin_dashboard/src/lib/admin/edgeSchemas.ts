import { z } from 'zod';

// Keep schemas permissive on unknown fields to avoid fragile coupling.

export const fraudCaseSchema = z
  .object({
    id: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    status: z.string(),
    subject_kind: z.string(),
    subject_key: z.string(),
    risk_score: z.number().nullable().optional(),
    signals: z.unknown().optional(),
    resolution_reason: z.string().nullable().optional(),
    closed_at: z.string().nullable().optional(),
    closed_by: z.string().nullable().optional(),
  })
  .passthrough();

export const fraudActionSchema = z
  .object({
    id: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    action_type: z.string(),
    subject_kind: z.string(),
    subject_key: z.string(),
    reason: z.string().nullable().optional(),
    severity: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
    expired_at: z.string().nullable().optional(),
    resolved_at: z.string().nullable().optional(),
    resolved_by: z.string().nullable().optional(),
    resolution_reason: z.string().nullable().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough();

export const listFraudCasesResponseSchema = z.object({
  ok: z.boolean(),
  cases: z.array(fraudCaseSchema).default([]),
});

export const listFraudActionsResponseSchema = z.object({
  ok: z.boolean(),
  actions: z.array(fraudActionSchema).default([]),
});
