import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';

export default async function SupportIndexPage() {
  const ctx = await getAdminContext();

  if (!ctx.guard.can('support.read')) {
    return <div className="p-6 text-sm text-red-600">Forbidden</div>;
  }

  redirect('/support/tickets');
}
