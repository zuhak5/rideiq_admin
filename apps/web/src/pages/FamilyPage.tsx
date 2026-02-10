import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { invokeEdge } from '../lib/edgeInvoke';
import { errorText } from '../lib/errors';


type FamilyMember = {
  user_id: string;
  role: 'guardian' | 'teen' | 'adult';
  status: 'invited' | 'active' | 'suspended';
  profile?: {
    display_name: string | null;
    phone: string | null;
  };
};

type Family = {
  id: string;
  created_by: string;
  created_at: string;
  members: FamilyMember[];
};

export default function FamilyPage() {
  const qc = useQueryClient();
  const [toast, setToast] = React.useState<string | null>(null);


  const familyQ = useQuery({
    queryKey: ['my_family'],
    queryFn: async () => {
      // We can fetch family via RPC or directly if RLS allows.
      // For now, let's assume we fetch the family the user belongs to.
      // Since there's no direct "get_my_family" RPC in the summary, we might need to query tables.
      // However, usually we'd have an edge function or a direct query.
      // Let's try querying family_members joined with families.

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');

      const { data: mems, error } = await supabase
        .from('family_members')
        .select('family_id, role, status, family:families(*)')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      if (!mems) return null;

      const familyId = mems.family_id;

      // Now fetch all members of this family
      const { data: allMembers, error: err2 } = await supabase
        .from('family_members')
        .select('user_id, role, status')
        .eq('family_id', familyId);

      if (err2) throw err2;

      // Fetch profiles for these members
      const userIds = allMembers.map(m => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, phone')
        .in('id', userIds);

      const membersWithProfile = allMembers.map(m => ({
        ...m,
        profile: profiles?.find(p => p.id === m.user_id)
      }));

      return {
        id: familyId,
        created_by: (mems.family as any).created_by_user_id,
        created_at: (mems.family as any).created_at,
        members: membersWithProfile
      } as Family;
    }
  });

  const createFamilyM = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('family_create', { p_name: null });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my_family'] });
      setToast('Family created!');
    },
    onError: (e) => setToast(errorText(e))
  });

  const inviteTeenM = useMutation({
    mutationFn: async () => {
      // Just a placeholder for the invite flow. 
      // Theoretically this returns an invite link or token.
      const { data } = await invokeEdge<{ token: string, url: string }>('family-invite', { role: 'teen' });
      return data;
    },
    onSuccess: (data) => {
      // In a real app we'd show the link to copy.
      // Assuming the edge function returns a URL or we construct it.
      const link = `${window.location.origin}/family/invite/${data.token}`;
      setInvitationLink(link);
      setToast('Invite link generated.');
    },
    onError: (e) => setToast(errorText(e))
  });

  const [invitationLink, setInvitationLink] = React.useState<string | null>(null);

  if (familyQ.isLoading) return <div className="p-6">Loading family...</div>;

  const family = familyQ.data;

  if (!family) {
    return (
      <div className="p-6 space-y-6">
        <div className="card p-8 text-center max-w-lg mx-auto">
          <h2 className="text-2xl font-bold mb-2">Create a Family Profile</h2>
          <p className="text-gray-600 mb-6">
            Set up a family account to manage teen rides, track trips, and share payment methods.
          </p>
          <button
            className="btn btn-primary w-full"
            onClick={() => createFamilyM.mutate()}
            disabled={createFamilyM.isPending}
          >
            {createFamilyM.isPending ? 'Creating...' : 'Create Family'}
          </button>
          {toast && <div className="mt-4 text-red-600 dark:text-red-400">{toast}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Family Profile</h1>
        <div className="text-sm text-gray-500">ID: {family.id.slice(0, 8)}</div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Members List */}
        <div className="card p-5">
          <h3 className="font-semibold mb-4">Family Members</h3>
          <div className="space-y-3">
            {family.members.map(m => (
              <div key={m.user_id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                <div>
                  <div className="font-medium">{m.profile?.display_name || 'Unknown User'}</div>
                  <div className="text-xs text-gray-500">{m.profile?.phone || 'No phone'}</div>
                </div>
                <div className="text-right">
                  <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${m.role === 'guardian' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                    {m.role}
                  </span>
                  <div className="text-xs text-gray-400 mt-1 capitalize">{m.status}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
            <h4 className="text-sm font-medium mb-2">Invite a Teen</h4>
            <p className="text-xs text-gray-500 mb-3">
              teens get their own account but you track their rides and manage payment.
            </p>

            {!invitationLink ? (
              <button
                className="btn w-full"
                onClick={() => inviteTeenM.mutate()}
                disabled={inviteTeenM.isPending}
              >
                {inviteTeenM.isPending ? 'Generating Link...' : 'Generate Invite Link'}
              </button>
            ) : (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-lg">
                <div className="text-xs text-emerald-800 dark:text-emerald-200 mb-1">Share this link:</div>
                <div className="text-sm font-mono break-all">{invitationLink}</div>
                <button
                  className="mt-2 text-xs font-semibold text-emerald-700 hover:underline"
                  onClick={() => {
                    navigator.clipboard.writeText(invitationLink);
                    setToast('Link copied!');
                  }}
                >
                  Copy Link
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Guardian Controls placeholder */}
        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="font-semibold mb-2">Guardian Controls</h3>
            <p className="text-sm text-gray-500 mb-4">
              Manage destination locks, spending limits, and approved hours.
            </p>
            <div className="p-4 border border-dashed border-gray-300 rounded-xl text-center text-gray-400 text-sm">
              Policy settings coming soon (Session 11 Part B)
            </div>
          </div>
        </div>
      </div>

      {toast && <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm">{toast}</div>}
    </div>
  );
}
