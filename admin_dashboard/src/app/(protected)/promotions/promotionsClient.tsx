'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import type { GiftCodeRow, MerchantPromotionRow, ReferralCampaignRow } from '@/lib/admin/promotions';
import {
  generateGiftCodesAction,
  voidGiftCodeAction,
  toggleMerchantPromotionAction,
  updateReferralCampaignAction,
  type GenerateGiftCodesState,
} from './actions';

type Props = {
  canManage: boolean;
  initialGiftCodes: GiftCodeRow[];
  initialMerchantPromotions: MerchantPromotionRow[];
  initialReferralCampaigns: ReferralCampaignRow[];
};

function fmtIqd(n: number | string | null | undefined): string {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : 0;
  return `${v.toLocaleString()} IQD`;
}

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}

function giftStatus(g: GiftCodeRow): 'unredeemed' | 'redeemed' | 'voided' {
  if (g.voided_at) return 'voided';
  if (g.redeemed_at) return 'redeemed';
  return 'unredeemed';
}

export default function PromotionsClient(props: Props): React.JSX.Element {
  const router = useRouter();
  const [tab, setTab] = React.useState<'gift' | 'merchant' | 'referrals'>('gift');

  const [giftQ, setGiftQ] = React.useState('');
  const [giftFilter, setGiftFilter] = React.useState<'all' | 'unredeemed' | 'redeemed' | 'voided'>('all');

  const [promoQ, setPromoQ] = React.useState('');
  const [promoActive, setPromoActive] = React.useState<'all' | 'active' | 'inactive'>('all');

  const [genState, genAction] = React.useActionState<GenerateGiftCodesState, FormData>(generateGiftCodesAction, {
    ok: true,
    codes: [],
  });

  React.useEffect(() => {
    if (genState.ok && genState.codes.length > 0) router.refresh();
  }, [genState.ok, genState.codes.length, router]);

  const giftCodes = React.useMemo(() => {
    const q = giftQ.trim().toLowerCase();
    return props.initialGiftCodes.filter((g) => {
      const s = giftStatus(g);
      if (giftFilter !== 'all' && s !== giftFilter) return false;
      if (!q) return true;
      return (
        g.code.toLowerCase().includes(q) ||
        (g.memo ? g.memo.toLowerCase().includes(q) : false) ||
        (g.redeemed_by ? g.redeemed_by.toLowerCase().includes(q) : false)
      );
    });
  }, [props.initialGiftCodes, giftQ, giftFilter]);

  const promotions = React.useMemo(() => {
    const q = promoQ.trim().toLowerCase();
    return props.initialMerchantPromotions.filter((p) => {
      if (promoActive === 'active' && !p.is_active) return false;
      if (promoActive === 'inactive' && p.is_active) return false;
      if (!q) return true;
      return (
        p.merchant_name.toLowerCase().includes(q) ||
        (p.category ? p.category.toLowerCase().includes(q) : false) ||
        (p.discount_type ? p.discount_type.toLowerCase().includes(q) : false)
      );
    });
  }, [props.initialMerchantPromotions, promoQ, promoActive]);

  const campaigns = props.initialReferralCampaigns;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded-lg border px-3 py-1 text-sm ${tab === 'gift' ? 'bg-black text-white' : ''}`}
          onClick={() => setTab('gift')}
        >
          Gift codes
        </button>
        <button
          type="button"
          className={`rounded-lg border px-3 py-1 text-sm ${tab === 'merchant' ? 'bg-black text-white' : ''}`}
          onClick={() => setTab('merchant')}
        >
          Merchant promotions
        </button>
        <button
          type="button"
          className={`rounded-lg border px-3 py-1 text-sm ${tab === 'referrals' ? 'bg-black text-white' : ''}`}
          onClick={() => setTab('referrals')}
        >
          Referrals
        </button>
        <div className="ml-auto text-xs text-neutral-500">
          manage={props.canManage ? 'yes' : 'no'}
        </div>
      </div>

      {tab === 'gift' ? (
        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <div className="mb-2 text-sm font-medium">Generate gift codes</div>
            {props.canManage ? (
              <form action={genAction} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <label className="flex flex-col gap-1 text-xs">
                  Count
                  <input
                    name="count"
                    type="number"
                    min={1}
                    max={500}
                    defaultValue={10}
                    className="rounded-md border px-2 py-1"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Amount (IQD)
                  <input
                    name="amount_iqd"
                    type="number"
                    min={1}
                    max={10_000_000}
                    defaultValue={5000}
                    className="rounded-md border px-2 py-1"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Prefix (optional)
                  <input name="prefix" type="text" maxLength={12} className="rounded-md border px-2 py-1" />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Length
                  <input
                    name="length"
                    type="number"
                    min={8}
                    max={24}
                    defaultValue={12}
                    className="rounded-md border px-2 py-1"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs md:col-span-2">
                  Memo (optional)
                  <input name="memo" type="text" maxLength={200} className="rounded-md border px-2 py-1" />
                </label>

                <div className="md:col-span-6 flex items-center gap-2">
                  <button type="submit" className="rounded-lg bg-black px-3 py-2 text-sm text-white">
                    Generate
                  </button>
                  {genState.error ? <div className="text-xs text-red-600">{genState.error}</div> : null}
                </div>

                {genState.ok && genState.codes.length > 0 ? (
                  <div className="md:col-span-6 space-y-2">
                    <div className="text-xs text-neutral-600">Generated codes (copy/paste)</div>
                    <textarea
                      readOnly
                      className="h-28 w-full rounded-md border p-2 font-mono text-xs"
                      value={genState.codes.join('\n')}
                    />
                    <button
                      type="button"
                      className="rounded-lg border px-3 py-2 text-sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(genState.codes.join('\n'));
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      Copy
                    </button>
                  </div>
                ) : null}
              </form>
            ) : (
              <div className="text-sm text-neutral-600">You do not have promotions.manage.</div>
            )}
          </div>

          <div className="rounded-xl border p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium">Gift codes</div>
              <input
                value={giftQ}
                onChange={(e) => setGiftQ(e.target.value)}
                placeholder="Search code/memo/user…"
                className="ml-auto rounded-md border px-2 py-1 text-sm"
              />
              <select
                value={giftFilter}
                onChange={(e) => setGiftFilter(e.target.value as any)}
                className="rounded-md border px-2 py-1 text-sm"
              >
                <option value="all">All</option>
                <option value="unredeemed">Unredeemed</option>
                <option value="redeemed">Redeemed</option>
                <option value="voided">Voided</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-neutral-500">
                  <tr>
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Memo</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Redeemed</th>
                    <th className="py-2 pr-0">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {giftCodes.map((g) => {
                    const s = giftStatus(g);
                    return (
                      <tr key={g.code} className="border-t">
                        <td className="py-2 pr-4 font-mono text-xs">{g.code}</td>
                        <td className="py-2 pr-4">{fmtIqd(g.amount_iqd)}</td>
                        <td className="py-2 pr-4">
                          {s === 'unredeemed'
                            ? 'Unredeemed'
                            : s === 'redeemed'
                              ? `Redeemed (${fmtTs(g.redeemed_at)})`
                              : `Voided (${fmtTs(g.voided_at)})`}
                        </td>
                        <td className="py-2 pr-4">{g.memo ?? ''}</td>
                        <td className="py-2 pr-4">{fmtTs(g.created_at)}</td>
                        <td className="py-2 pr-4">{g.redeemed_by ? `${g.redeemed_by.slice(0, 8)}…` : ''}</td>
                        <td className="py-2 pr-0">
                          {props.canManage && s === 'unredeemed' ? (
                            <form action={voidGiftCodeAction} className="flex items-center gap-2">
                              <input type="hidden" name="code" value={g.code} />
                              <input
                                name="reason"
                                placeholder="Reason (optional)"
                                maxLength={200}
                                className="w-44 rounded-md border px-2 py-1 text-xs"
                              />
                              <button type="submit" className="rounded-md border px-2 py-1 text-xs">
                                Void
                              </button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {giftCodes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-sm text-neutral-500">
                        No gift codes
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'merchant' ? (
        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium">Merchant promotions</div>
              <input
                value={promoQ}
                onChange={(e) => setPromoQ(e.target.value)}
                placeholder="Search merchant/category…"
                className="ml-auto rounded-md border px-2 py-1 text-sm"
              />
              <select
                value={promoActive}
                onChange={(e) => setPromoActive(e.target.value as any)}
                className="rounded-md border px-2 py-1 text-sm"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-neutral-500">
                  <tr>
                    <th className="py-2 pr-4">Merchant</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Category</th>
                    <th className="py-2 pr-4">Discount</th>
                    <th className="py-2 pr-4">Window</th>
                    <th className="py-2 pr-4">Active</th>
                    <th className="py-2 pr-0">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {promotions.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-2 pr-4">{p.merchant_name}</td>
                      <td className="py-2 pr-4">{p.merchant_status}</td>
                      <td className="py-2 pr-4">{p.category ?? ''}</td>
                      <td className="py-2 pr-4">{`${p.discount_type}:${p.value}`}</td>
                      <td className="py-2 pr-4">
                        {fmtTs(p.starts_at)} → {fmtTs(p.ends_at)}
                      </td>
                      <td className="py-2 pr-4">{p.is_active ? 'yes' : 'no'}</td>
                      <td className="py-2 pr-0">
                        {props.canManage ? (
                          <form action={toggleMerchantPromotionAction} className="flex items-center gap-2">
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="is_active" value={p.is_active ? 'false' : 'true'} />
                            <input
                              name="note"
                              placeholder="Note (optional)"
                              maxLength={200}
                              className="w-44 rounded-md border px-2 py-1 text-xs"
                            />
                            <button type="submit" className="rounded-md border px-2 py-1 text-xs">
                              {p.is_active ? 'Disable' : 'Enable'}
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {promotions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-sm text-neutral-500">
                        No promotions
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'referrals' ? (
        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <div className="mb-3 text-sm font-medium">Referral campaigns</div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-neutral-500">
                  <tr>
                    <th className="py-2 pr-4">Key</th>
                    <th className="py-2 pr-4">Referrer reward</th>
                    <th className="py-2 pr-4">Referred reward</th>
                    <th className="py-2 pr-4">Active</th>
                    <th className="py-2 pr-0">Update</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-t">
                      <td className="py-2 pr-4 font-mono text-xs">{c.key}</td>
                      <td className="py-2 pr-4">{fmtIqd(c.referrer_reward_iqd)}</td>
                      <td className="py-2 pr-4">{fmtIqd(c.referred_reward_iqd)}</td>
                      <td className="py-2 pr-4">{c.active ? 'yes' : 'no'}</td>
                      <td className="py-2 pr-0">
                        {props.canManage ? (
                          <form action={updateReferralCampaignAction} className="flex items-center gap-2">
                            <input type="hidden" name="key" value={c.key} />
                            <input
                              name="referrer_reward_iqd"
                              type="number"
                              min={0}
                              max={10_000_000}
                              defaultValue={c.referrer_reward_iqd}
                              className="w-28 rounded-md border px-2 py-1 text-xs"
                              required
                            />
                            <input
                              name="referred_reward_iqd"
                              type="number"
                              min={0}
                              max={10_000_000}
                              defaultValue={c.referred_reward_iqd}
                              className="w-28 rounded-md border px-2 py-1 text-xs"
                              required
                            />
                            <label className="flex items-center gap-1 text-xs">
                              <input name="active" type="checkbox" defaultChecked={c.active} /> active
                            </label>
                            <button type="submit" className="rounded-md border px-2 py-1 text-xs">
                              Save
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-sm text-neutral-500">
                        No campaigns
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
