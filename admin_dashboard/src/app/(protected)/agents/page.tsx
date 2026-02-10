import { requirePermission } from '@/lib/auth/guards';
import { ComingSoon } from '@/components/common/ComingSoon';

export default async function Page() {
  await requirePermission('agents.view');
  return (
    <ComingSoon
      title="Agents"
      description="Concierge / agent console workflows."
      ownerHint={'Support/Ops'}
    />
  );
}
