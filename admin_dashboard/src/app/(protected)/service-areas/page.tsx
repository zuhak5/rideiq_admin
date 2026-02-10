import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { listServiceAreas } from '@/lib/admin/serviceAreas';
import { listPricingConfigs } from '@/lib/admin/pricing';
import ServiceAreasClient from './serviceAreasClient';

export default async function ServiceAreasPage({
  searchParams,
}: {
  searchParams?: { q?: string; offset?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('service_areas.read')) {
    redirect('/forbidden?permission=service_areas.read');
  }

  const q = (searchParams?.q ?? '').trim();
  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);

  const res = await listServiceAreas(ctx.supabase, { q, limit: 50, offset });

  const pricing = ctx.can('pricing.read')
    ? await listPricingConfigs(ctx.supabase, { q: '', limit: 200, offset: 0 })
    : { configs: [], page: { limit: 200, offset: 0, returned: 0 } };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Service Areas</h1>
        <form className="flex flex-wrap items-center gap-2" action="/service-areas" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by name/governorate"
            className="rounded-md border px-3 py-2 text-sm bg-white"
          />
          <button className="rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800">
            Search
          </button>
        </form>
      </div>

      <ServiceAreasClient
        query={{ q, offset }}
        initialAreas={res.areas}
        page={res.page}
        pricingConfigs={pricing.configs}
      />

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>
          Showing {res.page.returned} service areas (offset {res.page.offset})
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/service-areas?q=${encodeURIComponent(q)}&offset=${Math.max(0, offset - 50)}`}
          >
            Prev
          </a>
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/service-areas?q=${encodeURIComponent(q)}&offset=${offset + 50}`}
          >
            Next
          </a>
        </div>
      </div>
    </div>
  );
}
