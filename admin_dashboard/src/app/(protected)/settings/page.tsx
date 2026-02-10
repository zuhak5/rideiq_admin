import { requirePermission } from '@/lib/auth/guards';
import { ComingSoon } from '@/components/common/ComingSoon';

export default async function Page() {
  await requirePermission('settings.read');
  return (
    <ComingSoon
      title="Settings"
      description="Feature flags, system settings, and configuration."
      ownerHint={'Platform'}
    />
  );
}
