import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { listPricingConfigs } from '@/lib/admin/pricing';
import { setDefaultPricingConfigAction, updatePricingCapsAction, clonePricingConfigAction } from './actions';

function datetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('pricing.read')) {
    redirect('/forbidden?permission=pricing.read');
  }

  const q = (searchParams?.q ?? '').trim();
  const res = await listPricingConfigs(ctx.supabase, { q, limit: 200, offset: 0 });
  const defaultEffective = datetimeLocalValue(new Date());

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Pricing</h1>
        <form className="flex flex-wrap items-center gap-2" action="/pricing" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by name"
            className="rounded-md border px-3 py-2 text-sm bg-white"
          />
          <button className="rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800">
            Search
          </button>
        </form>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Config</th>
              <th className="text-left px-4 py-2 font-medium">Rates</th>
              <th className="text-left px-4 py-2 font-medium">Effective</th>
              <th className="text-left px-4 py-2 font-medium">Max surge</th>
              <th className="text-right px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {res.configs.map((p) => (
              <tr key={p.id} className="border-b last:border-b-0">
                <td className="px-4 py-2">
                  <div className="font-medium">
                    {p.name ? `${p.name} ` : ''}
                    <span className="text-neutral-500">(v{p.version})</span>
                    {p.is_default ? <span className="ml-2 text-indigo-700">(default)</span> : null}
                    {p.active ? <span className="ml-2 text-emerald-700">(active)</span> : <span className="ml-2 text-neutral-500">(inactive)</span>}
                  </div>
                  <div className="text-xs text-neutral-500">id={p.id}</div>
                </td>
                <td className="px-4 py-2">
                  <div className="text-xs text-neutral-700">
                    base={p.base_fare_iqd} • km={p.per_km_iqd} • min={p.per_min_iqd} • minfare={p.minimum_fare_iqd}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <div className="text-xs">
                    {p.effective_from ? new Date(p.effective_from).toLocaleString() : '—'}
                    {p.effective_to ? ` → ${new Date(p.effective_to).toLocaleString()}` : ''}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <form action={updatePricingCapsAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <input
                      name="max_surge_multiplier"
                      type="number"
                      step="0.01"
                      min={1}
                      max={20}
                      defaultValue={String(p.max_surge_multiplier ?? 1)}
                      className="w-28 rounded-md border px-2 py-1 text-sm"
                    />
                    <button
                      type="submit"
                      className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
                    >
                      Save
                    </button>
                  </form>
                </td>
                <td className="px-4 py-2 text-right">
                  <form action={setDefaultPricingConfigAction} className="inline">
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      disabled={p.is_default}
                      className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Set default
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {res.configs.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={5}>
                  No pricing configs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border bg-white p-6">
        <div className="text-sm font-semibold">Create new pricing version (clone)</div>
        <div className="text-xs text-neutral-500 mt-1">
          Clones an existing config, increments its version, and (optionally) sets it as the default.
        </div>

        <form action={clonePricingConfigAction} className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm">
            Clone from
            <select className="mt-1 w-full rounded-md border px-3 py-2" name="source_id" required>
              <option value="">(select)</option>
              {res.configs.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.name ? p.name : p.id)} (v{p.version}){p.is_default ? ' — default' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            New name
            <input className="mt-1 w-full rounded-md border px-3 py-2" name="name" placeholder="Iraq default v2" />
          </label>

          <label className="text-sm">
            Effective from
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
              name="effective_from"
              type="datetime-local"
              defaultValue={defaultEffective}
              required
            />
          </label>

          <label className="text-sm">
            Set as default
            <div className="mt-2">
              <input type="checkbox" name="set_default" />
            </div>
          </label>

          <div className="md:col-span-2">
            <button className="rounded-md bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800">
              Clone
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
