import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import MapsClient from './mapsClient';

export default async function MapsPage() {
  const ctx = await getAdminContext();
  if (!ctx.can('maps.view')) {
    redirect('/forbidden?permission=maps.view');
  }

  // Client handles polling (requires browser session token).
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Maps</h1>
        <div className="text-xs text-neutral-500">Live drivers and service area overlays.</div>
      </div>
      <MapsClient />
    </div>
  );
}
