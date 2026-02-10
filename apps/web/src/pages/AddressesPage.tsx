import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteAddress, listMyAddresses, upsertAddress, type CustomerAddress } from '../lib/orders';
import { errorText } from '../lib/errors';

type Form = {
  id?: string;
  label: string;
  recipient_name: string;
  phone: string;
  city: string;
  area: string;
  address_line1: string;
  address_line2: string;
  notes: string;
  is_default: boolean;
};

const empty: Form = {
  label: '',
  recipient_name: '',
  phone: '',
  city: 'Baghdad',
  area: '',
  address_line1: '',
  address_line2: '',
  notes: '',
  is_default: false,
};

export default function AddressesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<Form>(empty);
  const [open, setOpen] = React.useState(false);

  const listQ = useQuery({ queryKey: ['customer_addresses'], queryFn: listMyAddresses });

  const saveM = useMutation({
    mutationFn: async () => {
      const payload: any = {
        id: editing.id,
        label: editing.label || null,
        recipient_name: editing.recipient_name || null,
        phone: editing.phone || null,
        city: editing.city,
        area: editing.area || null,
        address_line1: editing.address_line1,
        address_line2: editing.address_line2 || null,
        notes: editing.notes || null,
        is_default: editing.is_default,
      };
      return upsertAddress(payload);
    },
    onSuccess: async () => {
      setOpen(false);
      setEditing(empty);
      await qc.invalidateQueries({ queryKey: ['customer_addresses'] });
    },
  });

  const delM = useMutation({
    mutationFn: async (id: string) => deleteAddress(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['customer_addresses'] });
    },
  });

  function startEdit(a?: CustomerAddress) {
    if (!a) {
      setEditing(empty);
      setOpen(true);
      return;
    }
    setEditing({
      id: a.id,
      label: a.label ?? '',
      recipient_name: a.recipient_name ?? '',
      phone: a.phone ?? '',
      city: a.city ?? 'Baghdad',
      area: a.area ?? '',
      address_line1: a.address_line1 ?? '',
      address_line2: a.address_line2 ?? '',
      notes: a.notes ?? '',
      is_default: Boolean(a.is_default),
    });
    setOpen(true);
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xl font-semibold">Addresses</div>
          <div className="text-xs text-gray-500">Manage your saved delivery addresses.</div>
        </div>
        <button className="btn btn-primary" onClick={() => startEdit(undefined)}>
          Add address
        </button>
      </div>

      <div className="card p-5">
        {listQ.isLoading ? <div className="text-sm text-gray-500">Loading…</div> : null}
        {listQ.error ? <div className="text-sm text-red-700">{errorText(listQ.error)}</div> : null}
        {(listQ.data ?? []).length === 0 && !listQ.isLoading ? <div className="text-sm text-gray-600">No addresses yet.</div> : null}

        <div className="space-y-2">
          {(listQ.data ?? []).map((a) => (
            <div key={a.id} className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {a.label ? `${a.label} • ` : ''}
                    {a.city}
                    {a.area ? ` / ${a.area}` : ''}
                    {a.is_default ? ' • default' : ''}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    {a.address_line1}
                    {a.address_line2 ? `, ${a.address_line2}` : ''}
                  </div>
                  {(a.recipient_name || a.phone) ? (
                    <div className="text-xs text-gray-500 mt-1">{[a.recipient_name, a.phone].filter(Boolean).join(' • ')}</div>
                  ) : null}
                  {a.notes ? <div className="text-xs text-gray-500 mt-1">{a.notes}</div> : null}
                </div>
                <div className="flex gap-2">
                  <button className="btn" onClick={() => startEdit(a)}>Edit</button>
                  <button className="btn btn-danger" disabled={delM.isPending} onClick={() => delM.mutate(a.id)}>
                    Delete
                  </button>
                </div>
              </div>
              {delM.error ? <div className="text-sm text-red-700 mt-2">{errorText(delM.error)}</div> : null}
            </div>
          ))}
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center">
          <div className="bg-white w-full md:max-w-xl rounded-t-3xl md:rounded-3xl p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{editing.id ? 'Edit address' : 'New address'}</div>
                <div className="text-xs text-gray-500">Fields with * are required.</div>
              </div>
              <button className="btn" onClick={() => { setOpen(false); setEditing(empty); }}>Close</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="label mb-1">Label</div>
                <input className="input" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="Home" />
              </div>
              <div>
                <div className="label mb-1">Phone</div>
                <input className="input" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} placeholder="07xxxxxxxxx" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="label mb-1">City *</div>
                <input className="input" value={editing.city} onChange={(e) => setEditing({ ...editing, city: e.target.value })} />
              </div>
              <div>
                <div className="label mb-1">Area</div>
                <input className="input" value={editing.area} onChange={(e) => setEditing({ ...editing, area: e.target.value })} />
              </div>
            </div>
            <div>
              <div className="label mb-1">Address line 1 *</div>
              <input className="input" value={editing.address_line1} onChange={(e) => setEditing({ ...editing, address_line1: e.target.value })} />
            </div>
            <div>
              <div className="label mb-1">Address line 2</div>
              <input className="input" value={editing.address_line2} onChange={(e) => setEditing({ ...editing, address_line2: e.target.value })} />
            </div>
            <div>
              <div className="label mb-1">Recipient name</div>
              <input className="input" value={editing.recipient_name} onChange={(e) => setEditing({ ...editing, recipient_name: e.target.value })} />
            </div>
            <div>
              <div className="label mb-1">Notes</div>
              <input className="input" value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
              Make default
            </label>

            {saveM.error ? <div className="text-sm text-red-700">{errorText(saveM.error)}</div> : null}
            <button
              className="btn btn-primary w-full"
              disabled={saveM.isPending || !editing.city || !editing.address_line1}
              onClick={() => saveM.mutate()}
            >
              {saveM.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
