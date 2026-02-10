// Shared, runtime-validated envelope for assistant replies.
// Keep this dependency-free (Deno Edge). Validation is intentionally strict.

export type AssistantKind = 'answer' | 'clarify' | 'refuse';

export type AssistantEnvelope = {
  kind: AssistantKind;
  message: string;
  followups: string[]; // 0..3 short questions
  confidence: number; // 0..1
};

export function heuristicKindFromMessage(text: string): AssistantKind {
  const t = String(text ?? '').trim();
  if (!t) return 'clarify';
  // Iraqi Arabic refusal-ish patterns
  if (/\b(ما\s*اكدر|ما\s*أكدر|ما\s*اگدر|ما\s*اقدر|ما\s*مسموح)\b/i.test(t)) return 'refuse';
  if (/\b(ما\s*اعرف|ما\s*أعرف|مو\s*متأكد|ما\s*متأكد)\b/i.test(t)) return 'clarify';
  if (/[؟?]\s*$/.test(t)) return 'clarify';
  return 'answer';
}

export function clampEnvelope(e: AssistantEnvelope): AssistantEnvelope {
  const kind: AssistantKind = e.kind === 'refuse' || e.kind === 'clarify' || e.kind === 'answer' ? e.kind : 'answer';
  const msg = String(e.message ?? '').trim();
  const followupsRaw = Array.isArray((e as any).followups) ? (e as any).followups : [];
  const followups = followupsRaw
    .map((x: any) => String(x ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 3);

  let confidenceNum = Number((e as any).confidence);
  if (!Number.isFinite(confidenceNum)) confidenceNum = 0.5;
  confidenceNum = Math.max(0, Math.min(1, confidenceNum));

  return {
    kind,
    message: msg,
    followups,
    confidence: confidenceNum,
  };
}

export function isLikelyJson(text: string): boolean {
  const t = String(text ?? '').trim();
  return t.startsWith('{') || t.startsWith('```');
}

export function extractJsonObject(text: string): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  // Remove markdown fences if present.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  // Quick path: if it already looks like a single object.
  if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate;

  // Best-effort: find the first balanced {...}.
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

export function parseEnvelopeFromText(text: string): AssistantEnvelope | null {
  const jsonStr = extractJsonObject(text);
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    if (!obj || typeof obj !== 'object') return null;
    const env: AssistantEnvelope = {
      kind: (obj as any).kind,
      message: (obj as any).message,
      followups: (obj as any).followups,
      confidence: (obj as any).confidence,
    } as any;
    const clamped = clampEnvelope(env);
    if (!clamped.message) return null;
    if (clamped.followups.length > 0 && clamped.kind === 'answer') {
      // followups are allowed, but for answers keep them short. (Enforced elsewhere.)
    }
    return clamped;
  } catch {
    return null;
  }
}

export function makeFallbackEnvelope(message: string, confidence: number, kind?: AssistantKind): AssistantEnvelope {
  const msg = String(message ?? '').trim();
  const k = kind ?? heuristicKindFromMessage(msg);
  return clampEnvelope({ kind: k, message: msg, followups: [], confidence });
}

export function envelopeJsonSchema(name = 'assistant_envelope') {
  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: {
            type: 'string',
            enum: ['answer', 'clarify', 'refuse'],
            description: 'Decision type: answer, ask clarification, or refuse',
          },
          message: {
            type: 'string',
            description: 'User-visible message in Iraqi Arabic. No markdown fences.',
          },
          followups: {
            type: 'array',
            description: '0-3 short follow-up questions in Iraqi Arabic (only when needed).',
            items: { type: 'string' },
          },
          confidence: {
            type: 'number',
            description: '0..1 confidence in the response correctness given available evidence.',
          },
        },
        required: ['kind', 'message', 'followups', 'confidence'],
      },
    },
  };
}
