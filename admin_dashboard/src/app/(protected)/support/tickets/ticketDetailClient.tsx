'use client';

import { useMemo } from 'react';
import { assignTicketAction, setTicketStatusAction, replyTicketAction, addInternalNoteAction } from './actions';

type Props = {
  ticket: any;
  category: { code: string; title: string } | null;
  creator: { id: string; display_name: string | null; phone: string | null } | null;
  assignee: { id: string; display_name: string | null; phone: string | null } | null;
  messages: any[];
  internalNotes: any[];
  currentUserId: string | null;
  canManage: boolean;
};

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded border px-2 py-1 text-xs">{children}</span>;
}

export default function TicketDetailClient({
  ticket,
  category,
  creator,
  assignee,
  messages,
  internalNotes,
  currentUserId,
  canManage,
}: Props) {
  const isAssignedToMe = useMemo(() => !!currentUserId && ticket.assigned_to === currentUserId, [currentUserId, ticket]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-1 space-y-4">
        <div className="rounded border bg-white p-4 space-y-3">
          <div>
            <div className="text-xs text-gray-500">Subject</div>
            <div className="text-base font-semibold">{ticket.subject}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge>Status: {ticket.status}</Badge>
            <Badge>Priority: {ticket.priority}</Badge>
            <Badge>Category: {category?.title ?? ticket.category_code ?? '—'}</Badge>
          </div>

          <div className="text-sm">
            <div className="text-xs text-gray-500">Customer</div>
            <div className="font-medium">{creator?.display_name ?? '—'}</div>
            <div className="text-xs text-gray-500">{creator?.phone ?? ''}</div>
          </div>

          <div className="text-sm">
            <div className="text-xs text-gray-500">Assigned to</div>
            <div className="font-medium">{assignee?.display_name ?? 'Unassigned'}</div>
          </div>

          {canManage ? (
            <div className="space-y-3 pt-2 border-t">
              <div className="text-xs font-medium text-gray-700">Actions</div>

              <div className="flex flex-wrap gap-2">
                <form action={assignTicketAction}>
                  <input type="hidden" name="ticket_id" value={ticket.id} />
                  <input type="hidden" name="assigned_to" value={currentUserId ?? ''} />
                  <input type="hidden" name="note" value="Assigned to me" />
                  <button
                    type="submit"
                    className={`rounded px-3 py-1 text-sm ${isAssignedToMe ? 'bg-gray-200' : 'bg-black text-white'}`}
                    disabled={!currentUserId || isAssignedToMe}
                  >
                    Assign to me
                  </button>
                </form>

                <form action={assignTicketAction}>
                  <input type="hidden" name="ticket_id" value={ticket.id} />
                  <input type="hidden" name="assigned_to" value="" />
                  <input type="hidden" name="note" value="Unassigned" />
                  <button type="submit" className="rounded border px-3 py-1 text-sm">
                    Unassign
                  </button>
                </form>
              </div>

              <form action={setTicketStatusAction} className="space-y-2">
                <input type="hidden" name="ticket_id" value={ticket.id} />
                <label className="text-xs text-gray-600">Set status</label>
                <div className="flex gap-2">
                  <select name="status" defaultValue={ticket.status} className="w-full rounded border px-2 py-2 text-sm">
                    <option value="open">Open</option>
                    <option value="pending">Pending</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                  <button type="submit" className="rounded bg-black px-3 py-2 text-sm text-white">
                    Save
                  </button>
                </div>
                <input
                  name="note"
                  placeholder="Optional note for audit log…"
                  className="w-full rounded border px-3 py-2 text-sm"
                />
              </form>

              <form action={addInternalNoteAction} className="space-y-2">
                <input type="hidden" name="ticket_id" value={ticket.id} />
                <label className="text-xs text-gray-600">Internal note</label>
                <textarea
                  name="note"
                  className="w-full rounded border px-3 py-2 text-sm"
                  rows={4}
                  placeholder="Visible to admins only…"
                  required
                />
                <button type="submit" className="rounded bg-black px-3 py-2 text-sm text-white">
                  Add note
                </button>
              </form>
            </div>
          ) : null}
        </div>

        <div className="rounded border bg-white p-4">
          <div className="text-sm font-medium">Internal notes</div>
          <div className="mt-2 space-y-3">
            {internalNotes.length === 0 ? (
              <div className="text-xs text-gray-500">No internal notes.</div>
            ) : (
              internalNotes.map((n: any) => (
                <div key={n.id} className="rounded border p-3">
                  <div className="text-xs text-gray-500">{new Date(n.created_at).toLocaleString()}</div>
                  <div className="text-sm whitespace-pre-wrap mt-1">{n.note}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-4">
        <div className="rounded border bg-white p-4">
          <div className="text-sm font-medium">Conversation</div>
          <div className="mt-3 space-y-3">
            {messages.length === 0 ? (
              <div className="text-xs text-gray-500">No messages yet.</div>
            ) : (
              messages.map((m: any) => (
                <div key={m.id} className="rounded border p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-600">
                      {m.sender_id === creator?.id ? 'Customer' : m.sender_id === currentUserId ? 'You' : 'Admin'}
                    </div>
                    <div className="text-xs text-gray-500">{new Date(m.created_at).toLocaleString()}</div>
                  </div>
                  <div className="text-sm whitespace-pre-wrap mt-2">{m.message}</div>
                  {Array.isArray(m.attachments) && m.attachments.length > 0 ? (
                    <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-600">{JSON.stringify(m.attachments, null, 2)}</pre>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        {canManage ? (
          <div className="rounded border bg-white p-4">
            <div className="text-sm font-medium">Reply</div>
            <form action={replyTicketAction} className="mt-3 space-y-2">
              <input type="hidden" name="ticket_id" value={ticket.id} />
              <textarea
                name="message"
                className="w-full rounded border px-3 py-2 text-sm"
                rows={5}
                placeholder="Type your reply…"
                required
              />
              <button type="submit" className="rounded bg-black px-3 py-2 text-sm text-white">
                Send reply
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
