import { envTrim } from './config.ts';

export type PaymentProviderKind = 'zaincash' | 'qicard' | 'asiapay';

export type PaymentPreset = {
  id: string;
  label: string;
  amount_iqd: number;
  bonus_iqd: number;
  active: boolean;
  sort_order?: number;
};

export type PaymentProviderPublic = {
  code: string;
  name: string;
  kind: PaymentProviderKind;
  enabled: boolean;
  sort_order: number;
  presets: PaymentPreset[];
};

export type PaymentsPublicConfig = {
  providers: PaymentProviderPublic[];
};

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'n' || s === 'off') return false;
  }
  return fallback;
}

function asInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeKind(kindRaw: string, code: string): PaymentProviderKind {
  const k0 = (kindRaw || code || '').trim().toLowerCase();

  // Accept common aliases to reduce config mistakes.
  if (k0 === 'zaincash' || k0 === 'zaincash_v2' || k0 === 'zaincashv2' || k0 === 'zaincash-v2') return 'zaincash';
  if (k0 === 'qicard' || k0 === 'qi_card' || k0 === 'qi-card') return 'qicard';
  if (k0 === 'asiapay' || k0 === 'asia_pay' || k0 === 'asia-pay' || k0 === 'paydollar') return 'asiapay';

  throw new Error(`Unsupported provider kind: ${kindRaw || '(empty)'} (code=${code})`);
}


export function getPaymentsPublicConfig(): PaymentsPublicConfig {
  const raw = envTrim('PAYMENTS_PUBLIC_CONFIG_JSON');
  if (!raw) throw new Error('PAYMENTS_PUBLIC_CONFIG_JSON is empty');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PAYMENTS_PUBLIC_CONFIG_JSON is not valid JSON');
  }

  const root = asObj(parsed);
  if (!root) throw new Error('PAYMENTS_PUBLIC_CONFIG_JSON must be an object');

  const providersIn = Array.isArray(root.providers) ? (root.providers as unknown[]) : null;
  if (!providersIn) throw new Error('PAYMENTS_PUBLIC_CONFIG_JSON.providers must be an array');

  const codes = new Set<string>();
  const providers: PaymentProviderPublic[] = providersIn
    .map((p) => {
      const o = asObj(p);
      if (!o) return null;

      const code = (asStr(o.code) ?? '').trim().toLowerCase();
      if (!code) return null;
      if (codes.has(code)) throw new Error(`Duplicate provider code: ${code}`);
      codes.add(code);

      const name = (asStr(o.name) ?? code).trim() || code;
      const kind = normalizeKind(asStr(o.kind) ?? '', code);
      const enabled = asBool(o.enabled, false);
      const sortOrder = asInt(o.sort_order, 0);

      const presetsIn = Array.isArray(o.presets) ? (o.presets as unknown[]) : [];
      const presetIds = new Set<string>();
      const presets: PaymentPreset[] = presetsIn
        .map((x) => {
          const px = asObj(x);
          if (!px) return null;
          const id = (asStr(px.id) ?? '').trim();
          if (!id) return null;
          if (presetIds.has(id)) throw new Error(`Duplicate preset id '${id}' in provider '${code}'`);
          presetIds.add(id);

          const amount = asInt(px.amount_iqd, NaN as any);
          const bonus = asInt(px.bonus_iqd, 0);
          const active = asBool(px.active, true);
          const sort_order = asInt(px.sort_order, 0);
          const label = (asStr(px.label) ?? '').trim() || `${amount.toLocaleString('en-US')} IQD`;

          if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid preset amount_iqd for '${code}:${id}'`);
          if (!Number.isFinite(bonus) || bonus < 0) throw new Error(`Invalid preset bonus_iqd for '${code}:${id}'`);

          return { id, label, amount_iqd: amount, bonus_iqd: bonus, active, sort_order };
        })
        .filter(Boolean) as PaymentPreset[];

      presets.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.amount_iqd - b.amount_iqd);

      return { code, name, kind, enabled, sort_order: sortOrder, presets };
    })
    .filter(Boolean) as PaymentProviderPublic[];

  providers.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  return { providers };
}

export function getEnabledProviders(cfg: PaymentsPublicConfig): PaymentProviderPublic[] {
  return (cfg.providers ?? []).filter((p) => p.enabled);
}

export function findProvider(cfg: PaymentsPublicConfig, providerCode: string): PaymentProviderPublic | undefined {
  const code = (providerCode ?? '').trim().toLowerCase();
  return (cfg.providers ?? []).find((p) => p.code === code);
}

export function findPreset(provider: PaymentProviderPublic, presetId: string): PaymentPreset | undefined {
  const id = (presetId ?? '').trim();
  return (provider.presets ?? []).find((p) => p.id === id);
}
