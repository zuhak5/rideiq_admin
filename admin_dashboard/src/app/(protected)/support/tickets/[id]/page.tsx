import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/guards';
import { getSupportTicket } from '@/lib/admin/support';
import TicketDetailClient from '../ticketDetailClient';

export default async function SupportTicketDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAdminContext();

  if (!ctx.guard.can('support.read')) {
    return <div className="p-6 text-sm text-red-600">Forbidden</div>;
  }

  const ticketId = params.id;
  const data = await getSupportTicket(ctx.supabase, ticketId);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link className="text-sm text-gray-600 hover:underline" href="/support/tickets">
          ← Back to tickets
        </Link>
        <div className="text-xs text-gray-500">{ticketId}</div>
      </div>

      <TicketDetailClient
        ticket={data.ticket}
        category={data.category}
        creator={data.creator}
        assignee={data.assignee}
        messages={data.messages}
        internalNotes={data.internal_notes}
        currentUserId={ctx.user?.id ?? null}
        canManage={ctx.guard.can('support.manage')}
      />
    </div>
  );
}
