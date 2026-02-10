import { requirePermission } from '@/lib/auth/guards';
import { ComingSoon } from '@/components/common/ComingSoon';

export default async function Page() {
  await requirePermission('incidents.read');
  return (
    <ComingSoon
      title="Incidents"
      description="Safety incidents and SOS event review workflows."
      ownerHint={'Safety'}
    />
  );
}
